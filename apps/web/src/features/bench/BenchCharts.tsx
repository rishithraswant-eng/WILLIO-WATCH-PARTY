'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BenchScenarioResult } from './types';

const axis = { stroke: 'rgb(168 207 198 / 0.6)', fontSize: 11 };
const tooltipStyle = {
  background: 'rgba(4,16,14,0.92)',
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#eafff9',
  fontSize: 12,
};

export function LatencyHistogram({ s }: { s: BenchScenarioResult }) {
  const data = s.histogram.map((b) => ({ bucket: `${b.from}-${b.to}`, count: b.count }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="bucket" tick={axis} stroke={axis.stroke} interval="preserveStartEnd" />
        <YAxis tick={axis} stroke={axis.stroke} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(46,230,197,0.08)' }} formatter={(v: number) => [v, 'events']} labelFormatter={(l) => `${l} ms`} />
        <Bar dataKey="count" fill="#2ee6c5" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DriftChart({ s }: { s: BenchScenarioResult }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={s.driftSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="t" tick={axis} stroke={axis.stroke} unit="s" />
        <YAxis tick={axis} stroke={axis.stroke} unit="ms" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, k: string) => [`${Math.round(v)} ms`, k]} labelFormatter={(l) => `t = ${l}s`} />
        <ReferenceLine y={500} stroke="#ff5d6c" strokeDasharray="4 4" />
        <ReferenceLine y={100} stroke="#ffcf5c" strokeDasharray="2 4" />
        <Line type="monotone" dataKey="p50" stroke="#2ee6c5" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="p95" stroke="#ffcf5c" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="max" stroke="#ff8a3d" dot={false} isAnimationActive={false} strokeDasharray="3 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}
