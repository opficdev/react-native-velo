import type { BenchProducer } from 'example-producer';
import { itemNs } from '../scenarios';
import type { Consumer } from './types';

// 묶음마다 고정 시간과 이벤트마다 일정 시간을 바쁜 대기로 쓰는 합성 소비자
// 경로 B의 단건 전달에서 제외하는 묶음 고정 시간
export function createFixedCost(
  producer: BenchProducer,
  batchMs: number,
): Consumer {
  const spin = (ns: number) => {
    const until = producer.nowNs() + ns;
    while (producer.nowNs() < until) {
      // 바쁜 대기
    }
  };
  return {
    onItem() {
      spin(itemNs);
    },
    onBatchEnd(single) {
      if (!single) {
        spin(batchMs * 1e6);
      }
    },
  };
}
