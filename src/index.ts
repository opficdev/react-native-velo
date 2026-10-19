import { NitroModules } from 'react-native-nitro-modules';
import type { VeloStream } from './specs/velo-stream.nitro';

export type { VeloStream };

export function createVeloStream() {
  return NitroModules.createHybridObject<VeloStream>('VeloStream');
}
