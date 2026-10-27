import { createPullStep } from './pull-step';
import type { EventQueue, PullResult } from './specs/event-queue.nitro';

// 프레임 한 번에 pull을 이어서 처리하는 시간 한도(ms)
const frameBudgetMs = 14;

/**
 * 신호마다 프레임을 한 번 예약하고 프레임마다 시간 한도 안에서 pull을 이어서 처리하는 iOS 구독
 * iOS의 타이머는 JS 스레드 run loop에서 호출되므로 프레임마다 이벤트 루프로 반환
 * 반환값은 구독 해제 함수
 */
export function subscribe(
  queue: EventQueue,
  onBatch: (batch: PullResult) => void,
) {
  let active = true;
  let frame: number | undefined;
  const step = createPullStep(queue, onBatch);

  const run = () => {
    frame = undefined;
    const begin = Date.now();
    // 큐가 비었거나 시간 한도에 닿을 때까지 반복
    // 남은 항목은 마지막 pull의 신호 재전송으로 다음 프레임에 처리
    while (!step() && Date.now() - begin < frameBudgetMs) {
      // 반복 본문 없음
    }
  };

  queue.setSignalListener(() => {
    // 해제 뒤에 도착한 신호와 프레임이 이미 예약된 신호는 무시
    if (active && frame === undefined) {
      frame = requestAnimationFrame(run);
    }
  });

  return () => {
    if (!active) {
      return;
    }
    active = false;
    queue.setSignalListener();
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
  };
}
