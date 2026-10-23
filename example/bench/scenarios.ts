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

// slow는 이벤트마다 발행 간격의 handlerLoad배를 바쁜 대기로 쓰는 느린 소비자
export type Pattern = 'parse' | 'setState' | 'fixedCost' | 'slow';
// 센서는 작은 고정 크기, 오디오는 중간 크기의 고정 청크, 소켓은 크기가 섞인 로그정규형
// imu는 센서 샘플, pcm20과 pcm100은 48kHz 32비트 스테레오 PCM의 20ms와 100ms 청크
// feed는 중앙값 512B의 로그정규형 메시지, vga와 hd는 YUV420 프레임
export type Distribution =
  | 'sensor'
  | 'audio'
  | 'socket'
  | 'imu'
  | 'pcm20'
  | 'pcm100'
  | 'feed'
  | 'vga'
  | 'hd';

export interface ConsumerCase {
  pattern: Pattern;
  distribution: Distribution;
  // 묶음마다 쓰는 고정 비용(ms)
  // fixedCost만 0보다 큰 값
  batchMs: number;
  // 2초마다 JS 스레드를 막는 블록 부하(ms)
  // 0은 부하가 없는 경우
  busyMs: number;
  // 이 조합에만 적용하는 부하 배수
  loads?: number[];
  // 보정 속도 대신 쓰는 고정 발행 속도(초당)
  rate?: number;
  // slow 소비자의 핸들러 오버 정도
  // 이벤트 하나의 처리 시간을 발행 간격으로 나눈 값
  handlerLoad?: number;
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

function realistic(
  distribution: Distribution,
  rate: number,
  pattern: Pattern,
  batchMs = 0,
  busyMs = 0,
): ConsumerCase {
  return { pattern, distribution, batchMs, busyMs, rate, loads: [1] };
}

// 실제 앱의 이벤트 크기와 빈도로 정한 조합
// 근거는 Notion의 현실 빈도 재측정 기록
export const realisticCases: ConsumerCase[] = [
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('imu', 100, pattern),
  ),
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('imu', 200, pattern),
  ),
  realistic('imu', 200, 'fixedCost', 8),
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('imu', 1000, pattern),
  ),
  realistic('imu', 1000, 'fixedCost', 8),
  realistic('pcm20', 50, 'setState'),
  realistic('pcm20', 50, 'fixedCost', 8),
  realistic('pcm100', 10, 'setState'),
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('feed', 100, pattern),
  ),
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('feed', 1000, pattern),
  ),
  realistic('feed', 1000, 'fixedCost', 8),
  ...(['parse', 'setState'] as const).map((pattern) =>
    realistic('feed', 5000, pattern),
  ),
  realistic('vga', 30, 'setState'),
  realistic('hd', 30, 'setState'),
  ...[50, 200, 1000].map((busyMs) => realistic('imu', 200, 'parse', 0, busyMs)),
  ...[50, 200, 1000].map((busyMs) =>
    realistic('pcm20', 50, 'setState', 0, busyMs),
  ),
];

// 현실 빈도의 이벤트 종류와 발행 빈도
const realisticShapes: [Distribution, number][] = [
  ['imu', 100],
  ['imu', 200],
  ['imu', 1000],
  ['pcm20', 50],
  ['pcm100', 10],
  ['feed', 100],
  ['feed', 1000],
  ['feed', 5000],
  ['vga', 30],
  ['hd', 30],
];

// 핸들러 오버 정도의 단계
// 부하 시험 관행의 처리 능력 50%, 90%, 120%
export const handlerLoads = [0.5, 0.9, 1.2];

// JS 오버 정도의 단계(ms)
// Long Tasks 50ms, 정지 프레임 700ms, ANR 5초
export const jsBlocks = [50, 700, 5000];

// 가벼운 소비자
// JSON 페이로드는 parse, 바이너리 페이로드는 setState
function lightPattern(distribution: Distribution) {
  return distribution === 'imu' || distribution === 'feed'
    ? ('parse' as const)
    : ('setState' as const);
}

// 현실 빈도에서 JS 쪽이 따라가지 못하는 조합
// 이벤트 종류마다 핸들러 오버 정도와 JS 오버 정도를 따로 바꾸는 두 축
export const realisticOverloadCases: ConsumerCase[] = [
  ...realisticShapes.flatMap(([distribution, rate]) =>
    handlerLoads.map((handlerLoad) => ({
      ...realistic(distribution, rate, 'slow'),
      handlerLoad,
    })),
  ),
  ...realisticShapes.flatMap(([distribution, rate]) =>
    jsBlocks.map((busyMs) =>
      realistic(distribution, rate, lightPattern(distribution), 0, busyMs),
    ),
  ),
];

// slow 소비자가 이벤트마다 쓰는 시간(ns)
export function slowItemNs(item: ConsumerCase) {
  if (item.rate === undefined || item.handlerLoad === undefined) {
    throw new Error(
      `slow 소비자의 발행 속도나 오버 정도 없음 ${item.distribution}`,
    );
  }
  return (1e9 / item.rate) * item.handlerLoad;
}

// 보정 속도를 찾는 이름
// 블록 부하 조합이 공유하는 같은 조합의 보정 속도
export function rateId(item: ConsumerCase) {
  const base =
    item.pattern === 'fixedCost'
      ? `${item.pattern}-${item.batchMs}-${item.distribution}`
      : item.pattern === 'slow'
        ? `${item.pattern}-x${item.handlerLoad}-${item.distribution}`
        : `${item.pattern}-${item.distribution}`;
  return item.rate === undefined ? base : `${base}-r${item.rate}`;
}

export function caseId(item: ConsumerCase) {
  return 0 < item.busyMs ? `${rateId(item)}-busy${item.busyMs}` : rateId(item);
}

// 고정 크기 분포의 이벤트 크기
// pcm20은 48kHz 32비트 스테레오 20ms 960프레임, pcm100은 100ms 4800프레임
// vga는 640x480 YUV420, hd는 1280x720 YUV420
const fixedSizes: Partial<Record<Distribution, number>> = {
  imu: 128,
  pcm20: 7680,
  pcm100: 38400,
  vga: 460800,
  hd: 1382400,
};

// 분포별 이벤트 크기 표
// 센서 128B, 오디오 4KB, 소켓은 중앙값 4KB와 σ 1.0을 64B에서 1MB로 제한한 로그정규형
export function sizeTable(distribution: Distribution, random: () => number) {
  if (distribution === 'sensor') {
    return Int32Array.of(128);
  }
  if (distribution === 'audio') {
    return Int32Array.of(4 * KB);
  }
  const fixed = fixedSizes[distribution];
  if (fixed !== undefined) {
    return Int32Array.of(fixed);
  }
  // feed는 중앙값 512B와 상위 1% 약 16KB가 되는 σ 1.49
  const [median, sigma] = distribution === 'feed' ? [512, 1.49] : [4 * KB, 1];
  const table = new Int32Array(4096);
  for (let i = 0; i < table.length; i++) {
    const gauss =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    table[i] = Math.min(
      MB,
      Math.max(64, Math.round(median * Math.exp(sigma * gauss))),
    );
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
