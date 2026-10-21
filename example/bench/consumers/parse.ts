import { decode } from './decode';
import type { Consumer } from './types';

// 페이로드를 문자열로 바꿔 JSON으로 파싱만 하는 소비자
export function createParse(): Consumer & { parsed: number; failed: number } {
  const consumer = {
    parsed: 0,
    failed: 0,
    onItem(item: ArrayBuffer) {
      try {
        consumer.parsed += (JSON.parse(decode(item)) as unknown[]).length;
      } catch {
        consumer.failed += 1;
      }
    },
    onBatchEnd() {},
  };
  return consumer;
}
