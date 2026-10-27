import type { EventQueue, PullResult } from './specs/event-queue.nitro';

// pull 한 번에 가져가는 최대 건수이자 첫 step의 건수
const pullCount = 64;
// step 하나가 pull 건수 계산에 쓰는 처리 시간 한도(ms)
export const budgetMs = 8;
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
// 기울기가 있으면 limitMs 안에 들어가는 건수
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
  if (count <= items && count < pullCount) {
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

/**
 * 처리 시간으로 건수를 정해 pull 한 번과 onBatch 한 번을 실행하는 step 생성
 * 건수 추정 상태는 step 안에서만 유지
 * 반환값은 step이고 요청한 건수보다 적게 나와 큐가 비었으면 true
 */
export function createPullStep(
  queue: EventQueue,
  onBatch: (batch: PullResult) => void,
) {
  const pace = newPace();
  return () => {
    const start = Date.now();
    // 1건 이상 pullCount건 이하
    const count = decide(pace, budgetMs);
    const result = queue.pull(count);
    let done = false;
    try {
      if (result.items.length > 0 || result.dropped > 0) {
        onBatch(result);
      }
      done = true;
    } finally {
      // onBatch가 예외로 끝난 step은 표본에서 제외
      if (done && result.items.length > 0) {
        record(pace, count, result.items.length, Date.now() - start);
      }
    }
    return result.items.length < count;
  };
}
