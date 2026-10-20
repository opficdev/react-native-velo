import { NitroModules } from 'react-native-nitro-modules';
import type { EventProducer } from 'react-native-velo';
import type { ExampleProducer } from './specs/example-producer.nitro';

export function createExampleProducer(): EventProducer {
  return NitroModules.createHybridObject<ExampleProducer>('ExampleProducer');
}
