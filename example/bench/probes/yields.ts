import type { BenchProducer } from 'example-producer';

// 0 지연 타이머 한 번의 기록(ms)
// at은 예약 시각, run은 콜백 시작 시각
export interface ZeroTimer {
  at: number;
  run: number;
}

// 전역 setTimeout을 감싸 0 지연 타이머의 예약과 실행 시각을 기록하는 프로브
// setTimeout(fn, 0)으로 양보하던 이전 구현의 양보 횟수와 대기를 재는 용도
// 현재 구현은 이 타이머로 양보하지 않으므로 앱 코드의 0 지연 타이머만 기록
// 콜백이 도는 동안의 onBatch를 그 타이머의 재개로 연결
export class YieldProbe {
  readonly timers: ZeroTimer[] = [];
  private original: typeof setTimeout | undefined;
  private running: ZeroTimer | undefined;

  constructor(private readonly producer: BenchProducer) {}

  // 지금 실행 중인 0 지연 타이머 콜백
  current() {
    return this.running;
  }

  start() {
    const original = globalThis.setTimeout;
    this.original = original;
    const wrapped = (
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay) {
        return original(callback, delay, ...args);
      }
      const at = this.producer.nowNs() / 1e6;
      return original(() => {
        const timer = { at, run: this.producer.nowNs() / 1e6 };
        this.timers.push(timer);
        this.running = timer;
        try {
          callback(...args);
        } finally {
          this.running = undefined;
        }
      }, 0);
    };
    globalThis.setTimeout = wrapped as unknown as typeof setTimeout;
  }

  stop() {
    if (this.original) {
      globalThis.setTimeout = this.original;
      this.original = undefined;
    }
  }
}
