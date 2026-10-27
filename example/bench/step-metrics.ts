import { quantile, sortedCopy } from './stats';

// onBatch 한 번의 기록(ms)
export interface Step {
  begin: number;
  end: number;
  items: number;
  // 이 onBatch가 받은 폐기 건수
  dropped: number;
  // 첫 항목의 발행 시각
  // 항목이 없으면 begin
  firstEmit: number;
  // 이 step이 양보 뒤 재개로 실행된 경우의 setTimeout 예약 시각과 실행 시각
  yieldAt?: number;
  resumeAt?: number;
}

// 시간 조각의 종류
// busy는 onBatch 안, yield는 양보 대기, idle은 큐가 비어 있던 시간
// dispatch는 신호 전달과 pull 같은 나머지 간격
type Kind = 'busy' | 'yield' | 'dispatch' | 'idle';

interface Piece {
  from: number;
  to: number;
  kind: Kind;
}

// 측정 구간의 step 사이 간격과 step 길이를 종류별 조각으로 나눈 시간표
function timeline(steps: Step[], from: number, to: number) {
  const pieces: Piece[] = [];
  const add = (a: number, b: number, kind: Kind) => {
    if (a < b) {
      pieces.push({ from: a, to: b, kind });
    }
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.begin < from || to <= step.begin) {
      continue;
    }
    if (0 < i) {
      const gapFrom = steps[i - 1].end;
      // 큐가 비어 있던 시간은 첫 항목이 발행되기 전까지
      let cursor = Math.min(step.begin, Math.max(gapFrom, step.firstEmit));
      add(gapFrom, cursor, 'idle');
      if (step.yieldAt !== undefined && step.resumeAt !== undefined) {
        const yieldFrom = Math.max(cursor, step.yieldAt);
        const yieldTo = Math.min(step.begin, step.resumeAt);
        add(cursor, yieldFrom, 'dispatch');
        add(yieldFrom, yieldTo, 'yield');
        cursor = Math.max(cursor, yieldFrom, yieldTo);
      }
      add(cursor, step.begin, 'dispatch');
    }
    add(step.begin, step.end, 'busy');
  }
  return pieces;
}

// [a, b)와 겹치는 조각의 종류별 시간 합
function overlap(pieces: Piece[], a: number, b: number) {
  const sum = { busy: 0, yield: 0, dispatch: 0, idle: 0 };
  for (const piece of pieces) {
    if (b <= piece.from) {
      break;
    }
    if (a < piece.to) {
      sum[piece.kind] += Math.min(b, piece.to) - Math.max(a, piece.from);
    }
  }
  return sum;
}

// 측정 구간의 이벤트별 발행 시각과 처리 시각(ns)
export interface Events {
  emit: Float64Array;
  ready: Float64Array;
  count: number;
}

// 실제 양보와 시간 분해 지표
// 양보 횟수와 지연은 setTimeout 프로브의 실측값
// 지연 상위 1% 이벤트와 폐기 직전 200ms에 겹친 시간을 종류별로 합산
// 지연 이벤트의 종류별 비율은 시간표가 덮는 구간 대비
export function causeMetrics(
  steps: Step[],
  timers: { at: number; run: number }[],
  events: Events,
  from: number,
  to: number,
) {
  const pieces = timeline(steps, from, to);
  const total = overlap(pieces, from, to);
  let items = 0;
  const delays: number[] = [];
  const drops = { busy: 0, yield: 0, dispatch: 0, idle: 0 };
  let dropSteps = 0;
  for (const step of steps) {
    if (step.begin < from || to <= step.begin) {
      continue;
    }
    items += step.items;
    if (step.yieldAt !== undefined && step.resumeAt !== undefined) {
      delays.push(step.resumeAt - step.yieldAt);
    }
    if (0 < step.dropped) {
      dropSteps += 1;
      const near = overlap(pieces, step.begin - 200, step.begin);
      for (const kind of ['busy', 'yield', 'dispatch', 'idle'] as const) {
        drops[kind] += near[kind];
      }
    }
  }
  const zeroTimers = timers.filter(
    (timer) => from <= timer.at && timer.at < to,
  ).length;
  const latencies: { at: number; ms: number }[] = [];
  for (let i = 0; i < events.count; i++) {
    if (from * 1e6 <= events.emit[i] && events.emit[i] < to * 1e6) {
      latencies.push({
        at: events.emit[i] / 1e6,
        ms: (events.ready[i] - events.emit[i]) / 1e6,
      });
    }
  }
  const sorted = sortedCopy(latencies.map((latency) => latency.ms));
  const threshold = quantile(sorted, 0.99);
  const spikes = latencies.filter((latency) => threshold <= latency.ms);
  const spike = { busy: 0, yield: 0, dispatch: 0, idle: 0 };
  let spikeMs = 0;
  for (const { at, ms } of spikes) {
    const part = overlap(pieces, at, at + ms);
    for (const kind of ['busy', 'yield', 'dispatch', 'idle'] as const) {
      spike[kind] += part[kind];
    }
    spikeMs += ms;
  }
  // 시간표가 덮는 구간만의 합
  // 측정 구간 밖으로 길게 이어진 지연은 종류별 비율의 분모에서 제외
  const spikeCovered = spike.busy + spike.yield + spike.dispatch + spike.idle;
  const delaySorted = sortedCopy(delays);
  const covered = total.busy + total.yield + total.dispatch + total.idle;
  return {
    yieldCount: delays.length,
    yieldDelayP50Ms: quantile(delaySorted, 0.5),
    yieldDelayP99Ms: quantile(delaySorted, 0.99),
    yieldDelayMaxMs: quantile(delaySorted, 1 - 1e-9),
    zeroTimers,
    unattributedZeroTimers: zeroTimers - delays.length,
    windowItems: items,
    perItemMs: 0 < items ? total.busy / items : 0,
    stepBusyMs: total.busy,
    yieldWaitMs: total.yield,
    dispatchGapMs: total.dispatch,
    idleGapMs: total.idle,
    uncoveredMs: to - from - covered,
    spikeEvents: spikes.length,
    spikeCoverage: 0 < spikeMs ? spikeCovered / spikeMs : 0,
    spikeBusyShare: 0 < spikeCovered ? spike.busy / spikeCovered : 0,
    spikeYieldShare: 0 < spikeCovered ? spike.yield / spikeCovered : 0,
    spikeDispatchShare: 0 < spikeCovered ? spike.dispatch / spikeCovered : 0,
    spikeIdleShare: 0 < spikeCovered ? spike.idle / spikeCovered : 0,
    // 가장 긴 지연 이벤트 5건의 구간 시작(ms)과 지연(ms)
    spikeTop: [...latencies]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map(({ at, ms }) => [Math.round(at - from), Math.round(ms)]),
    dropSteps,
    dropBusyMs: drops.busy,
    dropYieldMs: drops.yield,
    dropDispatchMs: drops.dispatch,
    dropIdleMs: drops.idle,
  };
}

// 결과 한 줄에 남기는 step 수의 상한
// step이 많은 조합의 한 줄이 지나치게 커지는 문제 방지
const stepLogLimit = 2000;

// 측정 구간 step의 구간 시작 기준 상대 시각(ms) 기록
// 한 step은 begin, end, items, dropped, firstEmit, yieldAt, resumeAt 순서의 7개 값
// 양보하지 않은 step의 yieldAt과 resumeAt은 null
// 상한을 넘으면 undefined
export function stepLog(steps: Step[], from: number, to: number) {
  const inside = steps.filter((step) => from <= step.begin && step.begin < to);
  if (stepLogLimit < inside.length) {
    return undefined;
  }
  const rel = (ms: number) => Math.round((ms - from) * 1000) / 1000;
  return inside.flatMap((step) => [
    rel(step.begin),
    rel(step.end),
    step.items,
    step.dropped,
    rel(step.firstEmit),
    step.yieldAt === undefined ? null : rel(step.yieldAt),
    step.resumeAt === undefined ? null : rel(step.resumeAt),
  ]);
}

// 측정 구간의 step 지표와 재계산 지표
export function stepMetrics(
  steps: Step[],
  bytes: number[],
  from: number,
  to: number,
  spans: number[],
) {
  const lengths: number[] = [];
  const sizes: number[] = [];
  const gaps: number[] = [];
  let over = 0;
  let one = 0;
  let renderInGap = 0;
  let cursor = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].begin < from || to <= steps[i].begin) {
      continue;
    }
    lengths.push(steps[i].end - steps[i].begin);
    sizes.push(bytes[i]);
    if (8 < steps[i].end - steps[i].begin) {
      over += 1;
    }
    if (steps[i].items === 1) {
      one += 1;
    }
    if (0 < i) {
      gaps.push(steps[i].begin - steps[i - 1].end);
      // 앞 step 끝과 이번 step 시작 사이 간격과 겹치는 렌더 구간의 합
      const gapFrom = steps[i - 1].end * 1e6;
      const gapTo = steps[i].begin * 1e6;
      while (cursor < spans.length && spans[cursor + 1] < gapFrom) {
        cursor += 2;
      }
      for (let k = cursor; k < spans.length && spans[k] < gapTo; k += 2) {
        renderInGap +=
          (Math.min(gapTo, spans[k + 1]) - Math.max(gapFrom, spans[k])) / 1e6;
      }
    }
  }
  const total = lengths.length;
  const lengthSorted = sortedCopy(lengths);
  const gapSorted = sortedCopy(gaps);
  return {
    steps: total,
    stepP50Ms: quantile(lengthSorted, 0.5),
    stepP99Ms: quantile(lengthSorted, 0.99),
    stepMaxMs: quantile(lengthSorted, 1 - 1e-9),
    stepOverBudgetRatio: total > 0 ? over / total : 0,
    oneItemStepRatio: total > 0 ? one / total : 0,
    stepBytesP99: quantile(sortedCopy(sizes), 0.99),
    gapP50Ms: quantile(gapSorted, 0.5),
    gapP99Ms: quantile(gapSorted, 0.99),
    renderInGapMs: renderInGap,
  };
}
