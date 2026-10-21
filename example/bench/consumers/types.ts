// 목록에 보이는 행 수
export const rowLimit = 20;

export interface Row {
  seq: number;
  text: string;
}

// 소비자가 묶음마다 상태에 반영하는 값
export interface Action {
  // 프로브가 붙이는 dispatch 순번
  version: number;
  count: number;
  last: number;
  sum: number;
  rows: Row[];
}

export type Dispatch = (action: Action) => void;

export interface Consumer {
  // 이벤트 한 건의 처리
  onItem(item: ArrayBuffer): void;
  // 묶음의 끝 처리
  // 경로 B에서 이벤트마다 single이 true인 경우
  onBatchEnd(single: boolean): void;
}
