# Drift Circuit

**▶ Play: https://drift-circuit-game.vercel.app**

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

Crucially, **steering alone should not drift you.** Hard cornering steps the
tail out a little; the handbrake is what actually breaks traction. If plain
steering triggered a drift, the handbrake would be redundant and the decision
the whole mechanic is built around would disappear. This is enforced by the yaw
clamp below and guarded by a test.

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

**Yaw rate is clamped by available grip.** Holding a turn at speed `v` with yaw
rate `w` needs a lateral acceleration of `v*w`. Without a clamp the heading
rotates at the full steering rate however little grip is left, and full lock at
60 km/h produced 60-89 degrees of slip on every car — a spin, not a drift.
`Vehicle` therefore limits the demanded yaw to `grip * allowance / v`.

Two details in that formula were each worth a bug:

- **`allowance` is exactly 1 for ordinary steering**, not "a sliver above". At
  1.15 the car demanded 15% more grip than it had, and that deficit *accumulates*
  for as long as the turn is held — full lock reached 22 degrees and tripped an
  unasked-for drift. Anything above 1 belongs to the handbrake (3.2) and to
  sustaining a slide already underway.
- **`grip` is the grip that actually exists**, not the nominal `lateralGrip`.
  Using the nominal figure meant that on grass, where grip is halved, the clamp
  still authorised full-grip rotation — and once the slide tripped `isDrifting`
  the grip halved *again* while the allowance went up. Brushing a verge became
  an 88-degree spin.

The handbrake is deliberately exempt from the second rule: it locks the rear
axle only, and the front is what steers. Charging it against steering as well
cut the yaw rate by 3.3x the instant the player pulled it, and the starter car
lost the ability to drift at all.

Measured with `npm run measure:drift`, holding each turn for 2.4 s:

| on road, no handbrake | before | after |
|---|---|---|
| Peak slip, full lock | 22-27 deg | 2-10 deg |
| Drifts on steering alone | Comet/Vortex/Ember at 120 km/h | never, at any speed or lock |

**The barrier redirects the car instead of shoving it.** It used to add 55 m/s^2
inward — several times tyre grip — and leave the heading alone. Slip angle *is*
the gap between heading and travel, so the shove landed as slip: 6.7 degrees
became 87 within a second of contact, and 102 km/h collapsed to 2. Now contact
cancels the outward velocity component and turns the heading by however much the
velocity turned, so a scrape stays a scrape. Same idea as the yaw clamp — never
move the car in a way the car cannot account for.

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
| `drift.spec.ts` | **Every car can break traction with realistic input and bank boost**, steering alone never does, and barrier contact is not scored as a drift |
| `bot-playtest.spec.ts` | All three circuits are drivable end to end; laps validate |
| `car-model.spec.ts` | **Basis convention and mesh orientation** — no browser needed |
| `body-lean.spec.ts` | The car leans *out* of corners, not into them |

`drift.spec.ts` asserts both directions of the mechanic per car: the handbrake
*must* break traction and bank boost, and full lock *must not*. Tuning that
satisfies only one of those is a broken game either way.

It holds full lock for 2.4 s and ignores off-road samples. An earlier version
watched for 0.8 s and discarded anything under 40 km/h, and passed a build that
reached 22 degrees and drifted at 2.4 s — it stopped looking immediately before
the failure it existed to catch. Any test for something that *accumulates* has
to outlast the accumulation.

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

Anything derived from `right` inherits its sign, and fixing the basis therefore
*broke* the one place that had been compensating for it: cosmetic body roll came
out of the fix leaning into corners like a motorbike. It is measured now —
`car-model.spec.ts` pins which side a positive `rotation.z` drops,
`body-lean.spec.ts` pins the sign `Vehicle` feeds it, and neither assumes the
other's convention.

`drift.spec.ts` exists because the failure it catches is silent: tuning can leave
a car whose slip threshold is so high that ordinary play never registers a drift.
Nothing crashes — the game just quietly stops having a mechanic.

The autopilot in `systems/Autopilot.ts` is also how the gold/silver/bronze
targets were set. Its best lap per circuit is the silver line; gold deliberately
requires banking drift boost, which the bot never does.

| Circuit | Autopilot best lap | Gold / Silver / Bronze |
|---|---|---|
| Sunset Loop | 21.9 s | 20 / 22 / 25 |
| Ridge Run | 32.3 s | 30 / 33 / 37 |
| Harbor Twist | 40.7 s | 37 / 41 / 45.5 |

Ridge and Harbor dropped 0.8 s and 0.3 s when the barrier stopped scrubbing the
car to a standstill on contact. Silver is left where it is: it still sits just
the wrong side of the bot's best on all three circuits, which is the
relationship it is supposed to have.

---

## Deployment

`vite.config.ts` sets `base: './'` — portals serve games from a nested path and
absolute `/assets/…` URLs 404 there while working fine locally.

Test hooks (`__THREE_GAME_TEST_HOOKS__`, `__THREE_GAME_DIAGNOSTICS__`) are
compiled out of production builds; `verify:production` asserts their absence.

Live on Vercel, auto-deploying from `main`. `vercel.json` pins the Vite build and
sets caching: content-hashed assets are `immutable` for a year, the entry
document is `must-revalidate`. Framing is deliberately left allowed, since
portals embed games in an iframe — so no `X-Frame-Options`/`frame-ancestors`.

Vercel projects are created with SSO deployment protection on, which returns a
302 to `vercel.com/sso-api` for anyone not logged into the team. That has to be
cleared for a public game (`ssoProtection: null`), or the URL looks broken to
everyone but you.

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
