// 정렬된 배열의 분위수
export function quantile(sorted: ArrayLike<number>, q: number) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

export function sortedCopy(values: ArrayLike<number>) {
  return Float64Array.from(values).sort();
}

export function median(values: number[]) {
  return quantile(sortedCopy(values), 0.5);
}

// 최소제곱 직선의 기울기
export function slope(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) {
    return 0;
  }
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  return den === 0 ? 0 : num / den;
}

// 시드를 받는 난수 생성기
export function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
