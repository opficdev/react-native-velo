import { seqOf } from './decode';
import type { Consumer, Dispatch } from './types';

// 묶음마다 카운터 상태를 한 번 갱신하는 소비자
export function createSetState(dispatch: Dispatch): Consumer {
  let count = 0;
  let last = 0;
  return {
    onItem(item) {
      count += 1;
      last = seqOf(item);
    },
    onBatchEnd() {
      dispatch({ version: 0, count, last, sum: 0, rows: [] });
    },
  };
}
