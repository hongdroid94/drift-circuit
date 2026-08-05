# Drift Circuit

A browser 3D time-attack racer. Three circuits, three cars, three laps per race.
Drift to bank boost, chain corners for a score multiplier, then race your own
ghost.

Built on vanilla three.js + Vite + TypeScript. No physics engine, no asset
downloads, no backend. The whole game ships in **~636 KB (165 KB gzipped)**.

- **Design and market rationale:** [`docs/PRD.md`](docs/PRD.md)
- **Why this genre and channel:** [`docs/market-research.md`](docs/market-research.md),
  [`docs/market-research-round2.md`](docs/market-research-round2.md)

---

## Running it

```bash
npm install
npm run dev          # http://127.0.0.1:5188
npm run build        # -> dist/
npm run preview      # serve the production build on :4188
```

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer | `A` / `D` or `←` / `→` | Left stick | ◀ ▶ pads (bottom left) |
| Throttle | `W` / `↑` | RT | ▲ pad (bottom right) |
| Brake / reverse | `S` / `↓` | LT | ▼ pad |
| Handbrake | `Space` / `Shift` | A or RB | ▼ pad (doubles as handbrake) |
| Restart | `R` | — | Pause menu |
| Pause | `Esc` / `P` | — | Pause button |
| Diagnostics overlay | `F9` | — | — |

## How the game works

**Drift is a way to earn boost, not a faster line through a corner.** Break
traction, hold the angle, and the boost is paid out when you straighten up. That
is what stops the optimal line from collapsing into "shortest path" and gives
lap-time competition some depth.

Each race is 3 laps. Your **best single lap** is the record that unlocks cars;
total time is shown for context. Laps are validated by sector gates in order, so
cutting the circuit or reversing over the line does not score.

---

## Architecture

```
src/
  core/       Loop (fixed timestep), Renderer, InputController, Quality tiers
  entities/   Vehicle (physics), CarModel (procedural mesh)
  systems/    Track, World, CameraRig, LapTimer, DriftScorer, Ghost,
              Effects, AudioSystem, Save, Portal, Autopilot
  ui/         Ui (all screens + HUD, DOM-based)
  data/       tracks.ts, cars.ts  — all tuning lives here
  game/       Game (orchestrator + phase machine), TestHooks
```

Update order is fixed and deliberate:
`input → vehicle → lap/drift → effects → camera → render`.

### Key decisions

**Fixed 60 Hz timestep with render interpolation.** Handling feels identical on
60 Hz and 144 Hz displays and lap times stay comparable across machines.

**Custom vehicle physics, no Rapier/cannon-es.** The car is a point mass with a
heading. Steering rotates the heading; grip drags the velocity vector toward it;
a drift is simply a large angle between the two. This keeps `turnRate` and
`lateralGrip` from fighting each other the way a solver does, stays deterministic,
and costs a fraction of a WASM physics world on a mid-range phone. (The
`threejs-gameplay-systems` reference agrees: transform-driven racers with simple
barriers are the custom-collision case.)

Drag is *derived*, not hand-tuned: the quadratic coefficient is solved so full
throttle equilibrates at exactly the car's declared `topSpeed`. An earlier build
hard-coded it and every car silently capped at 66 km/h against a 187 km/h spec.

**Analytic ground queries, not raycasts.** The track is a closed Catmull-Rom
spline sampled every ~2 m into a uniform grid. Height, lateral offset, road width
and lap progress all come from a nearest-sample lookup, which is cheaper than
casting rays at triangles and cannot fall through the road on a slow frame.

**Procedural low-poly cars.** Built in code rather than from a free CC0 kit —
those kits are instantly recognisable to a portal curator who sees dozens of
games made from them. Costs nothing at runtime and keeps the download tiny.

**All UI is DOM.** Zero draw calls, crisp at any DPR, free focus and tap handling.

**Procedural audio.** Engine, tyre skid and UI sounds are synthesised with Web
Audio at runtime; no audio files ship. The engine note tracks speed continuously
through a faked 5-speed gearbox instead of cross-fading recorded loops.

---

## Performance

Measured on a GTX 1660 SUPER via headless Chromium with a real GPU backend
(`artifacts/states/report.json`):

| | Desktop 1280×720 | Mobile (Pixel 5 landscape) |
|---|---|---|
| Draw calls | 30 | 30 |
| Triangles | 7.7 k | 7.7 k |
| Quality tier | high (auto) | low (auto) |
| FPS | 60 | 60 |

The mobile budget in the canvas inspector is 150 calls / 300 k triangles, so
there is roughly 5× headroom. Scenery is instanced (one draw call per species),
particles and skid marks are fixed-size ring buffers allocated once, and
`QualityManager` demotes the tier one-way if measured FPS sits below 50.

**The 30 FPS / 85 %-of-users bar in the portal requirements has not been
verified on real hardware.** Everything above is desktop-GPU emulation. Testing
on an actual mid-range Android device is an open item.

---

## Verification

```bash
npm run verify:all          # typecheck + build + full Playwright suite
npm run test:bot            # drives 3 full races with the autopilot
npm run capture:states      # screenshots of every state, desktop + mobile
npm run verify:production   # smoke-tests the built bundle through the real UI
```

| Suite | What it guards |
|---|---|
| `visual.spec.ts` | Boots, renders a non-blank scene, responds to input, clean console |
| `drift.spec.ts` | **Every car can break traction with realistic input and bank boost** |
| `bot-playtest.spec.ts` | All three circuits are drivable end to end; laps validate |
| `car-model.spec.ts` | **Basis convention and mesh orientation** — no browser needed |

`npm run diagnose:steering` measures, objectively, whether "steer right" moves the
car toward the right-hand side of the *screen*. It projects the car's
displacement onto the camera's own +X axis, so the answer does not depend on
anyone's handedness reasoning being correct.

### The coordinate convention (read before touching Vehicle or Track)

`right = forward x up`. **Not** `up x forward` — in this system that is the
car's *left*.

The chase camera looks along `+forward`, and a camera looking down +Z has its
screen-right on -X. Getting this backwards is not a compile error and not a
crash: it inverts steering for the player, mirrors body roll, and flips the road
ribbon's triangle winding so the entire track gets backface-culled. All three of
those shipped at once during development, and the road-invisible symptom was
initially "fixed" by matching the *wrong* convention, which hid the steering bug
behind a working-looking screenshot.

Because `yaw` grows toward the car's left (`d(forward)/d(yaw) = -right`),
right-positive steering input enters `Vehicle` with a negative sign.
`car-model.spec.ts` asserts all of this directly.

`drift.spec.ts` exists because the failure it catches is silent: tuning can leave
a car whose slip threshold is so high that ordinary play never registers a drift.
Nothing crashes — the game just quietly stops having a mechanic.

The autopilot in `systems/Autopilot.ts` is also how the gold/silver/bronze
targets were set. Its best lap per circuit is the silver line; gold deliberately
requires banking drift boost, which the bot never does.

| Circuit | Autopilot best lap | Gold / Silver / Bronze |
|---|---|---|
| Sunset Loop | 21.9 s | 20 / 22 / 25 |
| Ridge Run | 33.1 s | 30 / 33 / 37 |
| Harbor Twist | 41.0 s | 37 / 41 / 45.5 |

---

## Deployment

`vite.config.ts` sets `base: './'` — portals serve games from a nested path and
absolute `/assets/…` URLs 404 there while working fine locally.

Test hooks (`__THREE_GAME_TEST_HOOKS__`, `__THREE_GAME_DIAGNOSTICS__`) are
compiled out of production builds; `verify:production` asserts their absence.

`systems/Portal.ts` wraps the CrazyGames SDK defensively — every call is a no-op
when the SDK is absent, so the same build runs on a portal, on itch.io, on a
plain static host and on `npm run dev`.

**Ad policy, per the PRD:** no preroll, no banners. Interstitials fire after a
race, at most one per 3 races and never within 90 s of the last. The first race
is always clean — "click and you are driving" is the only real advantage a web
game has.

---

## Known gaps

- **No real-device testing.** The 30 FPS mobile gate is unverified on actual
  hardware; all performance numbers are desktop-GPU emulation.
- **No audio verification.** The synthesis runs without errors in headless
  Chromium, but nobody has confirmed how it actually sounds.
- **Leaderboard is local only.** `Save` is `localStorage`; there is no server and
  no anti-cheat.
- **Ghost is transform-sampled, not input-replayed** — a few KB per lap, but it
  survives physics tuning, which input replay would not.
- Rewarded-ad hooks exist in `Portal` but nothing in the game spends them yet.
- Body roll direction during cornering has not been visually verified; it is
  cosmetic and derived from lateral acceleration, so a sign error there would be
  subtle rather than obvious.
