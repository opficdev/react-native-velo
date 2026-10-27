import { createPullStep } from './pull-step';
import type { EventQueue, PullResult } from './specs/event-queue.nitro';

/**
 * 신호마다 pull 한 번으로 큐를 처리하는 Android 구독
 * Android의 타이머와 렌더 작업은 신호 처리 사이에 끼어들어 실행되므로 양보 없음
 * 반환값은 구독 해제 함수
 */
export function subscribe(
  queue: EventQueue,
  onBatch: (batch: PullResult) => void,
) {
  let active = true;
  const step = createPullStep(queue, onBatch);

  queue.setSignalListener(() => {
    // 해제 뒤에 도착한 신호는 무시
    // 남은 항목은 코어의 신호 재전송으로 처리
    if (active) {
      step();
    }
  });

  return () => {
    if (!active) {
      return;
    }
    active = false;
    queue.setSignalListener();
  };
}
