import type { BenchProducer } from 'example-producer';
import { quantile, sortedCopy } from '../stats';

// dispatch부터 React 커밋까지의 지연과 렌더 구간을 기록하는 프로브
export class CommitProbe {
  private dispatchAt: Float64Array;
  private version = 0;
  private next = 1;
  private renderAt = 0;
  // 커밋마다 커밋 시각, 가장 오래 기다린 dispatch의 지연, 묶인 dispatch 수
  private commits: number[] = [];
  // 렌더 구간의 시작과 끝 쌍
  private spans: number[] = [];

  constructor(
    private producer: BenchProducer,
    capacity: number,
  ) {
    this.dispatchAt = new Float64Array(capacity + 2);
  }

  // dispatch 직전에 호출하는 순번 발급
  onDispatch() {
    this.version += 1;
    if (this.version < this.dispatchAt.length) {
      this.dispatchAt[this.version] = this.producer.nowNs();
    }
    return this.version;
  }

  // 소비자 컴포넌트 함수 본문의 시작
  onRender() {
    this.renderAt = this.producer.nowNs();
  }

  // 커밋 직후(useLayoutEffect)에 커밋된 마지막 순번과 함께 호출
  onCommit(committed: number) {
    if (committed < this.next || this.dispatchAt.length <= committed) {
      return;
    }
    const now = this.producer.nowNs();
    this.commits.push(
      now,
      (now - this.dispatchAt[this.next]) / 1e6,
      committed - this.next + 1,
    );
    this.next = committed + 1;
    if (0 < this.renderAt) {
      this.spans.push(this.renderAt, now);
    }
  }

  // 측정 구간과 겹치는 렌더 구간 목록(시작과 끝 쌍, ns)
  renderSpans(from: number, to: number) {
    const spans: number[] = [];
    for (let i = 0; i < this.spans.length; i += 2) {
      if (from <= this.spans[i + 1] && this.spans[i] < to) {
        spans.push(this.spans[i], this.spans[i + 1]);
      }
    }
    return spans;
  }

  summary(from: number, to: number) {
    const delays: number[] = [];
    const counts: number[] = [];
    for (let i = 0; i < this.commits.length; i += 3) {
      if (from <= this.commits[i] && this.commits[i] < to) {
        delays.push(this.commits[i + 1]);
        counts.push(this.commits[i + 2]);
      }
    }
    const spans = this.renderSpans(from, to);
    const lengths: number[] = [];
    for (let i = 0; i < spans.length; i += 2) {
      lengths.push((spans[i + 1] - spans[i]) / 1e6);
    }
    const delaySorted = sortedCopy(delays);
    const lengthSorted = sortedCopy(lengths);
    return {
      commits: delays.length,
      dispatchesPerCommitP50: quantile(sortedCopy(counts), 0.5),
      commitDelayP50Ms: quantile(delaySorted, 0.5),
      commitDelayP99Ms: quantile(delaySorted, 0.99),
      commitDelayMaxMs: quantile(delaySorted, 1 - 1e-9),
      renderSpanP99Ms: quantile(lengthSorted, 0.99),
    };
  }
}
