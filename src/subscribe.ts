import { Platform } from 'react-native';
import { subscribe as subscribeAndroid } from './subscribe-android';
import { subscribe as subscribeIos } from './subscribe-ios';

/**
 * 플랫폼별 구독 구현 선택
 * 알 수 없는 OS는 iOS 구현 사용
 */
export const subscribe =
  Platform.OS === 'android' ? subscribeAndroid : subscribeIos;
