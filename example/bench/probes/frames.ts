import type { BenchProducer } from 'example-producer';
import { quantile, sortedCopy } from '../stats';

// requestAnimationFrame 콜백 시각(ns)을 기록하는 프로브
// 반환 함수는 기록 중단과 시각 배열 반환
export function startJsFrames(producer: BenchProducer) {
  const times: number[] = [];
  let active = true;
  const loop = () => {
    if (!active) {
      return;
    }
    times.push(producer.nowNs());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => {
    active = false;
    return Float64Array.from(times);
  };
}

// 프레임 시각 배열에서 [from, to) 구간의 간격 지표
// 드롭은 간격을 주기로 나눈 반올림 값에서 1을 뺀 수
// hitch는 주기를 넘은 시간의 합을 구간 초로 나눈 값
export function frameMetrics(
  times: Float64Array,
  from: number,
  to: number,
  periodMs: number,
  prefix: string,
) {
  const gaps: number[] = [];
  let dropped = 0;
  let hitch = 0;
  for (let i = 1; i < times.length; i++) {
    if (from <= times[i] && times[i] < to) {
      const gap = (times[i] - times[i - 1]) / 1e6;
      gaps.push(gap);
      dropped += Math.max(0, Math.round(gap / periodMs) - 1);
      hitch += Math.max(0, gap - periodMs);
    }
  }
  const sorted = sortedCopy(gaps);
  return {
    [`${prefix}Frames`]: gaps.length,
    [`${prefix}Dropped`]: dropped,
    [`${prefix}HitchMsPerSec`]: hitch / ((to - from) / 1e9),
    [`${prefix}IntervalP50Ms`]: quantile(sorted, 0.5),
    [`${prefix}IntervalP99Ms`]: quantile(sorted, 0.99),
    [`${prefix}IntervalMaxMs`]: quantile(sorted, 1 - 1e-9),
  };
}
