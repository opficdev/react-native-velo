import type { HybridObject } from 'react-native-nitro-modules';

/**
 * 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
 * 기능 구현은 2단계 예정
 */
export interface EventQueue extends HybridObject<{
  ios: 'c++';
  android: 'c++';
}> {}
