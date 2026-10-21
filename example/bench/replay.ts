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

// onBatch 한 번의 기록(ms)
export interface Step {
  begin: number;
  end: number;
  items: number;
}

// step 기록으로 subscribe의 내부 상태를 다시 계산한 결과
// 단순화: 앞 step 직후에 신호가 오고 양보하면 그 간격을 대기 시간으로 보는 가정
// 기록되지 않아 건당 처리 시간에서 빠지는 pull 시간
export function replaySubscribe(steps: Step[]) {
  let spent = 0;
  let limitMs = budgetMs;
  let waitMs = 0;
  let lastEnd = -Infinity;
  let backlogSince: number | undefined;
  let perItemMs: number | undefined;
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
    const count =
      perItemMs === undefined
        ? pullCount
        : Math.min(
            pullCount,
            Math.max(1, Math.floor((limitMs - spent) / perItemMs)),
          );
    if (count < step.items) {
      mismatch += 1;
    }
    const elapsed = step.end - step.begin;
    if (0 < step.items) {
      perItemMs = elapsed / step.items;
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
