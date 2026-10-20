import type { EventQueue } from './specs/event-queue.nitro';

/**
 * 스트림에 데이터를 넣는 네이티브 생산자의 인터페이스
 */
export interface EventProducer {
  // 스트림 연결 직후의 호출
  // 생산자는 받은 스트림에 직접 push
  start(stream: EventQueue): void;
  // 연결 해제 시점의 호출
  // 생산 중단과 받은 스트림 참조의 해제
  stop(): void;
}
