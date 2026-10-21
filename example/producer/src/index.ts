import { NitroModules } from 'react-native-nitro-modules';
import type { EventProducer } from 'react-native-velo';
import type { BenchProducer } from './specs/bench-producer.nitro';
import type { ExampleProducer } from './specs/example-producer.nitro';

export type {
  BenchProducer,
  BenchStats,
  DeviceInfo,
  FrameRecord,
} from './specs/bench-producer.nitro';

export function createExampleProducer(): EventProducer {
  return NitroModules.createHybridObject<ExampleProducer>('ExampleProducer');
}

export function createBenchProducer(): BenchProducer {
  return NitroModules.createHybridObject<BenchProducer>('BenchProducer');
}
