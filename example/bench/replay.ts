import { quantile, sortedCopy } from './stats';

// src/subscribe.ts의 상수와 같은 값
// 라이브러리 상수가 export되지 않아 둔 복제본
// 값이 바뀔 때 함께 수정할 대상
const pullCount = 64;
const budgetMs = 8;
const sustainMs = 100;
const waitFactor = 2;
const maxLimitMs = 32;
const idleResetMs = 2;
// 두 표본의 건수 차이가 이 값 이상이면 기울기를 구하는 기준
const sampleGap = 16;
// 두 표본의 처리 시간 비가 이 값 이상이면 기울기를 구하는 기준
const sampleRatio = 2;
// 측정 시간이 예측의 이 배수를 넘거나 역수에 못 미치면 기울기를 버리는 기준
const missRatio = 2;
// 늘려서 두 번째 표본을 얻거나 다시 확인할 때의 건수 배수
const growFactor = 4;
// 가득 찬 step이 이 횟수만큼 이어지면 건수를 늘려 다시 확인하는 주기
const recheckSteps = 64;
// 늘린 step의 예상 시간이 이 값(ms)을 넘으면 늘리지 않는 상한
const recheckLimitMs = 128;
// 예측과 측정이 모두 이 값(ms) 미만이면 판정하지 않는 기준
const resolutionMs = 2;

// 한 step의 건수와 처리 시간(ms)
interface Sample {
  items: number;
  ms: number;
}

// 구독 안에서만 유지하는 건수 추정 상태
// 처리 시간을 fixedMs + marginMs × 건수로 보는 모델
interface Pace {
  last: Sample | undefined;
  requested: number;
  marginMs: number | undefined;
  fixedMs: number;
  growing: boolean;
  checking: boolean;
  checkIn: number;
}

const newPace = (): Pace => ({
  last: undefined,
  requested: 0,
  marginMs: undefined,
  fixedMs: 0,
  growing: false,
  checking: false,
  checkIn: recheckSteps,
});

const clampCount = (count: number) => Math.min(pullCount, Math.max(1, count));

// 건수가 다르면서 건수나 시간이 충분히 다른 두 표본
const differs = (a: Sample, b: Sample) =>
  a.items !== b.items &&
  (sampleGap <= Math.abs(a.items - b.items) ||
    sampleRatio * Math.min(a.ms, b.ms) <= Math.max(a.ms, b.ms));

// 두 표본의 기울기를 marginMs로 확정
// 두 표본의 건당 평균 이하로 제한한 기울기
// 0 이하인 기울기는 확정 제외
function fit(pace: Pace, a: Sample, b: Sample) {
  const slope = Math.min(
    (b.ms - a.ms) / (b.items - a.items),
    a.ms / a.items,
    b.ms / b.items,
  );
  if (slope <= 0) {
    return;
  }
  pace.marginMs = slope;
  pace.fixedMs = b.ms - slope * b.items;
  pace.growing = false;
  pace.checkIn = recheckSteps;
}

// 다음 pull의 건수
// 기울기가 있으면 남은 시간과 무관하게 limitMs 안에 들어가는 건수
function decide(pace: Pace, limitMs: number) {
  pace.checking = false;
  const { last, requested, marginMs } = pace;
  if (marginMs !== undefined) {
    const count = clampCount(Math.floor(limitMs / marginMs));
    if (pace.checkIn <= 0 && count < pullCount) {
      const grown = Math.min(pullCount, count * growFactor);
      if (pace.fixedMs + marginMs * grown <= recheckLimitMs) {
        pace.checking = true;
        return grown;
      }
    }
    return count;
  }
  if (last === undefined) {
    return pullCount;
  }
  // 기울기를 구하기 전에는 고정 비용이 없다고 보는 평균
  const average = last.ms / last.items;
  const count =
    average <= 0 ? pullCount : clampCount(Math.floor(limitMs / average));
  // 기울기를 구하지 못한 채 가득 찬 step이 이어질 때 두 번째 표본을 얻기 위한 건수 증가
  if (!pace.growing) {
    return count;
  }
  const grown = Math.min(pullCount, requested * growFactor);
  return recheckLimitMs < grown * average ? count : grown;
}

// 끝까지 처리한 step의 표본 반영
function record(pace: Pace, count: number, items: number, ms: number) {
  const cur = { items, ms };
  const { last, marginMs } = pace;
  pace.requested = count;
  if (count <= items) {
    pace.checkIn -= 1;
  }
  if (marginMs !== undefined) {
    const predicted = pace.fixedMs + marginMs * items;
    const judged = resolutionMs <= Math.max(predicted, ms);
    if (judged && (missRatio * predicted < ms || missRatio * ms < predicted)) {
      pace.marginMs = undefined;
      pace.checkIn = recheckSteps;
    } else if (pace.checking && last !== undefined && differs(last, cur)) {
      fit(pace, last, cur);
    }
  } else {
    if (last !== undefined && differs(last, cur)) {
      fit(pace, last, cur);
    }
    // 기울기를 구하지 못했고 요청한 건수가 모두 나온 step은 적체가 있는 것
    pace.growing =
      pace.marginMs === undefined && count <= items && count < pullCount;
  }
  if (pace.checking) {
    pace.checking = false;
    pace.checkIn = recheckSteps;
  }
  pace.last = cur;
}

// onBatch 한 번의 기록(ms)
export interface Step {
  begin: number;
  end: number;
  items: number;
}

// step 기록으로 subscribe의 내부 상태를 다시 계산한 결과
// 단순화: 앞 step 직후에 신호가 오고 양보하면 그 간격을 대기 시간으로 보는 가정
// 기록되지 않아 표본의 처리 시간에서 빠지는 pull 시간
// 기록되지 않아 표본에서 제외되지 않는 onBatch 예외 step
export function replaySubscribe(steps: Step[]) {
  let spent = 0;
  let limitMs = budgetMs;
  let waitMs = 0;
  let lastEnd = -Infinity;
  let backlogSince: number | undefined;
  const pace = newPace();
  let mismatch = 0;
  const reset = () => {
    spent = 0;
    limitMs = budgetMs;
    waitMs = 0;
    backlogSince = undefined;
  };
  return steps.map((step) => {
    let yielded = false;
    if (
      limitMs <= spent &&
      backlogSince !== undefined &&
      sustainMs <= lastEnd - backlogSince
    ) {
      yielded = true;
      waitMs = (waitMs + step.begin - lastEnd) / 2;
      limitMs = Math.min(maxLimitMs, Math.max(budgetMs, waitFactor * waitMs));
      spent = 0;
    } else {
      if (idleResetMs <= step.begin - lastEnd) {
        reset();
      }
      if (limitMs <= spent) {
        spent = 0;
      }
    }
    const count = decide(pace, limitMs);
    if (count < step.items) {
      mismatch += 1;
    }
    const elapsed = step.end - step.begin;
    if (0 < step.items) {
      record(pace, count, step.items, elapsed);
    }
    lastEnd = step.end;
    if (step.items < count) {
      reset();
    } else {
      spent += elapsed;
      backlogSince ??= step.begin;
    }
    return { count, yielded, waitMs, limitMs, mismatch };
  });
}

// 측정 구간의 step 지표와 재계산 지표
export function stepMetrics(
  steps: Step[],
  bytes: number[],
  from: number,
  to: number,
  spans: number[],
) {
  const replay = replaySubscribe(steps);
  const lengths: number[] = [];
  const sizes: number[] = [];
  const gaps: number[] = [];
  const waits: number[] = [];
  const limits: number[] = [];
  const counts: number[] = [];
  let over = 0;
  let one = 0;
  let yields = 0;
  let renderInGap = 0;
  let cursor = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].begin < from || to <= steps[i].begin) {
      continue;
    }
    lengths.push(steps[i].end - steps[i].begin);
    sizes.push(bytes[i]);
    counts.push(replay[i].count);
    limits.push(replay[i].limitMs);
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
    if (replay[i].yielded) {
      yields += 1;
      waits.push(replay[i].waitMs);
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
    replayCountP50: quantile(sortedCopy(counts), 0.5),
    replayYields: yields,
    replayWaitP50Ms: quantile(sortedCopy(waits), 0.5),
    replayLimitP99Ms: quantile(sortedCopy(limits), 0.99),
    replayMismatch: replay.length > 0 ? replay[replay.length - 1].mismatch : 0,
    renderInGapMs: renderInGap,
  };
}
