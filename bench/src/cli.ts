/**
 * Willio benchmark harness.
 *   npm run bench                                  # all scenarios (S1-S9), spawned server
 *   npm run bench -- --scenario S1 --users 10 --duration 300
 *   npm run bench -- --ci                          # S1, 10 users, 60s; exit 1 if p95 > 250ms
 *   npm run bench -- --url http://192.168.1.20:4000 --scenario S2   # against a running server (LAN)
 */
import { cpus, hostname, release, totalmem, type, arch } from 'node:os';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { summarize } from '@willio/shared';
import { finalize, Recorder, SCENARIOS, type ScenarioResult } from './scenarios';
import { REPO_ROOT, ServerProcess } from './serverProc';
import { driftSvg, histogramSvg } from './svg';
import { writeReport } from './report';

interface Args {
  scenario: string;
  users?: number;
  duration?: number;
  url?: string;
  ci: boolean;
  port: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { scenario: 'all', ci: false, port: 4100 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const takesValue = ['--scenario', '--users', '--duration', '--url', '--port'].includes(k ?? '');
    if (takesValue && v === undefined) throw new Error(`${k} needs a value`);
    if (k === '--scenario') a.scenario = v!;
    else if (k === '--users') a.users = Number(v);
    else if (k === '--duration') a.duration = Number(v);
    else if (k === '--url') a.url = v!.replace(/\/$/, '');
    else if (k === '--port') a.port = Number(v);
    else if (k === '--ci') a.ci = true;
    else if (k === '--help' || k === '-h') {
      console.log('Usage: npm run bench -- [--scenario S1|...|S9|all] [--users N] [--duration S] [--url URL] [--ci]');
      process.exit(0);
    }
    if (takesValue) i++;
  }
  if (a.ci) {
    a.scenario = 'S1';
    a.users ??= 10;
    a.duration ??= 60;
  }
  return a;
}

const log = (m: string) => console.log(m);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wanted = args.scenario === 'all' ? SCENARIOS : SCENARIOS.filter((s) => args.scenario.split(',').includes(s.id));
  if (wanted.length === 0) throw new Error(`unknown scenario ${args.scenario}`);

  const server = args.url ? null : new ServerProcess(args.port);
  const url = args.url ?? server!.url;
  if (server) {
    log(`Starting server on ${url} (file snapshots in ${server.dataDir})...`);
    await server.start();
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(REPO_ROOT, 'bench', 'results', runId);
  await mkdir(outDir, { recursive: true });

  const results: ScenarioResult[] = [];
  try {
    for (const s of wanted) {
      if (s.needsServerControl && !server) {
        log(`Skipping ${s.id} (needs a spawned server; drop --url)`);
        continue;
      }
      const users = s.id === 'S4' ? s.defaultUsers : (args.users ?? s.defaultUsers);
      const durationS = ['S1', 'S2', 'S3', 'S9'].includes(s.id) ? (args.duration ?? s.defaultDurationS) : s.defaultDurationS;
      log(`\n[${s.id}] ${s.name} - ${users} users, ~${durationS}s`);
      const rec = new Recorder();
      const t0 = Date.now();
      let outcome: Awaited<ReturnType<typeof s.run>>;
      try {
        outcome = await s.run({ url, server, users: s.id === 'S4' ? undefined : users, durationS, log }, rec);
      } catch (err) {
        outcome = { extra: { error: (err as Error).message }, checks: [{ label: 'Scenario completed', pass: false, detail: (err as Error).message }] };
      } finally {
        for (const b of rec.bots) b.dispose();
      }
      const r = finalize(s, rec, users, Math.round((Date.now() - t0) / 1000), outcome.extra, outcome.checks);
      results.push(r);
      log(
        `  propagation p50 ${r.propagation.p50}ms p95 ${r.propagation.p95}ms p99 ${r.propagation.p99}ms max ${r.propagation.max}ms (n=${r.propagation.count})`,
      );
      log(`  drift (post-correction) p50 ${r.drift.p50}ms p95 ${r.drift.p95}ms max ${r.drift.max}ms (n=${r.drift.count})`);
      for (const c of r.checks) log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.label} - ${c.detail}`);
      await new Promise((res) => setTimeout(res, 1500));
    }
  } finally {
    if (server) await server.stop();
  }

  // ---- outputs ----
  const allProp = results.flatMap((r) => r.raw.prop.map((p) => p.latencyMs));
  const allDrift = results.flatMap((r) => r.raw.drift.filter((d) => d.post).map((d) => Math.abs(d.driftMs)));
  const p = summarize(allProp);
  const d = summarize(allDrift);
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const cpu = cpus();
  const run = {
    id: runId,
    createdAt: new Date().toISOString(),
    scenario: args.scenario,
    users: Math.max(...results.map((r) => r.users), 0),
    durationS: results.reduce((s, r) => s + r.durationS, 0),
    headline: { p50: r1(p.p50), p95: r1(p.p95), p99: r1(p.p99), driftP95: r1(d.p95), driftMax: r1(d.max) },
    conditions: {
      host: hostname(),
      os: `${type()} ${release()} (${arch()})`,
      cpu: `${cpu[0]?.model.trim() ?? 'unknown'} x${cpu.length}`,
      memory: `${Math.round(totalmem() / 1024 ** 3)} GB`,
      node: process.version,
      network: args.url ? `remote server ${args.url}` : 'loopback (bots and server on the same machine)',
      server: args.url ? 'external' : 'spawned child process, in-memory rooms + file snapshots',
      clients: 'headless bot swarm (socket.io-client) running the browser SyncCore against a simulated player (+-0.4% clock skew, 40-120ms seek latency)',
      transport: 'Socket.IO 4, WebSocket only',
    },
    scenarios: results.map(({ raw: _raw, ...rest }) => rest),
  };

  const propCsv = ['scenario,bot,seq,latency_ms', ...results.flatMap((r) => r.raw.prop.map((x) => `${r.id},${x.bot},${x.seq},${x.latencyMs}`))];
  const driftCsv = [
    'scenario,t_ms,bot,drift_ms,post_correction',
    ...results.flatMap((r) => r.raw.drift.map((x) => `${r.id},${x.t},${x.bot},${x.driftMs.toFixed(2)},${x.post}`)),
  ];
  await writeFile(join(outDir, 'results.json'), JSON.stringify(run, null, 2));
  await writeFile(join(outDir, 'propagation.csv'), propCsv.join('\n'));
  await writeFile(join(outDir, 'drift.csv'), driftCsv.join('\n'));

  // charts (also copied to bench/results/latest/ for the docs)
  const latestDir = join(REPO_ROOT, 'bench', 'results', 'latest');
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });
  for (const r of results) {
    const h = histogramSvg(`${r.id} ${r.name} - control propagation latency (n=${r.propagation.count})`, r.histogram);
    const dr = driftSvg(`${r.id} ${r.name} - post-correction |drift| per second`, r.driftSeries);
    await writeFile(join(outDir, `${r.id}-propagation.svg`), h);
    await writeFile(join(outDir, `${r.id}-drift.svg`), dr);
    await writeFile(join(latestDir, `${r.id}-propagation.svg`), h);
    await writeFile(join(latestDir, `${r.id}-drift.svg`), dr);
  }
  const latest = join(REPO_ROOT, 'bench', 'results', 'latest.json');
  await writeFile(latest, JSON.stringify(run, null, 2));
  await copyFile(join(outDir, 'propagation.csv'), join(latestDir, 'propagation.csv'));
  await copyFile(join(outDir, 'drift.csv'), join(latestDir, 'drift.csv'));
  await writeReport(run);

  log(`\nHeadline: propagation p50 ${run.headline.p50}ms / p95 ${run.headline.p95}ms / p99 ${run.headline.p99}ms;`);
  log(`          drift p95 ${run.headline.driftP95}ms / max ${run.headline.driftMax}ms`);
  log(`Results: ${outDir}`);
  log('Report:  docs/LATENCY.md');
  const failed = results.filter((r) => !r.pass);
  if (args.ci && (run.headline.p95 == null || run.headline.p95 > 250)) {
    console.error(`CI gate failed: p95 ${run.headline.p95}ms > 250ms`);
    process.exit(1);
  }
  if (failed.length > 0) {
    log(`\n${failed.length} scenario(s) failed: ${failed.map((f) => f.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
