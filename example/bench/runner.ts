import type { BenchProducer } from 'example-producer';
import { createEventStream } from 'react-native-velo';
import type { PullResult } from 'react-native-velo';
import type { BenchPath, Scenario } from './scenarios';
import type { Consumer } from './consumers/types';
import type { Step } from './replay';
import { scenarios, workNs } from './scenarios';
import { mulberry32, quantile, slope, sortedCopy } from './stats';

// 02. 기준선 측정과 같은 구간
const warmupMs = 2000;
const measureMs = 8000;
const durationMs = warmupMs + measureMs;
// 런 사이에 남은 이벤트를 기다리는 한도
const drainLimitMs = 60000;
const drainStallMs = 5000;
const rounds = 3;
// 경로 B에서 처리하지 못해 쌓인 이벤트의 한도
// 안드로이드는 JNI 전역 참조 테이블(51200)과 Java 힙(약 192MB)이 먼저 차면 앱이 종료됨
const backlogLimitEvents = 20000;
const backlogLimitBytes = 64 * 1024 * 1024;

export type Progress = (text: string) => void;

// 소비자 패턴 측정이 runOnce에 붙이는 확장
export interface RunExtension {
  // 이벤트 크기 표와 JSON 페이로드 여부
  sizes?: Int32Array;
  json?: boolean;
  // 이벤트와 묶음 처리를 맡는 소비자
  consumer?: Consumer;
  // 실행 시간(ms)이며 생략하면 예열과 측정 구간의 합
  durationMs?: number;
  // 경로 B의 처리 대기 한도를 쓰지 않음
  noGuard?: boolean;
  // 대기 루프마다 호출하는 경과 시간과 처리 대기 건수 통지
  onTick?: (info: { elapsedMs: number; pending: number }) => void;
  // 취소 여부 확인
  cancelled?: () => boolean;
  // 프로브 시작
  onStart?: (window: { runStart: number; from: number; to: number }) => void;
  // 드레인이 끝난 직후의 프로브 종료
  onStop?: () => void;
  // 프로브 결과 필드와 step 기록을 받는 마무리
  finish?: (
    window: { from: number; to: number },
    steps: Step[],
    bytes: number[],
    state: { incomplete: boolean; cancelled: boolean },
  ) => Record<string, unknown>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runOnce(
  producer: BenchProducer,
  path: BenchPath,
  scenario: Scenario,
  round: number,
  ext?: RunExtension,
) {
  const { size, rate } = scenario;
  const work = workNs(scenario);
  const runMs = ext?.durationMs ?? durationMs;
  const capacity = Math.ceil(((rate * runMs) / 1000) * 1.1) + 1024;
  const emitTimes = new Float64Array(capacity);
  const readyTimes = new Float64Array(capacity);
  let count = 0;
  let received = 0;
  let dropped = 0;
  let sizeMismatch = 0;
  let stale = 0;
  const stepMs: number[] = [];
  const stepItems: number[] = [];
  const lags: number[] = [];
  const steps: Step[] = [];
  const stepBytes: number[] = [];

  producer.configure(size, rate, runMs);
  if (ext?.sizes) {
    producer.configurePayload(
      ext.sizes.buffer as ArrayBuffer,
      ext.json ?? false,
    );
  }
  const startMem = producer.memoryBytes();
  let maxMem = startMem;
  const runStart = producer.nowNs();
  const windowFrom = runStart + warmupMs * 1e6;
  const windowTo = runStart + durationMs * 1e6;
  let lastMemAt = runStart;

  const handle = (item: ArrayBuffer) => {
    const ready = producer.nowNs();
    const view = new DataView(item);
    const emit = view.getFloat64(0, true);
    received += 1;
    const expected = ext?.sizes
      ? ext.sizes[view.getFloat64(8, true) % ext.sizes.length]
      : size;
    if (item.byteLength !== expected) {
      sizeMismatch += 1;
    }
    if (emit < runStart) {
      stale += 1;
    } else if (count < capacity) {
      emitTimes[count] = emit;
      readyTimes[count] = ready;
      count += 1;
    }
    if (250e6 <= ready - lastMemAt) {
      lastMemAt = ready;
      maxMem = Math.max(maxMem, producer.memoryBytes());
    }
    if (ext?.consumer) {
      ext.consumer.onItem(item);
    } else if (0 < work) {
      const until = ready + work;
      while (producer.nowNs() < until) {
        // 바쁜 대기
      }
    }
  };

  const onBatch = (batch: PullResult) => {
    const begin = producer.nowNs();
    dropped += batch.dropped;
    let bytes = 0;
    for (const item of batch.items) {
      handle(item);
      bytes += item.byteLength;
    }
    ext?.consumer?.onBatchEnd(false);
    const end = producer.nowNs();
    if (ext) {
      steps.push({
        begin: begin / 1e6,
        end: end / 1e6,
        items: batch.items.length,
      });
      stepBytes.push(bytes);
    }
    if (windowFrom <= begin && begin < windowTo) {
      stepMs.push((end - begin) / 1e6);
      stepItems.push(batch.items.length);
    }
  };

  let ticking = true;
  let lastTick = runStart;
  const tick = () => {
    if (!ticking) {
      return;
    }
    const now = producer.nowNs();
    // 구간 밖에서 실행되는 밀린 타이머까지 잡기 위한 구간 겹침 기준
    if (windowFrom < now && lastTick < windowTo) {
      lags.push((now - lastTick) / 1e6 - 10);
    }
    lastTick = now;
    setTimeout(tick, 10);
  };
  setTimeout(tick, 10);

  ext?.onStart?.({ runStart, from: windowFrom, to: windowTo });
  let release: () => void;
  if (path === 'Q') {
    const stream = createEventStream();
    const unsubscribe = stream.subscribe(onBatch);
    const disconnect = stream.connect(producer);
    release = () => {
      unsubscribe();
      disconnect();
    };
  } else {
    producer.startCallback((item) => {
      handle(item);
      ext?.consumer?.onBatchEnd(true);
    });
    release = () => producer.stopCallback();
  }

  let incomplete = false;
  let cancelled = false;
  let overloaded = false;
  let drainMs: number;
  try {
    const limit = runStart + (runMs + 30000) * 1e6;
    while (!producer.finished() && producer.nowNs() < limit) {
      if (ext?.cancelled?.()) {
        cancelled = true;
        break;
      }
      // 예정대로 발행했다고 보고 계산한 처리 대기 건수
      const elapsed = Math.min(runMs, (producer.nowNs() - runStart) / 1e6);
      const pending = (rate * elapsed) / 1000 - received - dropped;
      ext?.onTick?.({ elapsedMs: elapsed, pending });
      if (
        path === 'B' &&
        !overloaded &&
        !ext?.noGuard &&
        (backlogLimitEvents < pending || backlogLimitBytes < pending * size)
      ) {
        overloaded = true;
        producer.stopCallback();
      }
      await sleep(50);
    }
    const emittedTotal = producer.readStats(0, 1e18).emitted;
    const finishAt = producer.nowNs();
    let lastProgressAt = finishAt;
    let lastReceived = received;
    while (!cancelled && received + dropped < emittedTotal) {
      if (ext?.cancelled?.()) {
        cancelled = true;
        break;
      }
      await sleep(50);
      const now = producer.nowNs();
      if (received !== lastReceived) {
        lastReceived = received;
        lastProgressAt = now;
      }
      if (
        drainStallMs * 1e6 < now - lastProgressAt ||
        drainLimitMs * 1e6 < now - finishAt
      ) {
        incomplete = true;
        break;
      }
    }
    drainMs = (producer.nowNs() - finishAt) / 1e6;
  } finally {
    ticking = false;
    release();
    ext?.onStop?.();
  }

  const native = producer.readStats(windowFrom, windowTo);
  const latency: number[] = [];
  const buckets: number[][] = Array.from(
    { length: measureMs / 1000 },
    () => [],
  );
  let windowReceived = 0;
  for (let i = 0; i < count; i++) {
    if (windowFrom <= readyTimes[i] && readyTimes[i] < windowTo) {
      windowReceived += 1;
    }
    if (windowFrom <= emitTimes[i] && emitTimes[i] < windowTo) {
      const ms = (readyTimes[i] - emitTimes[i]) / 1e6;
      latency.push(ms);
      buckets[Math.floor((emitTimes[i] - windowFrom) / 1e9)].push(ms);
    }
  }
  const latencySorted = sortedCopy(latency);
  const seconds = buckets.map((bucket) => quantile(sortedCopy(bucket), 0.5));
  const lagSorted = sortedCopy(lags);
  const stepSorted = sortedCopy(stepMs);
  const itemsSorted = sortedCopy(stepItems);

  const result = {
    kind: 'run',
    path,
    size,
    rate,
    consumer: scenario.consumer,
    round,
    emitted: native.emitted,
    windowEmitted: native.windowEmitted,
    received,
    dropped,
    sizeMismatch,
    stale,
    incomplete,
    drainMs,
    throughput: windowReceived / (measureMs / 1000),
    latencyP50: quantile(latencySorted, 0.5),
    latencyP99: quantile(latencySorted, 0.99),
    latencyMax: quantile(latencySorted, 1 - 1e-9),
    secondsP50: seconds,
    slopeMsPerSec: slope(
      seconds.map((_, index) => index),
      seconds,
    ),
    loopLagP99: quantile(lagSorted, 0.99),
    loopLagMax: lagSorted.length > 0 ? lagSorted[lagSorted.length - 1] : 0,
    startMB: startMem / 1048576,
    maxMB: maxMem / 1048576,
    costP50Ns: native.costP50Ns,
    costP99Ns: native.costP99Ns,
    costMaxNs: native.costMaxNs,
    lateRatio:
      native.windowEmitted > 0 ? native.windowLate / native.windowEmitted : 0,
    steps: stepMs.length,
    stepP50Ms: quantile(stepSorted, 0.5),
    stepP99Ms: quantile(stepSorted, 0.99),
    stepMaxMs: stepSorted.length > 0 ? stepSorted[stepSorted.length - 1] : 0,
    stepItemsP50: quantile(itemsSorted, 0.5),
    ...ext?.finish?.({ from: windowFrom, to: windowTo }, steps, stepBytes, {
      incomplete,
      cancelled,
    }),
    cancelled,
    overloaded,
  };
  producer.appendResult(JSON.stringify(result));
  return result;
}

// 회차마다 순서를 섞은 B와 Q의 시나리오 전체 실행
export async function runSuite(
  producer: BenchProducer,
  onProgress: Progress,
  only?: { path: BenchPath; scenario: Scenario },
) {
  const plan: { path: BenchPath; scenario: Scenario; round: number }[] = [];
  const list = only ? [only.scenario] : scenarios;
  for (let round = 1; round <= (only ? 1 : rounds); round++) {
    const items = list.flatMap((scenario) =>
      only
        ? [{ path: only.path, scenario, round }]
        : [
            { path: 'B' as const, scenario, round },
            { path: 'Q' as const, scenario, round },
          ],
    );
    const random = mulberry32(round);
    for (let i = items.length - 1; 0 < i; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    plan.push(...items);
  }
  for (let i = 0; i < plan.length; i++) {
    const { path, scenario, round } = plan[i];
    onProgress(
      `${i + 1}/${plan.length} 회차 ${round} ${path} ${scenario.size}B ${scenario.rate}/s ${scenario.consumer}`,
    );
    const result = await runOnce(producer, path, scenario, round);
    onProgress(
      `${i + 1}/${plan.length} 완료 p50 ${result.latencyP50.toFixed(2)}ms 처리 ${result.throughput.toFixed(0)}/s`,
    );
    await sleep(1000);
  }
  onProgress('전체 측정 완료');
}
