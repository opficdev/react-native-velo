import { NitroModules } from 'react-native-nitro-modules';
import type { EventQueue } from './specs/event-queue.nitro';

export type { EventQueue };

export function createVeloStream() {
  return NitroModules.createHybridObject<EventQueue>('EventQueue');
}
