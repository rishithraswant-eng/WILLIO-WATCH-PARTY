# Willio - Same world. Same frame.

Real-time synchronized watch parties. Up to 25+ people join a room by link or 6-character code and watch one video
in frame-accurate sync, while they discover what to watch (fuzzy search, filters, moods, a **Group Taste Fusion**
recommender), chat, react, vote, build a shared queue and pass the host crown around.

The sync engine is the product: a server-authoritative timeline, NTP-style clock sync, sequence numbers,
idempotent events, scheduled execution and tiered drift correction - **proven** by a bot-swarm benchmark
(`npm run bench`) and a live **Sync Health** dashboard in every room.

> Design language "Pixel Glass": a glowing Minecraft-style swamp night (voxel mangroves, light rays, pixel fireflies)
> seen through frosted glass panels with stair-stepped pixel corners. Dark "Swamp Night" + light "Misty Dawn".

## 5-minute quickstart

Requirements: Node 20+ (tested on 20 and 24), npm 10+. Internet access for the demo video streams and Google Fonts.

```bash
npm install          # installs all workspaces + generates the Prisma client
npm run dev          # server on :4000, web on :3000
```

Open <http://localhost:3000>, press **Create room**, then open the invite link in a second browser/tab (each tab is
its own participant) or on your phone on the same Wi-Fi (`http://<your-ip>:3000/r/CODE`). There is always a demo room
at <http://localhost:3000/r/DEMO42> with Big Buck Bunny loaded.

No database is needed for development: rooms live in memory and are snapshotted to `.data/` so even a server restart
keeps them.

### Full stack with Docker (Postgres + Redis)

```bash
docker compose up --build    # web :3000, server :4000, postgres, redis (all with healthchecks)
WEB_PORT=3001 docker compose up --build   # if port 3000 is already taken
```

Migrations run on server boot and the Movie table is seeded from `apps/server/data/catalog.json` on first start.

## What is in the box

| Requirement | Where |
| --- | --- |
| **R1** create/join via invite link or code | landing (code boxes accept pastes of links), `/r/CODE`, invite modal with QR, optional room password |
| **R2** sync play/pause/seek | server-authoritative anchors + scheduled execution (`packages/shared/src/sync.ts`, `syncCore.ts`) |
| **R3** recommendations: categories, filters, fuzzy search | `/discover` and the room's Discover tab: Fuse.js typo-tolerant search with highlights + keyboard nav, genre/year/rating/runtime/language/mood/free filters, Trending / Top rated / Moods / Open & free rows, **Taste Fusion** |
| **R4** reactions, chat, playlists, polls, host transfer | 9-slot reaction hotbar (aggregated per 250 ms), chat with mentions/commands/typing/outbox, drag-reorder queue with upvotes and auto-advance, actionable polls, manual + automatic host transfer, request host |
| **R5** drift detection & correction | 500 ms control loop: dead zone 60 ms, playbackRate nudge up to 6%, hard seek >= 500 ms with seek-latency compensation |
| **R6** late joins, reconnections, concurrent actions | snapshot on join, `eseq` ring-buffer replay, outbox resend, per-room serial queue, idempotent event ids |
| **C1-C3** 10+ users, p95 <= 250 ms, drift <= 500 ms | measured by `npm run bench` (S1-S9), see [docs/LATENCY.md](docs/LATENCY.md) and `/bench` |
| **C4** documentation | [LATENCY.md](docs/LATENCY.md), [FAILURES.md](docs/FAILURES.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DECISIONS.md](docs/DECISIONS.md) |

Creative features: **Group Taste Fusion** (least-misery + average fusion with per-member compatibility bars and a
"why" line), **spoiler-safe time-locked chat** (messages from later in the movie stay blurred; on by default for late
joiners), **reaction heatmap** on the XP-bar seekbar + post-movie highlights reel (persisted per film across rooms),
**Sync Health dashboard** (press `H`), **Chaos Mode** (inject latency, packet drop, disconnects, buffering, desync,
server delay - and watch it heal), **smart polls** (skip-to-time, snack break, next movie - auto-applied),
**intermission** with a synced countdown, **room recap card** (PNG), Minecraft-style achievement toasts, item-drop
reactions and a void 404.

## Demo script (5 min)

1. Landing -> flip the glass sun/moon toggle -> **Create room** -> **Invite** shows code + QR.
2. Open 3-10 tabs/devices with the link; the People tab fills; each newcomer gets an "Achievement: Synced!".
3. Sidebar -> **Discover** -> "Picked for this room" (Taste Fusion) -> Play an open film; or Polls -> "What next?".
4. Spam play/pause/seek from several tabs at once - every tab ends on the same frame (toasts say who did what).
5. Press `H` for **Sync Health**: room sync %, per-user RTT / offset / drift sparklines, live p50/p95/p99.
6. In the drawer, **Chaos Mode**: +300 ms RTT on one user, 10% drop on another, force-disconnect the host - watch the
   drift controller and host succession heal everything.
7. Hammer the reaction hotbar (`1`-`9`) -> the seekbar heatmap glows; turn on spoiler-safe chat in a late tab.
8. Open `/bench` (and `docs/LATENCY.md`) for the measured numbers.

## Keyboard

`Space` play/pause - `<-`/`->` seek 5 s - `Up`/`Down` volume - `M` mute - `F` fullscreen - `R` resync me -
`H` sync health - `1`-`9` reactions.

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` | server (tsx watch) + web (next dev) |
| `npm run build` / `npm start` | production builds |
| `npm test` | unit + integration tests (Vitest; server tests use real sockets) |
| `npm run test:e2e` | Playwright, 3 browser contexts (`npx playwright install chromium` once) |
| `npm run lint` / `npm run typecheck` | ESLint (strict TS) / tsc |
| `npm run bench` | all scenarios S1-S9 against a spawned server, writes `bench/results/` + `docs/LATENCY.md` |
| `npm run bench -- --scenario S2 --users 25 --duration 300` | one scenario, longer |
| `npm run bench -- --url http://<ip>:4000 --scenario S1` | against a running server (LAN) |
| `npm run bench -- --ci` | CI gate: 10 users, 60 s, fails if p95 > 250 ms |
| `npm run seed` | load the catalog into Postgres (`DATABASE_URL` required) |
| `npm run catalog:generate` | regenerate `catalog.json` |

## Configuration

Copy `.env.example` to `.env` (all optional in development).

| Variable | Default | |
| --- | --- | --- |
| `PORT_SERVER` | 4000 | realtime + REST port |
| `JWT_SECRET` | dev secret | **required** in production |
| `CORS_ORIGIN` | (empty = any) | comma-separated web origins; also enforced for WebSocket upgrades |
| `DATABASE_URL` | - | PostgreSQL 16 (durable history) |
| `REDIS_URL` | - | Redis 7 (room snapshots, presence); falls back to `.data/` files |
| `TMDB_API_KEY` | - | merge TMDB popular/top-rated movies + artwork into the catalog |
| `ROOM_MAX_USERS` | 50 | |
| `CHAOS_ENABLED` | true | host-only demo tools |
| `NEXT_PUBLIC_WS_URL` | (page host:4000) | where browsers reach the server |

## Project layout

```
apps/web          Next.js 14 App Router UI (Pixel Glass), RoomClient, player adapters
apps/server       Fastify REST + Socket.IO, Room state machine, persistence, catalog
packages/shared   types, zod schemas, events, sync math (used by web, server and bench)
bench             bot swarm, scenarios S1-S9, report generator
prisma            schema + migrations
docs              ARCHITECTURE, LATENCY (generated), FAILURES, DECISIONS
```

## Deploying

- **Render / Fly.io**: deploy `Dockerfile.server` and `Dockerfile.web` as two services in one region. Set
  `JWT_SECRET`, `CORS_ORIGIN=https://<web-host>`, `DATABASE_URL`, `REDIS_URL` on the server and build the web image
  with `NEXT_PUBLIC_WS_URL=https://<server-host>`. Enable WebSockets and (if you run more than one server
  instance) sticky sessions by room - see "Horizontal scale" in ARCHITECTURE.md. Use HTTPS in production
  (clipboard + autoplay behave better in secure contexts).

## Media & licensing

Demo content is CC-BY Blender Foundation open movies streamed from public hosts (archive.org, Wikimedia, Mux test
streams, YouTube). Nothing is re-hosted. Users may add their own links - only add media you have the right to stream.
Movie metadata in `catalog.json` is approximate and for discovery only.
