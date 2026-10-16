# Willio Watch Party

A real-time, synchronized video streaming platform designed for frame-accurate group watch parties. Up to 25 or more participants can join a shared room via an invite link or a 6-character room code to watch media simultaneously with synchronized playback controls, interactive chat, live reactions, shared queue management, smart polling, and an automated recommendation engine.

Willio treats synchronization as a distributed systems challenge: it uses a server-authoritative timeline, NTP-style clock synchronization, sequence numbering, idempotent mutations, scheduled execution, and a tiered drift-correction loop.

---

## Table of Contents

- [Overview](#overview)
- [What Is What: Architecture and Project Layout](#what-is-what-architecture-and-project-layout)
- [Key Features](#key-features)
- [How Synchronization Works](#how-synchronization-works)
  - [Server-Authoritative Timeline](#server-authoritative-timeline)
  - [NTP-Style Clock Synchronization](#ntp-style-clock-synchronization)
  - [Scheduled Execution](#scheduled-execution)
  - [Tiered Drift Correction Loop](#tiered-drift-correction-loop)
  - [Buffering Coordination](#buffering-coordination)
  - [Reconnection and Reliable Event Delivery](#reconnection-and-reliable-event-delivery)
- [Prerequisites](#prerequisites)
- [Getting Started and How to Run](#getting-started-and-how-to-run)
  - [Method 1: Local Development (Fastest, Zero External Database)](#method-1-local-development-fastest-zero-external-database)
  - [Method 2: Full Stack with Docker Compose (PostgreSQL and Redis)](#method-2-full-stack-with-docker-compose-postgresql-and-redis)
  - [Method 3: Running Workspaces Individually](#method-3-running-workspaces-individually)
- [Environment Configuration](#environment-configuration)
- [Interactive Features and Discovery](#interactive-features-and-discovery)
  - [Group Taste Fusion Recommender](#group-taste-fusion-recommender)
  - [Spoiler-Safe Time-Locked Chat](#spoiler-safe-time-locked-chat)
  - [Live Reactions and Seekbar Heatmap](#live-reactions-and-seekbar-heatmap)
  - [Shared Queue with Fractional Indexing](#shared-queue-with-fractional-indexing)
  - [Smart Actionable Polls](#smart-actionable-polls)
  - [Sync Health Dashboard](#sync-health-dashboard)
  - [Chaos Mode Fault Injection](#chaos-mode-fault-injection)
  - [Scroll-Driven Canvas Landing Hero](#scroll-driven-canvas-landing-hero)
- [Verification, Testing, and Benchmarking](#verification-testing-and-benchmarking)
  - [Unit and Integration Tests](#unit-and-integration-tests)
  - [End-to-End Browser Tests](#end-to-end-browser-tests)
  - [Bot Swarm Benchmarks](#bot-swarm-benchmarks)
- [NPM Scripts Reference](#npm-scripts-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Production Deployment](#production-deployment)
- [Media and Licensing](#media-and-licensing)

---

## Overview

Willio enables groups of users to watch video streams in exact synchronization without requiring screen sharing. Unlike naive watch party implementations that broadcast raw playback timestamps continuously (which flood the network and cause jitter), Willio establishes a single authoritative playback anchor on the server. Browsers compute where their playback head should be based on synchronized server clocks and autonomously correct any local drift.

The platform provides an engaging user experience using a distinct "Pixel Glass" aesthetic (voxel swamp night backdrop with frosted glass UI elements, stair-stepped pixel borders, and light/dark theme support).

---

## What Is What: Architecture and Project Layout

The repository is structured as a TypeScript monorepo using npm workspaces:

```
.
|-- apps/
|   |-- server/               Fastify REST API and Socket.IO real-time server
|   `-- web/                  Next.js 14 App Router web client (React 18, Zustand, Tailwind)
|-- packages/
|   `-- shared/               Shared schemas, types, mathematical sync algorithms, constants
|-- bench/                    Headless bot-swarm load and latency benchmarking suite
|-- prisma/                   PostgreSQL database schema and Prisma migrations
|-- docs/                     Detailed architecture, benchmark results, and design specs
|-- scripts/                  Utility scripts (frame extractor, catalog generator)
`-- docker-compose.yml        Multi-container setup (Web, Server, PostgreSQL, Redis)
```

### Detailed Component Roles

- **`packages/shared`**:
  The core foundation. Contains all domain models, Zod validation schemas, Socket.IO event contracts, and pure synchronization logic:
  - `clock.ts`: ClockEstimator implementing NTP four-timestamp offset calculation and exponential moving average (EMA) smoothing.
  - `drift.ts`: DriftController state machine calculating rate nudges and hard-seek thresholds.
  - `syncCore.ts`: Shared synchronization engine driving both the browser client and benchmarking bots.
  - `taste.ts`: Vector-based collaborative preference fusion algorithm (least-misery + average fusion).
  - `fractional.ts`: String-based fractional indexing for collaborative drag-and-drop reordering without index collisions.
  - `permissions.ts`: Matrix validating host, moderator, and participant action privileges.

- **`apps/server`**:
  Backend server built on Fastify and Socket.IO:
  - `src/rooms/Room.ts`: The central entity. Each room maintains an internal promise execution queue (`room.enqueue`) ensuring serial order for all mutations. Manages participant state, playlist queues, polls, and a 300-event ring buffer (`eseq`).
  - `src/rooms/RoomManager.ts`: Manages active room lifecycles, memory caches, persistence synchronization, and garbage collection.
  - `src/socket/`: Real-time socket handlers validating payloads with Zod, enforcing per-event rate limits, and scheduling state updates.
  - `src/catalog/`: In-memory catalog of movies with Fuse.js fuzzy search and optional TMDB enrichment.
  - `src/db/`: Write-behind persistence layer. Batches mutations to PostgreSQL via Prisma while remaining fully functional in memory or file snapshot mode if PostgreSQL is unavailable.

- **`apps/web`**:
  Frontend application built on Next.js 14 (App Router):
  - `src/features/room/`: Complete watch room interface, chat panel, participant drawer, poll modal, and playlist drawer.
  - `src/features/player/`: Unified video player component supporting HTML5 native MP4, HLS.js adaptive live/VOD streaming, and YouTube IFrame API.
  - `src/features/hero/`: High-performance scroll-scrubbed canvas landing section drawn from pre-extracted WebP video frame sequences.
  - `src/features/discover/`: Movie discovery catalog featuring fuzzy search, multi-attribute filtering, and Taste Fusion recommendations.
  - `src/lib/roomClient.ts`: Client-side real-time coordinator managing socket lifecycles, ping-pong clock loops, event replays, and offline chat outbox.
  - `src/store/`: Zustand state stores for room data, player status, user profiles, and theme preferences.

- **`bench`**:
  Automated bot-swarm test harness. Simulates realistic concurrent users connecting over WebSockets, executing concurrent play/pause/seek actions, dropping connections, experiencing packet latency, and asserting propagation latency and drift limits.

---

## Key Features

1. **Synchronized Playback**:
   Sub-second sync accuracy across HTML5 video, HLS streams, and YouTube embeds.
2. **Dynamic Drift Correction**:
   Subtle audio-pitch-preserving playback speed adjustments for minor drift, with latency-compensated seeks for larger discrepancies.
3. **Group Taste Fusion**:
   Aggregates participant genre/mood preferences using a hybrid least-misery and average fusion algorithm to recommend media everyone enjoys.
4. **Spoiler-Safe Chat**:
   Messages bound to specific video timestamps remain blurred for participants who have not reached that timestamp yet.
5. **Live Reactions and Seekbar Heatmap**:
   Emoji reactions dropped during playback are aggregated into 250 ms buckets and mapped onto the seekbar as an illuminated heatmap.
6. **Smart Actionable Polls**:
   Rooms can run polls that automatically execute actions upon resolution (e.g., skip to timestamp, start intermission, or load the next playlist item).
7. **Reliable Network Resilience**:
   Monotonically increasing event sequence numbers (`eseq`) and a server ring buffer allow instant replay of missed events after brief network drops.
8. **Host Controls and Succession**:
   Configurable room permissions (Host Only, Everyone, or Vote). If a host disconnects, a 10-second grace timer triggers automated succession to the longest-standing participant.
9. **Chaos Engineering Mode**:
   Built-in host controls to simulate network jitter, artificial latency (+300 ms), packet drops (10%), desynchronization, and server restarts directly in the browser to inspect recovery.
10. **Sync Health Dashboard**:
    Pressing `H` opens a diagnostic HUD displaying real-time RTT, clock offset, drift sparklines, and rolling p50/p95/p99 propagation percentiles.

---

## How Synchronization Works

Willio models watch party synchronization using distributed systems principles rather than frequent state streaming.

### Server-Authoritative Timeline

Clients never broadcast their local video position. Instead, the server maintains an authoritative playback state anchor:

```typescript
PlaybackState = {
  seq: number;
  status: 'PLAYING' | 'PAUSED' | 'BUFFERING';
  media: MediaItem | null;
  rate: number;
  anchorPos: number;
  anchorTime: number;
  updatedBy: string;
  ended: boolean;
};
```

Any client can determine the exact expected playback position at wall-clock time `now` using the shared formula:

```typescript
expectedPos(now) =
  status === 'PLAYING' ? anchorPos + (Math.max(0, now - anchorTime) / 1000) * rate : anchorPos;
```

### NTP-Style Clock Synchronization

To evaluate `expectedPos(now)` accurately, the client must know the exact server time.

1. **Burst Synchronization**: Upon connecting, the client issues 10 rapid `time:ping` packets spaced 100 ms apart.
2. **Offset Calculation**: For round-trip time `rtt = t1 - t0`, the offset is calculated as:
   ```
   offset = serverTimestamp - (t0 + rtt / 2)
   ```
3. **Filtering and Smoothing**: The client selects the 4 lowest-RTT samples to compute a median baseline offset.
4. **Periodic Drift Maintenance**: Every 5 seconds, a periodic ping maintains the offset using an Exponential Moving Average (alpha = 0.2), rejecting outlier samples that exceed double the best RTT.

### Scheduled Execution

When a user initiates an action (e.g., seeks to 01:30):

1. The client sends a `playback:seek` request with an idempotent `eventId` and `baseSeq`.
2. The server processes the mutation inside its per-room serial queue.
3. The server computes a dynamic network lead time based on participant round-trip times:
   ```
   lead = clamp(1.5 * maxRTT / 2 + 40, 80, 300) ms
   scheduledAt = now + lead
   ```
4. The server broadcasts a `state:update` containing `scheduledAt` and incremented `seq`.
5. Every client sets a high-resolution timer (`setTimeout` followed by a short spin loop) to execute the play/pause/seek command at the exact same millisecond.

### Tiered Drift Correction Loop

Every 500 ms while playing, the client compares its local video player timestamp against `expectedPos(serverNow)`:

- **Dead Zone (`|drift| < 60 ms`)**: No action taken. Prevents audio fluttering.
- **Nudge Zone (`60 ms <= |drift| < 500 ms`)**: The client subtly modulates `playbackRate` by up to plus or minus 6% while preserving audio pitch (`preservesPitch = true`).
  ```
  rate = roomRate * (1 - clamp(drift * 0.5, -0.06, 0.06))
  ```
  Once drift drops below 30 ms, normal playback speed resumes (hysteresis).
- **Hard Seek (`|drift| >= 500 ms`)**: If drift exceeds 500 ms, the player jumps directly to the target timestamp, incorporating estimated local seek latency (`expectedPos + seekLatencyEst * rate`). A 2-second cooldown prevents seek oscillation.

### Buffering Coordination

When a participant stalls for more than 400 ms, the client transmits `playback:buffering START`. Under the default `WAIT_FOR_ALL` policy:

1. The server transitions the room state to `BUFFERING`, freezing the timeline anchor for all participants.
2. When all buffering clients report `END` (or a 4-second timeout elapses), playback resumes simultaneously for everyone.
3. Persistent laggards are temporarily placed in an isolated catch-up mode for 30 seconds so their connection issues do not repeatedly stall the room.

### Reconnection and Reliable Event Delivery

All client-facing mutations are assigned a strictly monotonic room event sequence number (`eseq`) stored in a 300-slot server ring buffer:

- If a client detects a sequence gap (`eseq != lastSeen + 1`), it emits `sync:replay { lastEseq, bootId }` to receive missing events in order.
- If the server has restarted or the gap exceeds the ring buffer capacity, a fresh snapshot is delivered.
- Pending chat messages are preserved in a local IndexedDB/localStorage outbox and dispatched automatically upon reconnection.

---

## Prerequisites

Before installing, ensure your environment meets these requirements:

- **Node.js**: Version `20.10.0` or higher (compatible with Node 20 LTS and Node 22/24).
- **npm**: Version `10.0.0` or higher.
- **Docker and Docker Compose** (Optional): Required only if running the full stack container environment with PostgreSQL and Redis.
- **FFmpeg** (Optional): Required only if regenerating the scroll-hero video frames from raw MP4 source files.

---

## Getting Started and How to Run

### Method 1: Local Development (Fastest, Zero External Database)

Willio is architected to run immediately in development without needing PostgreSQL or Redis. In this mode, room states and catalog data reside in memory and snapshot to local `.data/` JSON files.

1. **Clone the repository**:

   ```bash
   git clone https://github.com/rishithraswant-eng/WILLIO-WATCH-PARTY.git
   cd WILLIO-WATCH-PARTY
   ```

2. **Install all dependencies**:

   ```bash
   npm install
   ```

   _Note: This command installs dependencies across all workspaces and automatically generates the Prisma client._

3. **Start both server and web client concurrently**:

   ```bash
   npm run dev
   ```

4. **Access the application**:
   - Web application: [http://localhost:3000](http://localhost:3000)
   - Real-time backend API: [http://localhost:4000](http://localhost:4000)
   - Pre-seeded demo room: [http://localhost:3000/r/DEMO42](http://localhost:3000/r/DEMO42)

5. **Test Multi-User Synchronization Locally**:
   - Open [http://localhost:3000](http://localhost:3000) in your primary browser window.
   - Click **Create room**.
   - Copy the invite link and open it in an Incognito window or a different browser (each window acts as an independent participant).
   - Alternatively, open the link on your mobile phone connected to the same local Wi-Fi network: `http://<your-local-ip>:3000/r/<ROOM_CODE>`.

---

### Method 2: Full Stack with Docker Compose (PostgreSQL and Redis)

To run the complete production-grade topology with durable PostgreSQL 16 storage, Redis 7 caching, and containerized microservices:

1. **Launch all services**:

   ```bash
   docker compose up --build
   ```

2. **Port Conflict Override**:
   If port 3000 is occupied on your host machine, run:

   ```bash
   WEB_PORT=3001 docker compose up --build
   ```

3. **Service Breakdown**:
   - `web`: Next.js frontend on port 3000.
   - `server`: Fastify and Socket.IO API on port 4000.
   - `postgres`: PostgreSQL 16 on internal port 5432 with health check.
   - `redis`: Redis 7 on internal port 6379 with health check.

Prisma database migrations run automatically on server boot, and movie records are seeded from `apps/server/data/catalog.json`.

---

### Method 3: Running Workspaces Individually

If you prefer running frontend and backend in separate terminal tabs:

**Terminal 1 (Backend Server):**

```bash
npm run dev:server
```

**Terminal 2 (Frontend Client):**

```bash
npm run dev:web
```

---

## Environment Configuration

Configuration is managed via environment variables. To customize your setup, copy the template file:

```bash
cp .env.example .env
```

### Configuration Variables Reference

| Variable             | Default Value                 | Description                                                                                                        |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PORT_SERVER`        | `4000`                        | Port for the Fastify HTTP and Socket.IO server.                                                                    |
| `HOST`               | `0.0.0.0`                     | Network interface binding.                                                                                         |
| `NODE_ENV`           | `development`                 | Runtime environment (`development`, `production`, `test`).                                                         |
| `JWT_SECRET`         | `willio-dev-secret-change-me` | Secret key used to sign guest participant tokens. Must be changed in production.                                   |
| `CORS_ORIGIN`        | `(empty)`                     | Comma-separated list of allowed origins. Empty allows all origins for local and LAN development.                   |
| `DATABASE_URL`       | `(empty)`                     | PostgreSQL connection string (e.g., `postgresql://user:pass@localhost:5432/willio`). If unset, writes are skipped. |
| `REDIS_URL`          | `(empty)`                     | Redis connection string (e.g., `redis://localhost:6379`). If unset, snapshots fall back to `.data/`.               |
| `ROOM_MAX_USERS`     | `50`                          | Maximum number of concurrent participants permitted in a single room.                                              |
| `CHAOS_ENABLED`      | `true`                        | Enables chaos fault-injection tools in the room interface for demonstration and testing.                           |
| `TMDB_API_KEY`       | `(empty)`                     | Optional The Movie Database (TMDB) API key to enrich catalog metadata and poster artwork.                          |
| `SNAPSHOT_STORE`     | `auto`                        | Snapshot backend: `auto`, `redis`, `file`, or `memory`.                                                            |
| `DATA_DIR`           | `.data`                       | Directory for file-based room snapshots when running without Redis.                                                |
| `LOG_LEVEL`          | `info`                        | Fastify logger verbosity: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                         |
| `SEED_DEMO_ROOM`     | `true`                        | Automatically seeds the `DEMO42` room with Big Buck Bunny on boot.                                                 |
| `RATE_LIMIT_REST`    | `true`                        | Enforces rate limits on room creation and joining endpoints.                                                       |
| `NEXT_PUBLIC_WS_URL` | `(empty)`                     | WebSocket endpoint for web browsers. Defaults to `http://<current-host>:4000`.                                     |

---

## Interactive Features and Discovery

### Group Taste Fusion Recommender

Finding what to watch in a group often leads to decision fatigue. Willio includes a Taste Fusion engine that calculates room recommendations:

- When joining, participants select favorite genres and moods, generating an individual taste vector.
- The algorithm computes a composite score for each catalog item using a hybrid formula:
  ```
  Score = 0.6 * AverageScore + 0.4 * MinimumScore
  ```
- Incorporating the minimum score enforces a "least-misery" constraint, ensuring no participant is subjected to content they strongly dislike.
- The UI displays a compatibility percentage bar for each room member and explains why the title was recommended.

### Spoiler-Safe Time-Locked Chat

To protect late-joining participants from plot spoilers:

- Every chat message is stamped with the playback position at the moment of sending.
- Participants whose playback position lags behind that timestamp see the message blurred with an indicator.
- Messages unblur automatically when the participant reaches that scene, or manually if clicked.

### Live Reactions and Seekbar Heatmap

- Participants can trigger animated pixel reactions using keys `1` through `9`.
- The server aggregates reactions into 250 ms time buckets to prevent socket flooding.
- Aggregated reaction density is mapped along the video timeline seekbar, highlighting peak emotional moments (humor, suspense, excitement).

### Shared Queue with Fractional Indexing

- Rooms support a shared collaborative playlist queue.
- Items are ordered using string-based fractional indexing keys (similar to Figma and Jira).
- Reordering items generates a key between adjacent items without requiring index renumbering, eliminating database contention.
- Queue items support participant upvoting and automatic succession to the next video.

### Smart Actionable Polls

Hosts or participants can create interactive polls directly inside the room:

- Poll types include "What to watch next", "Take an intermission", or "Skip to timestamp".
- When an actionable poll concludes, the winning option is applied automatically to the room timeline without requiring manual host intervention.

### Sync Health Dashboard

Pressing `H` at any time toggles the real-time Sync Health HUD:

- Visualizes round-trip latency (RTT), clock offset from the server, and local playback drift.
- Displays rolling p50, p95, and p99 propagation latency charts.
- Shows per-participant synchronization status to diagnose connection bottlenecks.

### Chaos Mode Fault Injection

For system demonstration and resilience verification, hosts can access the Chaos drawer:

- Inject artificial network latency (+300 ms RTT).
- Inject random packet drop rates (10%).
- Trigger artificial playback desynchronization.
- Force-disconnect the host to observe the automated 10-second succession failover.

### Scroll-Driven Canvas Landing Hero

The landing page features a cinematic scroll-scrubbed hero section:

- Driven by a canvas rendering pre-extracted WebP image sequences rather than inefficient `HTMLMediaElement.currentTime` seeking.
- Implements predictive bidirectional frame caching, sub-pixel damping, and adaptive portrait cropping for mobile viewports.
- Responsive to `prefers-reduced-motion` settings.

---

## Verification, Testing, and Benchmarking

Willio includes an automated testing and load verification suite to ensure correctness under real-world network conditions.

### Unit and Integration Tests

Run unit and integration test suites using Vitest:

```bash
npm test
```

To run server tests specifically (which spin up real Socket.IO connections in memory):

```bash
npm run test -w @willio/server
```

### End-to-End Browser Tests

Run browser integration tests using Playwright across multi-tab scenarios:

```bash
# Install Playwright browser binaries (one time)
npx playwright install chromium

# Execute end-to-end test suite
npm run test:e2e
```

### Bot Swarm Benchmarks

The benchmark suite spawns simulated headless client bots using the identical synchronization engine (`SyncCore`) found in web browsers:

```bash
# Run all benchmark scenarios (S1 through S9)
npm run bench

# Run a specific scenario with custom parameters
npm run bench -- --scenario S2 --users 25 --duration 300

# Run the strict CI validation gate (fails if p95 latency exceeds 250 ms)
npm run bench -- --ci
```

#### Benchmark Scenarios Summary

| Scenario ID | Name              | Target Users | Description                                                                     |
| ----------- | ----------------- | ------------ | ------------------------------------------------------------------------------- |
| **S1**      | Baseline LAN      | 10 users     | Concurrent play/pause/seek every 3-8 seconds with chat and reactions.           |
| **S2**      | Scale Test        | 25 users     | Heavy concurrent user load on a single room.                                    |
| **S3**      | Degraded Network  | 10 users     | Simulates 50 ms latency each way with 2% TCP retransmission delays.             |
| **S4**      | Join Storm        | 15 users     | Rapid concurrent joins to a room with media actively playing.                   |
| **S5**      | Reconnect Storm   | 10 users     | Simultaneous connection drops and ring-buffer replay recoveries.                |
| **S6**      | Host Drop         | 10 users     | Host disconnection and verification of automated host succession.               |
| **S7**      | Server Restart    | 10 users     | Simulated server crash, process restart, snapshot recovery, and client re-sync. |
| **S8**      | Buffering Laggard | 10 users     | One participant buffers continuously; tests room pause and catch-up isolation.  |
| **S9**      | Soak Test         | 25 users     | Extended duration stability and memory leak verification.                       |

All scenarios consistently demonstrate propagation p95 latency under 5 ms on LAN and post-correction drift below 70 ms (comfortably within the 500 ms ceiling).

---

## NPM Scripts Reference

| Script                     | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`              | Runs both server and web client concurrently in watch mode.                 |
| `npm run dev:server`       | Starts only the Fastify backend server with `tsx watch`.                    |
| `npm run dev:web`          | Starts only the Next.js web application on port 3000.                       |
| `npm run build`            | Compiles production builds for both server (`tsup`) and web (`next build`). |
| `npm start`                | Runs the compiled production server and web client concurrently.            |
| `npm test`                 | Executes unit and integration test suites via Vitest.                       |
| `npm run test:e2e`         | Runs end-to-end browser tests using Playwright.                             |
| `npm run lint`             | Lints TypeScript files across all packages and apps with ESLint.            |
| `npm run typecheck`        | Validates TypeScript types across all workspaces with `tsc --noEmit`.       |
| `npm run bench`            | Runs all bot swarm benchmark scenarios and outputs latency statistics.      |
| `npm run bench:report`     | Generates markdown latency summary tables from benchmark runs.              |
| `npm run seed`             | Seeds movie catalog data into PostgreSQL (requires `DATABASE_URL`).         |
| `npm run catalog:generate` | Regenerates `catalog.json` with fresh metadata.                             |
| `npm run db:migrate`       | Deploys pending Prisma schema migrations to the database.                   |
| `npm run db:generate`      | Regenerates the Prisma ORM client library.                                  |
| `npm run format`           | Formats all code files with Prettier.                                       |
| `npm run format:check`     | Verifies code conforms to Prettier formatting rules.                        |

---

## Keyboard Shortcuts

When inside an active watch party room:

| Key             | Action                                               |
| --------------- | ---------------------------------------------------- |
| `Space`         | Toggle Play / Pause                                  |
| `Left Arrow`    | Seek backward 5 seconds                              |
| `Right Arrow`   | Seek forward 5 seconds                               |
| `Up Arrow`      | Increase volume                                      |
| `Down Arrow`    | Decrease volume                                      |
| `M`             | Toggle Mute                                          |
| `F`             | Toggle Fullscreen                                    |
| `R`             | Force immediate resynchronization to server timeline |
| `H`             | Toggle Sync Health diagnostic dashboard              |
| `1` through `9` | Trigger hotbar emoji reactions                       |

---

## Production Deployment

### Container Deployment (Docker, Fly.io, Render, AWS ECS)

The repository provides two production Dockerfiles:

- `Dockerfile.server`: Multi-stage build producing an optimized Node.js runtime for Fastify and Socket.IO.
- `Dockerfile.web`: Multi-stage build producing an optimized standalone Next.js server.

#### Deployment Checklist

1. **Environment Variables**:
   - Define a strong, random `JWT_SECRET`.
   - Set `CORS_ORIGIN=https://your-web-domain.com`.
   - Configure `DATABASE_URL` pointing to your managed PostgreSQL instance.
   - Configure `REDIS_URL` pointing to your Redis cluster.
   - When building the web container, pass `NEXT_PUBLIC_WS_URL=https://your-server-domain.com`.
2. **WebSocket Support**:
   - Ensure your load balancer (e.g., NGINX, Cloudflare, AWS ALB) has WebSocket upgrades enabled.
3. **Session Affinity (Sticky Sessions)**:
   - If running multiple server instances behind a load balancer, route requests by room code or enable sticky sessions so all participants in a given room connect to the same server process, with state shared across Redis.
4. **HTTPS Enforcement**:
   - Always run production deployments under HTTPS to enable modern browser clipboard copy and media autoplay capabilities.

---

## Media and Licensing

- **Code License**: Licensed under the MIT License.
- **Demo Media**: Public domain and Creative Commons video streams utilized in the demo catalog (such as Big Buck Bunny, Sintel, Tears of Steel, and Cosmos Laundromat) are credited to the Blender Foundation and hosted via public archives.
- **User-Provided Content**: Users may load direct video URLs or YouTube links into rooms. Users are solely responsible for ensuring they have the rights to view and stream their selected media.
