'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { ArcGauge, Badge, Skeleton } from '@/components/ui/Bits';
import { GlassPanel } from '@/components/ui/Glass';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/util';
import type { BenchRun, BenchScenarioResult } from './types';

// recharts is heavy: lazy-load it only on this page.
const LatencyHistogram = dynamic(() => import('./BenchCharts').then((m) => m.LatencyHistogram), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});
const DriftChart = dynamic(() => import('./BenchCharts').then((m) => m.DriftChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

const ms = (v: number | null | undefined) => (v == null ? '--' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);

function ScenarioCard({ s }: { s: BenchScenarioResult }) {
  return (
    <GlassPanel as="article" className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-xl font-semibold text-hi">
            <span className="font-pixel mr-2 text-[10px] text-teal-400">{s.id}</span>
            {s.name}
          </h3>
          <p className="text-sm text-mid">{s.description}</p>
        </div>
        <Badge tone={s.pass ? 'ok' : 'danger'}>{s.pass ? 'PASS' : 'FAIL'}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        {[
          ['users', String(s.users)],
          ['prop p50', ms(s.propagation.p50)],
          ['prop p95', ms(s.propagation.p95)],
          ['prop p99', ms(s.propagation.p99)],
          ['drift p95', ms(s.drift.p95)],
          ['drift max', ms(s.drift.max)],
        ].map(([k, v]) => (
          <div key={k} className="bg-black/25 p-2">
            <dt className="font-label text-[9px] text-lo">{k}</dt>
            <dd className="font-mono text-sm text-hi">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-1 text-xs">
        {s.checks.map((c) => (
          <li key={c.label} className="flex gap-2">
            <span className={c.pass ? 'text-ok' : 'text-danger'}>{c.pass ? '✓' : '✗'}</span>
            <span className="text-hi">{c.label}</span>
            <span className="text-lo">- {c.detail}</span>
          </li>
        ))}
      </ul>
      {s.histogram.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-label mb-1 text-[10px] text-mid">Propagation latency histogram</p>
            <LatencyHistogram s={s} />
          </div>
          <div>
            <p className="font-label mb-1 text-[10px] text-mid">Post-correction drift over time (p50 / p95 / max)</p>
            <DriftChart s={s} />
          </div>
        </div>
      ) : null}
    </GlassPanel>
  );
}

export function BenchView() {
  const [run, setRun] = useState<BenchRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .benchLatest()
      .then((r) => setRun(r as BenchRun))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load results'));
  }, []);

  if (error) {
    return (
      <GlassPanel className="p-6 text-sm text-mid">
        <p className="mb-2 text-hi">{error}</p>
        <p>
          Run <code className="font-mono text-teal-400">npm run bench</code> (bot swarm against a local server) to produce{' '}
          <code className="font-mono">bench/results/latest.json</code>.
        </p>
      </GlassPanel>
    );
  }
  if (!run) return <Skeleton className="h-64 w-full" />;
  const target = 250;
  const score = run.headline.p95 == null ? null : Math.max(0, 100 - (run.headline.p95 / target) * 100);
  const allPass = run.scenarios.every((s) => s.pass);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
        <GlassPanel className="flex flex-col items-center justify-center p-5">
          <ArcGauge value={score} label="p95 headroom" size={170} />
          <p className="font-mono text-sm text-hi">p95 {ms(run.headline.p95)}</p>
          <p className="text-xs text-mid">target &le; {target} ms</p>
        </GlassPanel>
        <GlassPanel className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-gradient text-2xl font-semibold">Run {run.id}</h2>
            <Badge tone={allPass ? 'ok' : 'danger'}>{allPass ? 'all scenarios pass' : 'some scenarios fail'}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ['Propagation p50', ms(run.headline.p50)],
              ['Propagation p95', ms(run.headline.p95)],
              ['Propagation p99', ms(run.headline.p99)],
              ['Drift p95 / max', `${ms(run.headline.driftP95)} / ${ms(run.headline.driftMax)}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-black/25 p-2">
                <dt className="font-label text-[9px] text-lo">{k}</dt>
                <dd className="font-mono text-sm text-hi">{v}</dd>
              </div>
            ))}
          </dl>
          <details className="text-xs text-mid">
            <summary className="cursor-pointer text-hi">Test conditions</summary>
            <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-1">
              {Object.entries(run.conditions).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-lo">{k}</dt>
                  <dd className="font-mono">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
          <p className="text-xs text-lo">Generated {new Date(run.createdAt).toLocaleString()}. Full methodology in docs/LATENCY.md.</p>
        </GlassPanel>
      </div>
      <div className="overflow-x-auto">
        <table className="glass pixel-corners-sm w-full text-sm">
          <caption className="sr-only">Scenario results</caption>
          <thead>
            <tr className="font-label text-left text-[10px] text-mid">
              {['Scenario', 'Users', 'Prop p50', 'Prop p95', 'Drift p95', 'Drift max', 'Result'].map((h) => (
                <th key={h} className="px-3 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.scenarios.map((s) => (
              <tr key={s.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-hi">
                  <span className="font-pixel mr-2 text-[9px] text-teal-400">{s.id}</span>
                  {s.name}
                </td>
                <td className="font-mono px-3 py-2">{s.users}</td>
                <td className="font-mono px-3 py-2">{ms(s.propagation.p50)}</td>
                <td className={cx('font-mono px-3 py-2', (s.propagation.p95 ?? 0) > 250 && 'text-danger')}>{ms(s.propagation.p95)}</td>
                <td className="font-mono px-3 py-2">{ms(s.drift.p95)}</td>
                <td className={cx('font-mono px-3 py-2', (s.drift.max ?? 0) > 500 && 'text-warn')}>{ms(s.drift.max)}</td>
                <td className="px-3 py-2">
                  <Badge tone={s.pass ? 'ok' : 'danger'}>{s.pass ? 'pass' : 'fail'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-5">
        {run.scenarios.map((s) => (
          <ScenarioCard key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}
