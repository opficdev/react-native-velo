import type { BenchProducer } from 'example-producer';
import { busyPeriodMs } from '../scenarios';

// 일정 간격으로 JS 스레드를 바쁜 대기로 막는 부하
// 반환 함수는 부하 중단
export function startBusy(producer: BenchProducer, busyMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  const block = () => {
    if (!active) {
      return;
    }
    const until = producer.nowNs() + busyMs * 1e6;
    while (producer.nowNs() < until) {
      // 바쁜 대기
    }
    timer = setTimeout(block, busyPeriodMs);
  };
  timer = setTimeout(block, busyPeriodMs);
  return () => {
    active = false;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
