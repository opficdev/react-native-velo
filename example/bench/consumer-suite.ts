import { Platform } from 'react-native';
import type { BenchProducer, DeviceInfo } from 'example-producer';
import type { BenchPath, ConsumerCase } from './scenarios';
import { calibratedRate } from './calibrated';
import { createConsumer, hasState } from './consumers/create';
import { decoderName } from './consumers/decode';
import type { Dispatch } from './consumers/types';
import { CommitProbe } from './probes/commit';
import { startBusy } from './probes/busy';
import { frameMetrics, startJsFrames } from './probes/frames';
import type { InputProbe } from './probes/input';
import { watchAppState } from './probes/app-state';
import { stepMetrics } from './replay';
import type { Progress } from './runner';
import type { RunExtension } from './runner';
import { runOnce } from './runner';
import {
  caseId,
  consumerCases,
  meanSize,
  rateId,
  sizeTable,
} from './scenarios';
import { mulberry32 } from './stats';

// 소비자 컴포넌트를 마운트하는 화면 쪽 인터페이스
export interface HostControl {
  mount(probe: CommitProbe): Promise<Dispatch>;
  unmount(): void;
}

export interface Context {
  producer: BenchProducer;
  host: HostControl;
  input: InputProbe;
  onProgress: Progress;
}

export interface SuiteOptions {
  cases: ConsumerCase[];
  loads: number[];
  paths: BenchPath[];
  rounds: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const warmupMs = 2000;
const measureMs = 8000;
const coolWaitMs = 5 * 60 * 1000;

function hash(text: string) {
  let value = 17;
  for (let i = 0; i < text.length; i++) {
    value = (Math.imul(value, 31) + text.charCodeAt(i)) | 0;
  }
  return value;
}

// 열 상태가 nominal이 될 때까지의 대기
// 한도 안에 회복하지 못한 경우의 false 반환
async function coolDown(producer: BenchProducer, onProgress: Progress) {
  const until = Date.now() + coolWaitMs;
  while (producer.deviceInfo().thermalState !== 'nominal') {
    if (until < Date.now()) {
      return false;
    }
    onProgress(`열 상태 ${producer.deviceInfo().thermalState} 대기`);
    await sleep(10000);
  }
  return true;
}

// 프레임 프로브 시작과 종료
function startProbes(producer: BenchProducer) {
  producer.startFrames();
  const stopJs = startJsFrames(producer);
  return () => {
    producer.stopFrames();
    const js = stopJs();
    const record = producer.readFrames();
    return { js, ui: new Float64Array(record.times), record };
  };
}

function deviceFields(info: DeviceInfo) {
  return {
    model: info.model,
    osVersion: info.osVersion,
    maxRefreshHz: info.maxRefreshHz,
    lowPowerMode: info.lowPowerMode,
    isSimulator: info.isSimulator,
  };
}

function periodOf(info: DeviceInfo) {
  return 1000 / (0 < info.maxRefreshHz ? info.maxRefreshHz : 60);
}

// 소비자와 분포 조합 한 번의 실행
async function runCase(
  context: Context,
  session: number,
  purpose: 'calibrate' | 'measure',
  item: ConsumerCase,
  path: BenchPath,
  load: number,
  rate: number,
  round: number,
  maxRate: number,
  extra?: Partial<RunExtension>,
) {
  const { producer, host, input } = context;
  const id = caseId(item);
  const info = producer.deviceInfo();
  const table = sizeTable(item.distribution, mulberry32(hash(rateId(item))));
  const capacity =
    Math.ceil(((rate * (warmupMs + measureMs)) / 1000) * 1.1) + 1024;
  const probe = new CommitProbe(producer, capacity);
  let dispatch: Dispatch = () => {};
  if (hasState(item)) {
    dispatch = await host.mount(probe);
  }
  const consumer = createConsumer(item, producer, dispatch);
  // 앱이 종료되어도 어느 실행이었는지 남도록 시작 줄을 먼저 기록
  producer.appendResult(
    JSON.stringify({
      kind: 'begin',
      session,
      purpose,
      id,
      path,
      load,
      rate,
      round,
    }),
  );
  const watcher = watchAppState();
  let stopProbes:
    (() => ReturnType<ReturnType<typeof startProbes>>) | undefined;
  let frames: ReturnType<ReturnType<typeof startProbes>> | undefined;
  let stopBusy: (() => void) | undefined;
  try {
    const result = await runOnce(
      producer,
      path,
      { size: Math.round(meanSize(table)), rate, consumer: 'fast' },
      round,
      {
        sizes: table,
        json: item.pattern === 'parse',
        consumer,
        ...extra,
        cancelled: () => watcher.state.cancelled,
        onStart: ({ from, to }) => {
          if (purpose === 'measure') {
            stopProbes = startProbes(producer);
            input.begin(from, to);
            if (0 < item.busyMs) {
              stopBusy = startBusy(producer, item.busyMs);
            }
          }
        },
        onStop: () => {
          stopBusy?.();
          frames = stopProbes?.();
        },
        finish: ({ from, to }, steps, bytes, state) => {
          const thermalWorst = frames?.record.thermalWorst ?? 'nominal';
          const discardReason = state.cancelled
            ? 'background'
            : state.incomplete
              ? 'incomplete'
              : thermalWorst !== 'nominal' || info.thermalState !== 'nominal'
                ? 'thermal'
                : undefined;
          return {
            session,
            suite: 'consumer',
            purpose,
            pattern: item.pattern,
            distribution: item.distribution,
            batchMs: item.batchMs,
            busyMs: item.busyMs,
            load,
            maxRate,
            payload: item.pattern === 'parse' ? 'json' : 'fill',
            decoder: decoderName,
            meanSize: meanSize(table),
            ...deviceFields(info),
            thermalStart: info.thermalState,
            thermalWorst,
            clockSkewMs: frames?.record.firstSkewMs ?? 0,
            uiOverflow: frames?.record.overflow ?? false,
            ...(frames
              ? frameMetrics(frames.ui, from, to, periodOf(info), 'ui')
              : {}),
            ...(frames
              ? frameMetrics(frames.js, from, to, periodOf(info), 'js')
              : {}),
            ...probe.summary(from, to),
            ...stepMetrics(
              steps,
              bytes,
              from / 1e6,
              to / 1e6,
              probe.renderSpans(from, to),
            ),
            ...input.summary(),
            consumerFailed: (consumer as { failed?: number }).failed ?? 0,
            valid: discardReason === undefined,
            discardReason,
          };
        },
      },
    );
    return result as typeof result & {
      valid: boolean;
      discardReason?: string;
      uiDropped?: number;
    };
  } finally {
    watcher.stop();
    host.unmount();
  }
}

// 보정 상한
// 안드로이드에서 처리하지 못한 버퍼가 JNI 전역 참조 테이블(51200)에 쌓여 한도를 넘는 경우의 앱 종료
// 1.2배 부하에서 10초 동안 쌓이는 양과 1초 분량의 적체가 이 한도 안에 들도록 정한 값
// iOS의 JNI 한도 부재
// 소비자가 실제로 포화되는 속도를 찾기 위해 높인 상한
const android = Platform.OS === 'android';
const rateCap = android ? 8000 : 20000;
// 작은 이벤트에서 JS ArrayBuffer가 가벼워 GC가 늦게 돌고 JNI 전역 참조가 먼저 차는 문제
// 그 문제로 낮춘 안드로이드의 상한
const sensorRateCap = android ? 3000 : 20000;
const byteCap = android ? 40e6 : 150e6;

// 소비자와 분포 조합마다 경로 B가 밀리지 않고 따라가는 최대 발행 속도 보정
// 속도를 올려 가며 따라가는 마지막 속도와 따라가지 못한 첫 속도 사이를 좁히는 탐색
export async function calibrate(context: Context, all = consumerCases) {
  const { producer, onProgress } = context;
  // 블록 부하 조합은 같은 조합의 보정 속도를 쓰므로 중복 제외
  const cases = all.filter((item) => item.busyMs === 0);
  const session = Date.now();
  for (const [index, item] of cases.entries()) {
    const id = rateId(item);
    const table = sizeTable(item.distribution, mulberry32(hash(id)));
    const cap = Math.min(
      item.distribution === 'sensor' ? sensorRateCap : rateCap,
      Math.floor(byteCap / meanSize(table)),
    );
    const tryRate = async (rate: number) => {
      onProgress(`보정 ${index + 1}/${cases.length} ${id} ${rate}/s`);
      const result = await runCase(
        context,
        session,
        'calibrate',
        item,
        'B',
        1,
        rate,
        1,
        rate,
      );
      await sleep(1000);
      // iOS에서 콜백이 JS 큐를 채우면 타이머가 큐가 빌 때까지 밀려 드레인 시간이 0으로 나오는 현상
      // 측정 구간의 처리량이 발행 속도를 따라가는지도 함께 확인
      return (
        result.drainMs <= 1000 &&
        !result.incomplete &&
        !result.overloaded &&
        0.97 * rate <= result.throughput
      );
    };
    let good = 0;
    let bad: number | undefined;
    let rate = Math.min(1000, cap);
    while (bad === undefined) {
      if (await tryRate(rate)) {
        good = rate;
        if (cap <= rate) {
          break;
        }
        rate = Math.min(cap, Math.ceil(rate * 1.5));
      } else if (good === 0 && 50 < rate) {
        rate = Math.max(50, Math.floor(rate / 1.5));
      } else {
        bad = rate;
      }
    }
    for (
      let step = 0;
      step < 2 && bad !== undefined && good + 1 < bad;
      step++
    ) {
      const mid = Math.round((good + bad) / 2);
      if (await tryRate(mid)) {
        good = mid;
      } else {
        bad = mid;
      }
    }
    producer.appendResult(
      JSON.stringify({
        kind: 'calibrate',
        session,
        id,
        rate: good,
        cap,
        verified: 0 < good,
      }),
    );
    onProgress(`보정 ${index + 1}/${cases.length} ${id} 결과 ${good}/s`);
  }
  onProgress('보정 완료');
}

// 소비자 패턴 측정
// 회차마다 무부하 기준 실행을 앞세우고 나머지는 시드로 섞어 실행
export async function runConsumerSuite(
  context: Context,
  options: SuiteOptions,
) {
  const { producer, host, onProgress } = context;
  const session = Date.now();
  const info = producer.deviceInfo();
  producer.appendResult(
    JSON.stringify({
      kind: 'session',
      session,
      decoder: decoderName,
      ...deviceFields(info),
      cases: options.cases.map(caseId),
      loads: options.loads,
      paths: options.paths,
      rounds: options.rounds,
    }),
  );
  const watcher = watchAppState();
  const retried = new Set<string>();
  try {
    for (let round = 1; round <= options.rounds; round++) {
      // 무부하 기준 실행
      for (const ui of [true, false]) {
        onProgress(`회차 ${round} 무부하 ${ui ? 'UI' : '없음'}`);
        if (!(await coolDown(producer, onProgress))) {
          producer.appendResult(
            JSON.stringify({ kind: 'aborted', session, reason: 'thermal' }),
          );
          return;
        }
        await runIdle(context, session, round, ui);
        await sleep(1000);
      }
      type Item = { item: ConsumerCase; path: BenchPath; load: number };
      const plan: Item[] = options.cases.flatMap((item) =>
        (item.loads ?? options.loads).flatMap((load) =>
          options.paths.map((path) => ({ item, path, load })),
        ),
      );
      const random = mulberry32(round);
      for (let i = plan.length - 1; 0 < i; i--) {
        const j = Math.floor(random() * (i + 1));
        [plan[i], plan[j]] = [plan[j], plan[i]];
      }
      for (let i = 0; i < plan.length; i++) {
        const { item, path, load } = plan[i];
        const id = caseId(item);
        if (watcher.state.cancelled) {
          producer.appendResult(
            JSON.stringify({ kind: 'aborted', session, reason: 'background' }),
          );
          onProgress('중단 background');
          return;
        }
        if (!(await coolDown(producer, onProgress))) {
          producer.appendResult(
            JSON.stringify({ kind: 'aborted', session, reason: 'thermal' }),
          );
          onProgress('중단 thermal');
          return;
        }
        const maxRate = calibratedRate(rateId(item));
        onProgress(
          `회차 ${round} ${i + 1}/${plan.length} ${path} ${id} x${load}`,
        );
        const result = await runCase(
          context,
          session,
          'measure',
          item,
          path,
          load,
          Math.max(10, Math.round(maxRate * load)),
          round,
          maxRate,
        );
        onProgress(
          `회차 ${round} ${i + 1}/${plan.length} 완료 처리 ${result.throughput.toFixed(0)}/s ui드롭 ${result.uiDropped ?? 0}`,
        );
        const key = `${round}-${id}-${path}-${load}`;
        if (
          !result.valid &&
          result.discardReason === 'thermal' &&
          !retried.has(key)
        ) {
          retried.add(key);
          plan.push(plan[i]);
        }
        await sleep(1000);
      }
    }
  } finally {
    watcher.stop();
    host.unmount();
  }
  onProgress('소비자 측정 완료');
}

// 생산자 없이 소비자 화면과 프로브만 켠 무부하 기준 실행
async function runIdle(
  context: Context,
  session: number,
  round: number,
  ui: boolean,
) {
  const { producer, host } = context;
  const info = producer.deviceInfo();
  const probe = new CommitProbe(producer, 16);
  if (ui) {
    await host.mount(probe);
  }
  const start = producer.nowNs();
  const from = start + warmupMs * 1e6;
  const to = start + (warmupMs + measureMs) * 1e6;
  const stop = startProbes(producer);
  try {
    await sleep(warmupMs + measureMs);
  } finally {
    const frames = stop();
    host.unmount();
    producer.appendResult(
      JSON.stringify({
        kind: 'idle',
        session,
        round,
        ui,
        ...deviceFields(info),
        thermalStart: info.thermalState,
        thermalWorst: frames.record.thermalWorst,
        clockSkewMs: frames.record.firstSkewMs,
        ...frameMetrics(frames.ui, from, to, periodOf(info), 'ui'),
        ...frameMetrics(frames.js, from, to, periodOf(info), 'js'),
      }),
    );
  }
}

// 과부하 안정성 시험의 발행 속도(초당)
const stabilityRate = 16000;
const stabilityMs = 30000;

// 느린 소비자에 과부하를 걸고 경로마다 메모리와 처리 대기 건수를 시간순으로 기록
// 경로 B의 처리 대기 한도 해제
// Android에서 앱이 종료되기 전까지의 기록이 결과
export async function runStability(context: Context, paths: BenchPath[]) {
  const { producer, onProgress } = context;
  const session = Date.now();
  const info = producer.deviceInfo();
  const item: ConsumerCase = {
    pattern: 'fixedCost',
    distribution: 'audio',
    batchMs: 8,
    busyMs: 0,
  };
  producer.appendResult(
    JSON.stringify({
      kind: 'session',
      session,
      suite: 'stability',
      ...deviceFields(info),
      rate: stabilityRate,
      durationMs: stabilityMs,
    }),
  );
  for (const path of paths) {
    onProgress(`안정성 ${path} 시작`);
    let lastSampleAt = -1000;
    const startMem = producer.memoryBytes();
    await runCase(
      context,
      session,
      'calibrate',
      item,
      path,
      1,
      stabilityRate,
      1,
      stabilityRate,
      {
        durationMs: stabilityMs,
        noGuard: true,
        onTick: ({ elapsedMs, pending }) => {
          if (500 <= elapsedMs - lastSampleAt) {
            lastSampleAt = elapsedMs;
            // 앱이 종료되어도 남도록 샘플마다 바로 기록
            producer.appendResult(
              JSON.stringify({
                kind: 'mem',
                session,
                path,
                tMs: Math.round(elapsedMs),
                memMB: (producer.memoryBytes() - startMem) / 1048576,
                pending: Math.round(pending),
              }),
            );
          }
        },
      },
    );
    await sleep(3000);
  }
  onProgress('안정성 시험 완료');
}
