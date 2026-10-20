import type { BenchProducer } from 'example-producer';
import { NitroModules } from 'react-native-nitro-modules';
import type { EventQueue } from 'react-native-velo/src/specs/event-queue.nitro';
import type { Progress } from './runner';
import { median, quantile, sortedCopy } from './stats';

const KB = 1024;
const MiB = 1024 * KB;
const repeats = 7;
const counts = [1, 8, 16, 32, 64, 128, 256, 512, 1024];

const newQueue = () =>
  NitroModules.createHybridObject<EventQueue>('EventQueue');

// 사전 충전한 큐에서 pull(n) 한 번의 비용을 건별 전달과 덩어리 전달로 비교
export async function runSweep(producer: BenchProducer, onProgress: Progress) {
  for (const size of [KB, 64 * KB, MiB]) {
    // 큐 제한 16 MiB와 1024건 안에 들어가는 건수
    const total = Math.min(1024, Math.floor((15 * MiB) / size));
    for (const n of counts.filter((count) => count <= total)) {
      onProgress(`sweep ${size}B pull(${n})`);
      const pullNs: number[] = [];
      const perItemNs: number[] = [];
      const chunkPullNs: number[] = [];
      const pushNs: number[] = [];
      const fillNs: number[] = [];
      const chunkFillNs: number[] = [];
      for (let rep = 0; rep < repeats; rep++) {
        const queue = newQueue();
        const fillBegin = producer.nowNs();
        producer.burst(queue, size, total);
        fillNs.push(producer.nowNs() - fillBegin);
        // 소비자와 신호가 없는 큐에 미리 만든 버퍼를 넣는 push 한 번의 비용
        pushNs.push(producer.pushCost(newQueue(), size, total));
        let left = total;
        while (0 < left) {
          const begin = producer.nowNs();
          const result = queue.pull(n);
          const cost = producer.nowNs() - begin;
          pullNs.push(cost);
          perItemNs.push(cost / result.items.length);
          left -= result.items.length;
        }
        if (n * size <= 15 * MiB) {
          const chunkQueue = newQueue();
          const chunkBegin = producer.nowNs();
          producer.burst(chunkQueue, n * size, 1);
          chunkFillNs.push(producer.nowNs() - chunkBegin);
          const begin = producer.nowNs();
          chunkQueue.pull(1);
          chunkPullNs.push(producer.nowNs() - begin);
        }
      }
      const sorted = sortedCopy(pullNs);
      producer.appendResult(
        JSON.stringify({
          kind: 'sweep',
          size,
          n,
          total,
          pullP50Ns: quantile(sorted, 0.5),
          pullP99Ns: quantile(sorted, 0.99),
          perItemP50Ns: median(perItemNs),
          // 미리 만든 소유 버퍼 push 한 번의 중앙값 비용
          pushMedianNs: median(pushNs),
          // 건별 전달로 total건을 넣는 비용
          fillMedianNs: median(fillNs),
          // n건 분량의 버퍼 하나를 만들어 넣는 비용
          chunkFillMedianNs: chunkFillNs.length > 0 ? median(chunkFillNs) : 0,
          // 그 버퍼 하나를 pull(1)로 꺼내는 비용
          chunkPullMedianNs: chunkPullNs.length > 0 ? median(chunkPullNs) : 0,
        }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress('sweep 완료');
}
