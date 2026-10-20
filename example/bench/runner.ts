import type { BenchProducer } from 'example-producer';
import { createEventStream } from 'react-native-velo';
import type { PullResult } from 'react-native-velo';
import type { BenchPath, Scenario } from './scenarios';
import { scenarios, workNs } from './scenarios';
import { quantile, slope, sortedCopy } from './stats';

// 02. 기준선 측정과 같은 구간
const warmupMs = 2000;
const measureMs = 8000;
const durationMs = warmupMs + measureMs;
// 런 사이에 남은 이벤트를 기다리는 한도
const drainLimitMs = 60000;
const drainStallMs = 5000;
const rounds = 3;

export type Progress = (text: string) => void;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 시드를 받는 난수 생성기
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runOnce(
  producer: BenchProducer,
  path: BenchPath,
  scenario: Scenario,
  round: number,
) {
  const { size, rate } = scenario;
  const work = workNs(scenario);
  const capacity = Math.ceil(((rate * durationMs) / 1000) * 1.1) + 1024;
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

  producer.configure(size, rate, durationMs);
  const startMem = producer.memoryBytes();
  let maxMem = startMem;
  const runStart = producer.nowNs();
  const windowFrom = runStart + warmupMs * 1e6;
  const windowTo = runStart + durationMs * 1e6;
  let lastMemAt = runStart;

  const handle = (item: ArrayBuffer) => {
    const ready = producer.nowNs();
    const emit = new DataView(item).getFloat64(0, true);
    received += 1;
    if (item.byteLength !== size) {
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
    if (0 < work) {
      const until = ready + work;
      while (producer.nowNs() < until) {
        // 바쁜 대기
      }
    }
  };

  const onBatch = (batch: PullResult) => {
    const begin = producer.nowNs();
    dropped += batch.dropped;
    for (const item of batch.items) {
      handle(item);
    }
    if (windowFrom <= begin && begin < windowTo) {
      stepMs.push((producer.nowNs() - begin) / 1e6);
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
    producer.startCallback(handle);
    release = () => producer.stopCallback();
  }

  const limit = runStart + (durationMs + 30000) * 1e6;
  while (!producer.finished() && producer.nowNs() < limit) {
    await sleep(50);
  }
  const emittedTotal = producer.readStats(0, 1e18).emitted;
  const finishAt = producer.nowNs();
  let lastProgressAt = finishAt;
  let lastReceived = received;
  let incomplete = false;
  while (received + dropped < emittedTotal) {
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
  const drainMs = (producer.nowNs() - finishAt) / 1e6;
  ticking = false;
  release();

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
