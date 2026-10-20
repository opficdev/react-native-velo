import { NitroModules } from 'react-native-nitro-modules';
import type { EventQueue } from './specs/event-queue.nitro';

export function createEventStream() {
  return NitroModules.createHybridObject<EventQueue>('EventQueue');
}
