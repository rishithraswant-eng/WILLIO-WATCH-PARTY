/** Shape of bench/results/latest.json (written by `npm run bench`). */
export interface BenchSummary {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

export interface BenchScenarioResult {
  id: string;
  name: string;
  description: string;
  users: number;
  durationS: number;
  propagation: BenchSummary;
  drift: BenchSummary;
  extra: Record<string, number | string | null>;
  pass: boolean;
  checks: { label: string; pass: boolean; detail: string }[];
  histogram: { from: number; to: number; count: number }[];
  driftSeries: { t: number; p50: number; p95: number; max: number }[];
}

export interface BenchRun {
  id: string;
  createdAt: string;
  durationS: number;
  users: number;
  scenario: string;
  headline: { p50: number | null; p95: number | null; p99: number | null; driftP95: number | null; driftMax: number | null };
  conditions: Record<string, string | number>;
  scenarios: BenchScenarioResult[];
}
