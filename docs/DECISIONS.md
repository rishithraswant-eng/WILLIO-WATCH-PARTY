# Decisions log

Choices the PRD left open (or where we deviated), and why.

1. **Shared sync core.** `SyncCore`, `ClockEstimator` and `DriftController` live in `packages/shared` and are used
   unchanged by the browser and the bench bots, so benchmark numbers describe the shipped algorithm.
2. **Reliable delivery via `eseq`.** The PRD's "ring buffer of last 300 events" is implemented for *all*
   client-visible broadcasts (not only playback), keyed by a room-wide event sequence. Gaps trigger
   `sync:replay`. Playback keeps its own `seq` for ordering.
3. **Ping uses Socket.IO acks** instead of a separate `time:pong` event (no correlation ids, same semantics).
4. **RTT acceptance slack.** "Accept if RTT <= 2x best" rejects almost everything on localhost (best ~0 ms), so the
   rule is `rtt <= max(2 x best, best + 8 ms)`, plus a re-baseline after 5 consecutive slow samples.
5. **Chaos latency is symmetric.** Injected latency is extra *RTT*, split evenly between the inbound and outbound
   legs, so NTP-style offset estimation stays unbiased (asymmetric delay would silently shift that client's clock).
6. **Snapshot store fallback.** Without `REDIS_URL` the server writes room snapshots to `.data/` (atomic file
   writes) so crash recovery works in plain `npm run dev`; tests use an in-memory store.
7. **Durable DB is write-behind.** Prisma writes go through a batched queue; the app works fully without
   `DATABASE_URL`. The Prisma client is imported dynamically so dev without Postgres needs no running DB.
8. **Session tokens are per tab** (`sessionStorage`), profile (name, avatar, taste) is per browser
   (`localStorage`). A reload keeps your identity; a second tab is a second participant, which multi-tab demos need.
   Duplicated tabs share the token and hit "latest tab wins".
9. **Media durations come from clients.** Catalog runtimes are approximate, so the server only trusts the first
   `media:duration` reported by a real player before using it for end detection.
10. **Catalog.** `catalog.json` is generated (`npm run catalog:generate`) from ~420 real, well-known titles with
    approximate metadata and template synopses, plus 6 CC-licensed Blender open movies with verified public streams
    (BBB via HLS, Sintel/Tears of Steel/Elephants Dream MP4 from archive.org, Cosmos Laundromat WebM from Wikimedia,
    Spring via YouTube - one per adapter). Posters are generated pixel art (no copyrighted artwork); TMDB artwork is
    used when `TMDB_API_KEY` is set.
11. **Demo room `DEMO42`.** The PRD's demo code contains an `O`, which the unambiguous code alphabet excludes; it is
    accepted as a reserved code (generated codes can never collide with it).
12. **Non-free movies.** Only open films have streams. Other titles can be discovered, polled on and recommended,
    and can be watched by pasting a link the users have rights to.
13. **Network emulation in the bench** is application-level (in-order delivery, extra delay, TCP-style retransmit
    delay for "loss") so it runs on any OS without root; LATENCY.md documents tc/netem and clumsy for kernel-level runs.
14. **Charts** in the markdown report are generated SVGs (render on GitHub, no native canvas dependency).
15. **UI sounds** use a tiny WebAudio synth instead of howler + audio files (no assets, still OFF by default).
16. **Recap card** is drawn on a `<canvas>` client-side (PNG download / Web Share).
17. **Horizontal scaling** is documented (sticky routing by room code + Redis ownership lock) but the shipped
    deployment is a single server process; the PRD target load is far below a single process' capacity.
18. **REST rate limits** can be disabled with `RATE_LIMIT_REST=false` for local load tests (the bench does this for
    its own spawned server).
19. **VOTE control mode**: a viewer's play/pause/seek opens a 20 s "Allow?" poll that auto-applies on a yes
    majority; the requester's own vote counts as yes.
20. **Room dims, screen stays dark.** Inside a room the world background dims and blurs; the player frame always
    uses the dark token set (cinema), even in Misty Dawn, for contrast.
21. **Chat retention**: last 100 messages in memory (snapshot), everything in Postgres when configured.
