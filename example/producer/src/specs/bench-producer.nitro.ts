import type { HybridObject } from 'react-native-nitro-modules';
import type { EventQueue } from 'react-native-velo/src/specs/event-queue.nitro';

/**
 * 생성기 한 번의 실행 통계
 */
export interface BenchStats {
  // 실행 전체의 발행 수
  emitted: number;
  // 측정 구간의 발행 수
  windowEmitted: number;
  // 측정 구간에서 예정보다 1ms 이상 늦게 발행한 수
  windowLate: number;
  // 측정 구간의 발행 호출 비용(ns)
  costP50Ns: number;
  costP99Ns: number;
  costMaxNs: number;
}

/**
 * 기기와 실행 환경 정보
 */
export interface DeviceInfo {
  model: string;
  osVersion: string;
  // 화면 최대 주사율(Hz)
  maxRefreshHz: number;
  // nominal, fair, serious, critical, unknown 중 하나
  thermalState: string;
  lowPowerMode: boolean;
  isSimulator: boolean;
}

/**
 * 프레임 기록 한 번의 결과
 */
export interface FrameRecord {
  // 메인 스레드 프레임 시각(ns)의 little endian Float64 배열
  times: ArrayBuffer;
  // 기록 중 가장 나빴던 열 상태
  thermalWorst: string;
  // 기록 용량을 넘겨 일부를 버렸는지 여부
  overflow: boolean;
  // 첫 프레임 콜백 시점의 시계와 프레임 시각 차이(ms)
  firstSkewMs: number;
}

/**
 * 일정한 속도로 이벤트를 만들어 큐 경로나 콜백 경로로 보내는 측정용 생산자
 * 페이로드 앞 16바이트는 발행 시각(ns)과 순번이며 둘 다 little endian Float64
 */
export interface BenchProducer extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // 다음 실행의 이벤트 크기(바이트), 초당 발행 수, 실행 시간(ms)
  configure(size: number, perSecond: number, durationMs: number): void;
  // 다음 실행의 이벤트 크기 표(little endian Int32 배열)와 JSON 채우기 여부
  // 순번을 표 길이로 나눈 나머지 위치의 크기 사용
  // 표는 비어 있지 않은 상태
  // 값은 18 이상인 상태
  // configure를 호출하면 고정 크기와 0x5A 채우기로 복귀
  configurePayload(sizes: ArrayBuffer, json: boolean): void;
  // 큐 경로 시작과 받은 큐에 대한 push
  start(stream: EventQueue): void;
  // 큐 경로 중단과 큐 참조 해제
  stop(): void;
  // 이벤트마다 콜백을 호출하는 콜백 경로 시작
  startCallback(onEvent: (data: ArrayBuffer) => void): void;
  // 콜백 경로 중단과 콜백 참조 해제
  stopCallback(): void;
  // 지정한 시간만큼 실행한 생성기가 끝났는지 여부
  finished(): boolean;
  // [fromNs, toNs) 구간에 발행한 이벤트의 통계
  readStats(fromNs: number, toNs: number): BenchStats;
  // 같은 크기의 소유 버퍼 count건을 한 번에 push
  burst(stream: EventQueue, size: number, count: number): void;
  // 미리 만든 소유 버퍼 count건을 소비자 없이 하나씩 push할 때 한 번의 중앙값 비용(ns)
  pushCost(stream: EventQueue, size: number, count: number): number;
  // 네이티브 단조 시계(ns)
  nowNs(): number;
  // 프로세스 메모리 사용량(바이트)
  memoryBytes(): number;
  // 메인 스레드 프레임 시각 기록 시작과 이전 기록 폐기
  startFrames(): void;
  // 프레임 시각 기록 중단
  stopFrames(): void;
  // 기록한 프레임 시각의 소유 버퍼와 부가 정보
  readFrames(): FrameRecord;
  // 기기와 실행 환경 정보
  deviceInfo(): DeviceInfo;
  // 결과 한 줄을 앱 파일에 추가
  appendResult(line: string): void;
}
