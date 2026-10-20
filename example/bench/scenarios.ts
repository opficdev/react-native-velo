export type BenchPath = 'B' | 'Q';
export type Consumer = 'fast' | 'slow' | 'overload';

export interface Scenario {
  // 이벤트 크기(바이트)
  size: number;
  // 초당 발행 수
  rate: number;
  consumer: Consumer;
}

const KB = 1024;
const MB = 1024 * KB;

// 02. 기준선 측정의 경로 B 시나리오 14개
export const scenarios: Scenario[] = [
  { size: KB, rate: 5000, consumer: 'fast' },
  { size: KB, rate: 5000, consumer: 'slow' },
  { size: KB, rate: 20000, consumer: 'fast' },
  { size: KB, rate: 5000, consumer: 'overload' },
  { size: 64 * KB, rate: 500, consumer: 'fast' },
  { size: 64 * KB, rate: 500, consumer: 'slow' },
  { size: 64 * KB, rate: 1000, consumer: 'fast' },
  { size: 64 * KB, rate: 2000, consumer: 'fast' },
  { size: 64 * KB, rate: 500, consumer: 'overload' },
  { size: MB, rate: 50, consumer: 'fast' },
  { size: MB, rate: 50, consumer: 'slow' },
  { size: MB, rate: 100, consumer: 'fast' },
  { size: MB, rate: 200, consumer: 'fast' },
  { size: MB, rate: 50, consumer: 'overload' },
];

// 소비자가 이벤트마다 바쁜 대기로 쓰는 시간(ns)
export function workNs(scenario: Scenario) {
  const interval = 1e9 / scenario.rate;
  if (scenario.consumer === 'slow') {
    return interval * 0.5;
  }
  if (scenario.consumer === 'overload') {
    return interval * 1.2;
  }
  return 0;
}
