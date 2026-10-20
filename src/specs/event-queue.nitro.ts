import type { HybridObject } from 'react-native-nitro-modules';

/**
 * pull이 돌려주는 묶음
 */
export interface PullResult {
  // 큐에서 꺼낸 항목
  items: ArrayBuffer[];
  // 직전 pull 이후 버린 건수
  dropped: number;
}

/**
 * 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
 */
export interface EventQueue extends HybridObject<{
  ios: 'swift';
  android: 'c++';
}> {
  // 가져갈 항목이 생겼음을 알리는 신호 콜백 등록
  // 인자를 생략하면 등록 해제
  setSignalListener(listener?: () => void): void;
  // 앞에서부터 최대 maxCount건을 꺼내는 호출
  pull(maxCount: number): PullResult;
  // 네이티브 생산자의 큐 입력 호출
  push(data: ArrayBuffer): void;
}
