import type { BenchProducer } from 'example-producer';
import type { ConsumerCase } from '../scenarios';
import { slowItemNs } from '../scenarios';
import { createFixedCost } from './fixed-cost';
import { createParse } from './parse';
import { createSetState } from './set-state';
import type { Consumer, Dispatch } from './types';

// 상태를 갱신하는 패턴인지 여부
export function hasState(item: ConsumerCase) {
  return item.pattern === 'setState';
}

export function createConsumer(
  item: ConsumerCase,
  producer: BenchProducer,
  dispatch: Dispatch,
): Consumer & { failed?: number } {
  switch (item.pattern) {
    case 'parse':
      return createParse();
    case 'setState':
      return createSetState(dispatch);
    case 'fixedCost':
      return createFixedCost(producer, item.batchMs);
    case 'slow':
      return createFixedCost(producer, 0, slowItemNs(item));
  }
}
