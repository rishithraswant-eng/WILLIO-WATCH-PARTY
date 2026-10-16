/** Dependency-free SVG charts for the markdown report (rendered by GitHub). */

const W = 640;
const H = 240;
const PAD = { l: 48, r: 12, t: 24, b: 34 };
const BG = '#04100e';
const GRID = 'rgba(255,255,255,0.08)';
const TEXT = '#a8cfc6';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frame(title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="monospace" font-size="11">
<rect width="${W}" height="${H}" fill="${BG}"/>
<text x="${PAD.l}" y="16" fill="#eafff9" font-size="12">${esc(title)}</text>
${body}
</svg>
`;
}

export function histogramSvg(title: string, buckets: { from: number; to: number; count: number }[], unit = 'ms'): string {
  if (buckets.length === 0) return frame(title, `<text x="${W / 2}" y="${H / 2}" fill="${TEXT}">no data</text>`);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / buckets.length;
  let body = '';
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (ih * i) / 4;
    body += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${GRID}"/>`;
    body += `<text x="${PAD.l - 6}" y="${y + 4}" fill="${TEXT}" text-anchor="end">${Math.round(max * (1 - i / 4))}</text>`;
  }
  buckets.forEach((b, i) => {
    const h = (b.count / max) * ih;
    body += `<rect x="${(PAD.l + i * bw + 1).toFixed(1)}" y="${(PAD.t + ih - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#2ee6c5"/>`;
  });
  const step = Math.max(1, Math.ceil(buckets.length / 8));
  buckets.forEach((b, i) => {
    if (i % step === 0) body += `<text x="${(PAD.l + i * bw).toFixed(1)}" y="${H - PAD.b + 14}" fill="${TEXT}">${b.from}</text>`;
  });
  body += `<text x="${W - PAD.r}" y="${H - 6}" fill="${TEXT}" text-anchor="end">${unit}</text>`;
  return frame(title, body);
}

export function driftSvg(title: string, series: { t: number; p50: number; p95: number; max: number }[]): string {
  if (series.length < 2) return frame(title, `<text x="${W / 2}" y="${H / 2}" fill="${TEXT}">no data</text>`);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const tMax = Math.max(...series.map((s) => s.t), 1);
  const yMax = Math.max(120, Math.min(600, Math.max(...series.map((s) => s.max)) * 1.1));
  const x = (t: number) => PAD.l + (t / tMax) * iw;
  const y = (v: number) => PAD.t + ih - (Math.min(v, yMax) / yMax) * ih;
  let body = '';
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    body += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/>`;
    body += `<text x="${PAD.l - 6}" y="${y(v) + 4}" fill="${TEXT}" text-anchor="end">${Math.round(v)}</text>`;
  }
  if (yMax >= 100) body += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(100)}" y2="${y(100)}" stroke="#ffcf5c" stroke-dasharray="3 4"/>`;
  if (yMax >= 500) body += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(500)}" y2="${y(500)}" stroke="#ff5d6c" stroke-dasharray="4 4"/>`;
  const line = (key: 'p50' | 'p95' | 'max', color: string, dash = '') =>
    `<polyline fill="none" stroke="${color}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${series
      .map((s) => `${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`)
      .join(' ')}"/>`;
  body += line('max', '#ff8a3d', '3 3') + line('p95', '#ffcf5c') + line('p50', '#2ee6c5');
  body += `<text x="${W - PAD.r}" y="${H - 6}" fill="${TEXT}" text-anchor="end">seconds  |  teal p50, yellow p95, orange max (|drift| ms)</text>`;
  return frame(title, body);
}
