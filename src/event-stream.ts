import { NitroModules } from 'react-native-nitro-modules';
import type { EventProducer } from './event-producer';
import type { EventQueue, PullResult } from './specs/event-queue.nitro';
import { subscribe } from './subscribe';

/**
 * 네이티브 이벤트를 묶음으로 전달하는 스트림
 */
export interface EventStream {
  // 스트림당 구독자 하나
  // 두 번째 호출은 오류
  // 반환값은 구독 해제 함수
  subscribe(onBatch: (batch: PullResult) => void): () => void;
  // 스트림당 생산자 하나
  // 연결 중 두 번째 호출은 오류
  // 반환값은 연결 해제 함수
  connect(producer: EventProducer): () => void;
}

export function createEventStream(): EventStream {
  const queue = NitroModules.createHybridObject<EventQueue>('EventQueue');
  let unsubscribe: (() => void) | undefined;
  let disconnect: (() => void) | undefined;

  return {
    subscribe(onBatch) {
      if (unsubscribe) {
        throw new Error('EventStream already has a subscriber');
      }
      const release = subscribe(queue, onBatch);
      const current = () => {
        release();
        // 이전 구독의 해제 함수가 새 구독을 지우는 문제 방지
        // 같은 구독일 때만 초기화
        if (unsubscribe === current) {
          unsubscribe = undefined;
        }
      };
      unsubscribe = current;
      return current;
    },
    connect(producer) {
      if (disconnect) {
        throw new Error('EventStream already has a producer');
      }
      // start 예외 시 연결 상태 미기록
      producer.start(queue);
      const current = () => {
        // 이미 해제했거나 이전 연결의 해제 함수면 무시
        if (disconnect !== current) {
          return;
        }
        // stop이 던져도 연결 상태는 초기화
        disconnect = undefined;
        producer.stop();
      };
      disconnect = current;
      return current;
    },
  };
}
