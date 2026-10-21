import type { EventQueue, PullResult } from './specs/event-queue.nitro';

// pull 한 번에 가져가는 최대 건수이자 첫 step의 건수
const pullCount = 64;
// 양보 없이 이어서 처리하는 누적 시간(ms)
const budgetMs = 8;
// 큐가 비지 않은 채 이어진 시간(ms)이 이 값에 닿아야 양보하는 기준
const sustainMs = 100;
// 양보 대기 시간 대비 이어서 처리하는 시간의 배수
const waitFactor = 2;

/**
 * 신호마다 pull 한 번으로 큐를 비우고 처리 시간이 budgetMs에 닿으면 양보하는 구독
 * 직전 step의 건당 처리 시간으로 pull 건수를 정하는 방식
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
  let backlogSince: number | undefined;
  let perItemMs: number | undefined;

  const step = () => {
    const start = Date.now();
    // 남은 처리 시간 안에 들어가는 건수
    // 1건 이상 pullCount건 이하
    const count =
      perItemMs === undefined
        ? pullCount
        : Math.min(
            pullCount,
            Math.max(1, Math.floor((limitMs - spent) / perItemMs)),
          );
    const result = queue.pull(count);
    try {
      if (result.items.length > 0 || result.dropped > 0) {
        onBatch(result);
      }
    } finally {
      const elapsed = Date.now() - start;
      if (result.items.length > 0) {
        perItemMs = elapsed / result.items.length;
      }
      if (result.items.length < count) {
        // 요청한 건수보다 적게 나오면 큐가 빈 것이므로 누적 시간 초기화
        spent = 0;
        backlogSince = undefined;
      } else {
        spent += elapsed;
        backlogSince ??= start;
      }
    }
  };

  const resume = () => {
    timer = undefined;
    // 양보 대기가 길수록 이어서 처리하는 시간을 늘림
    waitMs = (waitMs + Date.now() - yieldAt) / 2;
    limitMs = Math.max(budgetMs, waitFactor * waitMs);
    spent = 0;
    step();
  };

  queue.setSignalListener(() => {
    // 해제 뒤에 도착한 신호와 양보 중인 신호는 무시
    // 남은 항목은 resume의 pull 뒤 코어의 신호 재전송으로 처리
    if (!active || timer !== undefined) {
      return;
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
