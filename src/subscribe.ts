import type { EventQueue, PullResult } from './specs/event-queue.nitro';

// pull 한 번에 가져가는 최대 건수이자 첫 step의 건수
const pullCount = 64;
// 양보 없이 이어서 처리하는 누적 시간(ms)
const budgetMs = 8;
// 큐가 비지 않은 채 이어진 시간(ms)이 이 값에 닿아야 양보하는 기준
const sustainMs = 100;
// 양보 대기 시간의 이동 평균 대비 이어서 처리하는 시간의 배수
const waitFactor = 2;
// 이어서 처리하는 시간의 상한(ms)
const maxLimitMs = 32;
// 마지막 step 이후 이 시간(ms) 이상 쉬었을 때 적체가 끝난 것으로 보는 기준
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
 * 신호마다 pull 한 번으로 큐를 비우고 처리 시간이 이어서 처리하는 시간에 닿으면 양보하는 구독
 * 처리 시간에서 배치 고정 비용을 뺀 건당 증가 시간으로 pull 건수를 정하는 방식
 * 큐가 sustainMs 이상 비지 않은 경우에만 양보
 * 반환값은 구독 해제 함수
 */
export function subscribe(
  queue: EventQueue,
  onBatch: (batch: PullResult) => void,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spent = 0;
  let limitMs = budgetMs;
  let waitMs = 0;
  let yieldAt = 0;
  let lastEnd = 0;
  let backlogSince: number | undefined;
  const pace = newPace();

  const reset = () => {
    spent = 0;
    limitMs = budgetMs;
    waitMs = 0;
    backlogSince = undefined;
  };

  const step = () => {
    const start = Date.now();
    // 1건 이상 pullCount건 이하
    const count = decide(pace, limitMs);
    const result = queue.pull(count);
    let done = false;
    try {
      if (result.items.length > 0 || result.dropped > 0) {
        onBatch(result);
      }
      done = true;
    } finally {
      lastEnd = Date.now();
      const elapsed = lastEnd - start;
      // onBatch가 예외로 끝난 step은 표본에서 제외
      if (done && result.items.length > 0) {
        record(pace, count, result.items.length, elapsed);
      }
      if (result.items.length < count) {
        // 요청한 건수보다 적게 나오면 큐가 빈 것이므로 적체 종료
        reset();
      } else {
        spent += elapsed;
        backlogSince ??= start;
      }
    }
  };

  const resume = () => {
    timer = undefined;
    // 직전 평균과 이번 양보 대기의 반반 평균
    // 대기가 길수록 늘어나는 이어서 처리하는 시간
    waitMs = (waitMs + Date.now() - yieldAt) / 2;
    limitMs = Math.min(maxLimitMs, Math.max(budgetMs, waitFactor * waitMs));
    spent = 0;
    step();
  };

  queue.setSignalListener(() => {
    // 해제 뒤에 도착한 신호와 양보 중인 신호는 무시
    // 남은 항목은 resume의 pull 뒤 코어의 신호 재전송으로 처리
    if (!active || timer !== undefined) {
      return;
    }
    // 마지막 step 이후 쉬었다면 적체 종료
    if (idleResetMs <= Date.now() - lastEnd) {
      reset();
    }
    if (spent < limitMs) {
      step();
      return;
    }
    // 잠깐 쌓인 경우는 양보 없이 이어서 처리
    if (backlogSince === undefined || Date.now() - backlogSince < sustainMs) {
      spent = 0;
      step();
      return;
    }
    yieldAt = Date.now();
    timer = setTimeout(resume, 0);
  });

  return () => {
    if (!active) {
      return;
    }
    active = false;
    queue.setSignalListener();
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
