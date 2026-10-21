import { AppState } from 'react-native';

// 앱이 active가 아니게 되면 취소 표시를 남기는 프로브
export function watchAppState() {
  const state = { cancelled: AppState.currentState !== 'active' };
  const subscription = AppState.addEventListener('change', (next) => {
    if (next !== 'active') {
      state.cancelled = true;
    }
  });
  return {
    state,
    stop: () => subscription.remove(),
  };
}
