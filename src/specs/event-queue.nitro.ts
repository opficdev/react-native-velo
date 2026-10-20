import type { HybridObject } from 'react-native-nitro-modules';

/**
 * 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림이다.
 * 기능은 2단계에서 채운다.
 */
export interface EventQueue extends HybridObject<{
  ios: 'c++';
  android: 'c++';
}> {}
