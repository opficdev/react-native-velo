import type { EventQueue, PullResult } from './specs/event-queue.nitro';

// pull 한 번에 가져가는 최대 건수
const pullCount = 64;
// 양보 없이 이어서 처리하는 누적 시간(ms)
const budgetMs = 8;

/**
 * 신호마다 pull 한 번으로 큐를 비우고 처리 시간이 budgetMs에 닿으면 양보하는 구독
 * 반환값은 구독 해제 함수
 */
export function subscribe(
  queue: EventQueue,
  onBatch: (batch: PullResult) => void,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spent = 0;

  const step = () => {
    const start = Date.now();
    const result = queue.pull(pullCount);
    try {
      if (result.items.length > 0 || result.dropped > 0) {
        onBatch(result);
      }
    } finally {
      // pullCount보다 적게 나오면 큐가 빈 것이므로 누적 시간 초기화
      spent =
        result.items.length < pullCount ? 0 : spent + (Date.now() - start);
    }
  };

  const resume = () => {
    timer = undefined;
    spent = 0;
    step();
  };

  queue.setSignalListener(() => {
    // 해제 뒤에 도착한 신호와 양보 중인 신호는 무시
    // 남은 항목은 resume의 pull 뒤에 코어가 다시 알림
    if (!active || timer !== undefined) {
      return;
    }
    if (spent < budgetMs) {
      step();
      return;
    }
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
