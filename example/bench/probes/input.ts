import type { BenchProducer } from 'example-producer';
import { quantile, sortedCopy } from '../stats';

// 터치 이벤트 시각과 JS 핸들러 호출 시각의 차이를 기록하는 프로브
export class InputProbe {
  private from = 0;
  private to = 0;
  private latencies: number[] = [];

  constructor(private producer: BenchProducer) {}

  // 측정 구간 설정과 이전 기록 폐기
  begin(from: number, to: number) {
    this.from = from;
    this.to = to;
    this.latencies = [];
  }

  // 터치 시각(ms)을 받아 구간 안이면 지연 기록
  record(timestampMs: number) {
    const now = this.producer.nowNs();
    if (this.from <= now && now < this.to) {
      this.latencies.push(now / 1e6 - timestampMs);
    }
  }

  summary() {
    const sorted = sortedCopy(this.latencies);
    return {
      inputCount: sorted.length,
      inputP50Ms: quantile(sorted, 0.5),
      inputP99Ms: quantile(sorted, 0.99),
      inputMaxMs: quantile(sorted, 1 - 1e-9),
    };
  }
}
