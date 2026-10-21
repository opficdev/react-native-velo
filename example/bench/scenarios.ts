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

export type Pattern = 'parse' | 'setState' | 'fixedCost';
// 센서는 작은 고정 크기, 오디오는 중간 크기의 고정 청크, 소켓은 크기가 섞인 로그정규형
export type Distribution = 'sensor' | 'audio' | 'socket';

export interface ConsumerCase {
  pattern: Pattern;
  distribution: Distribution;
  // 묶음마다 쓰는 고정 비용(ms)이며 fixedCost만 0보다 큼
  batchMs: number;
  // 2초마다 JS 스레드를 이만큼(ms) 막는 블록 부하이며 0이면 없음
  busyMs: number;
  // 이 조합에만 적용하는 부하 배수
  loads?: number[];
}

// 부하 배수
export const loads = [0.5, 0.9, 1.2];

// fixedCost 소비자가 이벤트마다 쓰는 시간(ns)
export const itemNs = 100_000;

// 블록 부하를 넣는 간격(ms)
export const busyPeriodMs = 2000;

const sensor = 'sensor' as const;
const audio = 'audio' as const;
const socket = 'socket' as const;

export const consumerCases: ConsumerCase[] = [
  ...[sensor, audio, socket].map((distribution) => ({
    pattern: 'parse' as const,
    distribution,
    batchMs: 0,
    busyMs: 0,
  })),
  ...[sensor, socket].map((distribution) => ({
    pattern: 'setState' as const,
    distribution,
    batchMs: 0,
    busyMs: 0,
  })),
  ...[8, 16].map((batchMs) => ({
    pattern: 'fixedCost' as const,
    distribution: sensor,
    batchMs,
    busyMs: 0,
  })),
  ...[sensor, audio].flatMap((distribution) =>
    [50, 200, 1000].map((busyMs) => ({
      pattern: 'parse' as const,
      distribution,
      batchMs: 0,
      busyMs,
      loads: [0.9],
    })),
  ),
];

// 보정 속도를 찾는 이름이며 블록 부하는 같은 조합의 보정 속도를 씀
export function rateId(item: ConsumerCase) {
  return item.pattern === 'fixedCost'
    ? `${item.pattern}-${item.batchMs}-${item.distribution}`
    : `${item.pattern}-${item.distribution}`;
}

export function caseId(item: ConsumerCase) {
  return 0 < item.busyMs ? `${rateId(item)}-busy${item.busyMs}` : rateId(item);
}

// 분포별 이벤트 크기 표
// 센서 128B, 오디오 4KB, 소켓은 중앙값 4KB와 σ 1.0을 64B에서 1MB로 제한한 로그정규형
export function sizeTable(distribution: Distribution, random: () => number) {
  if (distribution === 'sensor') {
    return Int32Array.of(128);
  }
  if (distribution === 'audio') {
    return Int32Array.of(4 * KB);
  }
  const table = new Int32Array(4096);
  for (let i = 0; i < table.length; i++) {
    const gauss =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    table[i] = Math.min(MB, Math.max(64, Math.round(4 * KB * Math.exp(gauss))));
  }
  return table;
}

export function meanSize(table: Int32Array) {
  let sum = 0;
  for (const size of table) {
    sum += size;
  }
  return sum / table.length;
}
