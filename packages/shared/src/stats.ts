/** Linear-interpolated percentile (p in 0..100). Returns null for empty input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo]! + (s[hi]! - s[lo]!) * (rank - lo);
}

export interface Summary {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    count: values.length,
    min,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max,
    mean: sum / values.length,
  };
}

export interface Bucket {
  from: number;
  to: number;
  count: number;
}

/** Fixed-width histogram buckets starting at 0 (values above maxValue land in the last bucket). */
export function histogram(values: readonly number[], bucketSize: number, maxValue?: number): Bucket[] {
  if (values.length === 0 || bucketSize <= 0) return [];
  let top = maxValue ?? 0;
  if (maxValue === undefined) for (const v of values) if (v > top) top = v;
  const n = Math.max(1, Math.ceil((top + 1e-9) / bucketSize));
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({ from: i * bucketSize, to: (i + 1) * bucketSize, count: 0 }));
  for (const v of values) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(v / bucketSize)));
    buckets[idx]!.count++;
  }
  return buckets;
}
