# Failure handling matrix

Detection and recovery times are from the bench scenarios (see `docs/LATENCY.md` for the measured values of the
latest run) or from the timers in `packages/shared/src/constants.ts`.

| Failure | Detection | Recovery | What users see | Verified by |
| --- | --- | --- | --- | --- |
| Client network drop | Socket.IO `disconnect`, or heartbeat ping without pong for 5 s | Auto-reconnect (500 ms -> 8 s backoff + jitter), clock burst, `room:join {lastEseq, bootId}` -> replay of missed events (ring of 300) or snapshot | "Connection lost - reconnecting" banner, local playback keeps going, queued chat shows "sending...", then "Synced!" | S5, integration test "replays missed events after a reconnect", Chaos: force disconnect |
| Dropped / lost message | `eseq` gap on the next event, or pong `eseq` > local | `sync:replay` returns exactly the missing events in order | nothing (heals silently) | Chaos: 10% packet drop |
| Host disconnects | `disconnect` on the host socket | 10 s grace, then longest-connected participant becomes host (`hostEpoch` guards races); returning host is a viewer | greyed avatar "reconnecting...", then "Host transferred" achievement toast | S6, integration test "automatic host succession" |
| Server crash / restart | sockets drop | Room snapshots in Redis (or `.data/` files) restored on boot, clients reconnect; `bootId` changed -> full snapshot; at most ~200 ms of mutations before a hard crash can be lost | short reconnect banner, playback continues on the same wall-clock timeline | S7, integration test "restores rooms ... after a server restart" |
| Redis down | ioredis `error` / not ready | Degrade to in-memory: snapshots skipped (logged once), everything else unaffected; resumes when Redis returns | nothing | manual (stop the redis container) |
| PostgreSQL down | Prisma connection error (`P1xxx`) | Durable writes stay queued (max 20k) and retry every 5 s; realtime never blocks on the DB | nothing | manual (stop the postgres container) |
| Duplicate / retried event | `eventId` already in the LRU (500) | Acked with the original `seq`, `duplicate: true`, not re-applied | nothing | integration test "is idempotent for retried events" |
| Out-of-order delivery | `seq <= latest` | Ignored by `SyncCore` | nothing | unit test "ignores stale and duplicate sequence numbers" |
| Late / slow packet | `scheduledAt` already passed on arrival | Applied immediately at the position the timeline has reached (still on the shared timeline), drift loop removes the residue | nothing | unit test "applies late packets immediately on the intended timeline", S3 |
| Slow / buffering client | player stalled > 400 ms during playback | `WAIT_FOR_ALL`: room freezes up to 4 s, then resumes and puts the laggard in 30 s catch-up mode; `NEVER_WAIT`: no freeze | "Waiting for Aman..." toast, then "Not waiting for Aman - they'll catch up" | S8, Chaos: buffer 3s |
| Client out of sync | drift loop every 500 ms | nudge (60-500 ms), hard seek (>= 500 ms, cooldown 2 s, max 3 / 10 s), then "Resync me" suggestion | badge ADJUSTING / RESYNCING, then IN SYNC | Chaos: desync +3s, unit tests |
| Clock jump / bad offset | offset jump > 250 ms or RTT > 2x best | outlier samples rejected; a jump is accepted only after 3 confirming samples; visibility change re-measures | nothing | unit tests (ClockEstimator) |
| Tab backgrounded / laptop slept | `visibilitychange` -> visible | 3-ping clock burst + re-anchor | brief ADJUSTING badge | manual |
| Autoplay blocked by the browser | `play()` rejects with `NotAllowedError` (YouTube: not started within 2.5 s) | "Click to join playback" overlay; the click calls `play()` inside the gesture | overlay with a big play button | manual (fresh tab with sound) |
| Media fails to load | `<video>` error, fatal hls.js error after 3 recoveries, YouTube error | error overlay with Retry (re-fetches snapshot) | "Video failed to load" | manual (bad URL in the queue) |
| Message flood / spam | per-user fixed windows (chat 5/5 s, reactions 10/s, playback 15/3 s, ...) | rejected with `RATE_LIMITED`; reactions aggregated server-side in 250 ms windows (one broadcast per window) | "Easy there!" toast | integration test "aggregates a reaction flood" |
| Invalid / expired room code | REST 404 / regex | "You fell into the void" page with a create-room CTA | void page | E2E "unknown rooms show the void page" |
| Expired / invalid token | socket middleware rejects `UNAUTHORIZED` | client clears the session and re-joins through REST (name modal) | name modal | integration test "rejects sockets without a valid token" |
| Same session in two tabs | second `room:join` with the same user id | latest tab wins; older tab gets `session:replaced` and is disconnected | "Opened in another tab" screen with "Use this tab instead" | integration test "latest tab wins" |
| Room full | participant count >= `ROOM_MAX_USERS` | join rejected (`ROOM_FULL`) | "This room is full" | - |
| Wrong room password | bcrypt compare fails | REST 401 | inline error under the password field | integration test |
