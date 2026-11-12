# DECKS OF DOOM — Build Your Way Out

A fast 3D construction platformer for the browser. You are a builder stranded on a chain of
floating islands while a wall of doom eats the world behind you. The only way forward is to
**build while you run**: snap decks, bridges, stairs and ramps into the void — even in mid-air —
and stay ahead of the collapse.

- Three replayable courses with distinct looks and hazards: **Sunrise Shoals**, **Thunder Reach**, **Cinder Crown**
- Snap-to-grid building with a live ghost preview; hold the build key to pave under your feet at full sprint
- Tight movement: coyote time, jump buffering, variable-height jumps, double jump, air dash, ledge mantling
- Limited wood: bridges are cheaper per metre than decks, jumps are free — leftover wood is score
- Islands and your own constructions crumble into debris when the doom reaches them
- Spinners, moving platforms, crumbling stepping stones and (course 3) telegraphed meteors
- Checkpoints, three lives, timer, stars, medals, per-course best scores (localStorage)
- Procedural everything: geometry, sky, cloud sea, particles, sound effects and adaptive music. No asset downloads, no backend.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Run (relative to camera) |
| Mouse (click to capture) / `←` `→` | Look / turn |
| `Space` | Jump, press again in the air to double jump |
| `Shift` | Dash (once per air-time) |
| Left click / `E` / `F` | Build the selected piece — hold to keep paving |
| `1`–`4`, `Q`, mouse wheel | Select Deck / Bridge / Stairs / Ramp |
| `R` | Retry from the last checkpoint (costs a life) |
| `Esc` / `P` | Pause |

Tips: the ghost shows exactly where the next piece will snap. Standing on the ground it targets the
first empty tile ahead; in the air it targets the tile under you, so you can jump a gap and build your
own landing. Bridges cover three tiles for two wood.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run build` type-checks with `tsc` and writes the static site to `dist/`.

## Deploy to Vercel

The repo is a plain Vite static site and includes `vercel.json` (framework `vite`, output `dist`).

1. Import the repository at vercel.com → **Add New… → Project**. The defaults are detected; no environment variables are needed.
2. Or from a terminal:

```bash
npx vercel --prod
```

Any static host works too: upload the contents of `dist/`.

## Playtest

`tests/play.mjs` launches the production build in headless Chromium (Playwright must be available) and
plays the game with real keyboard input: run, jump, pave across the first gap, switch pieces, pause/resume,
and lose a life to the doom. It then lets the built-in auto-runner (`?bot`) attempt each course.

```bash
npm run build
```

```bash
npm run test:play
```

The auto-runner finishes courses 1 and 2. Course 3 is balanced for human jump-and-build play and the
simple bot does not finish it; that run is reported as informational.

Debug URL flags: `?low` (no bloom/AA, smaller shadows), `?unlock` (all courses), `?bot` (auto-runner), `?nometeor`.

## Tech

TypeScript · Vite · Three.js. Physics is a small custom kinematic AABB controller (sub-stepped, with
step-up and moving-platform carry) — a general physics engine was not worth the bundle size here.
Lighting is one shadow-casting sun that follows the player plus hemisphere fill; bloom via
`UnrealBloomPass`. Levels are generated from fixed seeds, with a running wood budget so a
bridge-efficient builder can always afford the next gap.

```
src/main.ts    game loop, input, camera, HUD, flow, auto-runner
src/level.ts   course generator, buildable pieces, doom, hazards, pickups, course definitions
src/player.ts  character controller and procedural character animation
src/env.ts     sky, cloud sea, lighting, themes
src/fx.ts      particles, debris, procedural textures
src/audio.ts   WebAudio sound effects and music sequencer
```
