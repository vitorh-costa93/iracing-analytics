# Live Coach Overlay — Design

## Context

The user wants a local, free replica of Trophi.ai's core value: real-time, in-session
coaching feedback while driving in iRacing. `iracing-analytics` (this repo) already has
rich post-session analysis of the same telemetry — corner detection, per-corner
consistency scoring, steering-correction/wheelspin detection (`lib/corner-detection.ts`,
`lib/traction-events.ts`), all validated against real driving data. The new capability
is doing an equivalent comparison **live**, while the car is on track, and showing it as
an on-screen overlay — something the current Next.js/Vercel web app has no way to do,
since it has no access to the driver's live simulator process.

Confirmed with the user (12/09/2026):
- Core gap vs. today: live, in-session feedback (not another post-session view).
- Delivery: visual overlay (not voice).
- Signals for v1: **all four** — braking point, steering correction, throttle/wheelspin
  (destracionamento), and lap-time delta/consistency per corner.
- No new Supabase project. The local app never touches Supabase directly — it calls a
  new authenticated endpoint on the existing `iracing-analytics` Vercel deployment,
  which uses the credentials that already exist there.
- Language/runtime: **C#/.NET**, not Node/Electron, chosen explicitly for performance —
  a native Windows overlay avoids Chromium's overhead and matches what established
  sim-racing overlay tools (SimHub, CrewChief) already do. This means the detection
  logic gets reimplemented in C#, not reused from TypeScript; the TS versions remain
  the source of truth for the underlying thresholds/philosophy to port faithfully.
- New repo: `vitorh-costa93/iracing-live-coach`, GitHub, separate from `iracing-analytics`.

## Architecture

Two components, one existing repo extended, one new repo:

```text
iracing-analytics (existing, Vercel + Supabase)
  -> new GET /api/telemetry/local-coach/baselines?car=<id>&track=<id>
     (shared-secret auth, same pattern as GARAGE61_IMPORT_SECRET)
     returns per-corner baselines for this car/track combo

iracing-live-coach (new, C#/.NET, runs on the user's Windows PC)
  -> BaselineSync: HTTPS GET to the endpoint above, cached to a local JSON file
     (one file per car+track combo), refreshed on app start / on demand
  -> TelemetryReader: iRacing SDK live feed (60Hz) via a shared-memory binding
     (irsdkSharp or equivalent maintained wrapper)
  -> LiveCoachEngine: per-sample comparison against the cached baseline for
     whichever corner the car is currently in (looked up by LapDistPct, not
     detected fresh live -- corner boundaries are static per track, already
     computed server-side)
  -> OverlayWindow: WPF, transparent, borderless, always-on-top, click-through
     when idle -- renders live deltas as the car approaches/passes each corner
```

## Components

### 1. `iracing-analytics`: `/api/telemetry/local-coach/baselines`

- **Method**: `GET`, query params `car` (car_id) and `track` (track_id).
- **Auth**: `x-import-key` header checked against a new env var
  (`LOCAL_COACH_SECRET`, distinct from `GARAGE61_IMPORT_SECRET` so the two
  integrations can be rotated independently), same rejection shape (401 + JSON
  message) as the existing bookmarklet routes.
- **Response shape** (per corner, for this car/track):
  ```json
  {
    "status": "ok",
    "trackLengthMeters": 5891,
    "corners": [
      {
        "number": 1,
        "name": "Copse",
        "startPct": 2.1,
        "endPct": 5.4,
        "brakingPointPct": 3.0,
        "brakingPointStdDev": 0.3,
        "correctionBaselineDeg": 6.2,
        "wheelspinRpmModel": { "a": 42.1, "b": 850 },
        "lapTimeContributionSeconds": 4.8,
        "lapTimeStdDev": 0.15
      }
    ]
  }
  ```
- **Computation**: reuses `lib/corner-detection.ts` for corner boundaries (same
  method already used by Car Comparison/Race Debrief — GPS heading, lateral-accel
  fallback) and `lib/track-corners.ts` for corner names (verified names only;
  an unnamed corner is a plain number, per this repo's existing non-negotiable
  rule — never invented) and the exact same baseline math already validated in
  `lib/traction-events.ts` (`CORRECTION_RATIO`, `CORRECTION_ABS_FLOOR_DEG`,
  `CORRECTION_MIN_PEAK_STEP_DEG`, the RPM-vs-speed gear model from
  `buildGearRpmModel`) and `car-comparison`'s corner-consistency scoring, run
  across this driver's own historical laps for that car/track. No new detection
  logic — this endpoint packages existing, validated analysis for external
  consumption.
- **No car/track history yet**: `corners: []`, not an error. The overlay app
  treats an empty list as "nothing to compare against yet" per corner, never
  fabricates a baseline.

### 2. `iracing-live-coach` (new repo)

- **BaselineSync**: on app start (and via a manual "Sync" button), calls the
  endpoint above for the car+track the user has selected (or auto-detected once
  the SDK reports a session), writes the JSON to
  `%APPDATA%/iracing-live-coach/baselines/<car>_<track>.json`. Reads use
  whatever is on disk if the network call fails — the app must never block
  driving on a failed sync.
- **TelemetryReader**: wraps the iRacing SDK's live telemetry (Speed, Brake,
  Throttle, SteeringWheelAngle, RPM, Gear, LapDistPct, Lap, YawRate) at the
  SDK's native update rate.
- **LiveCoachEngine**: for the corner containing the current `LapDistPct`,
  tracks this lap's own brake-onset point, steering "wasted motion" in that
  corner's window, and RPM-vs-speed surplus, comparing each against the cached
  baseline the same way the TS detectors already do (ratio + absolute floor for
  corrections, RPM-surplus-at-high-throttle for wheelspin, direct percentage
  delta for braking point and lap-time contribution). Ported faithfully from
  the validated TS constants — not reinvented.
- **OverlayWindow**: WPF, `AllowsTransparency=true`, `WindowStyle=None`,
  `Topmost=true`, click-through via `WS_EX_TRANSPARENT` when not being
  interacted with. Shows, per corner as it's approached/exited, small
  deltas for whichever signals have a baseline (e.g. "Frenagem: 8m antes",
  "Correção: dentro do normal", "Destracionamento: +12% RPM na saída").

## Data flow (end to end)

```text
1. Driver opens iracing-live-coach before/while in an iRacing session.
2. App detects car+track from the SDK session info, triggers BaselineSync.
3. BaselineSync calls iracing-analytics, caches the JSON locally.
4. TelemetryReader streams live samples; LiveCoachEngine matches each sample's
   LapDistPct to a cached corner and accumulates this lap's own values for it.
5. On exiting a corner's window (LapDistPct crosses endPct), LiveCoachEngine
   finalizes that corner's comparison and pushes it to OverlayWindow.
6. OverlayWindow renders the delta until the next corner's result arrives.
```

## Error handling

- No network / endpoint down at sync time: use last cached baseline; if none
  exists yet for this car/track, overlay shows "sem histórico ainda" and stays
  otherwise idle (no crash, no blocking dialog).
- iRacing SDK not running / not in a session: overlay shows an idle state,
  polls for a session rather than erroring out.
- A corner with too few historical laps for its own baseline (mirrors
  `CORRECTION_MIN_LAPS`/`WHEELSPIN_MIN_GEAR_SAMPLES` server-side): the endpoint
  omits that specific signal for that corner (`null`), not a fabricated number;
  the overlay skips showing that one signal for that corner.

## Testing

- `iracing-analytics`: unit tests for the new endpoint's baseline-shaping logic
  (it's a thin packaging layer over already-tested `corner-detection`/
  `traction-events` functions — tests cover the shaping/response contract, not
  re-testing the underlying math).
- `iracing-live-coach`: an xUnit test project for `LiveCoachEngine`'s
  comparison logic, fed synthetic telemetry sequences (mirrors the fixture
  style already used in `lib/traction-events.test.ts`) so the C# port's
  thresholds are provably equivalent to the validated TS ones. The SDK
  reader and overlay rendering are validated by driving real sessions, the
  same "validate against real data before shipping" discipline used
  throughout `iracing-analytics` this cycle.

## Out of scope for v1

- Voice feedback.
- Any write path back into Supabase from the local app.
- Corner detection running live (corners are looked up from the cached
  baseline, not re-detected in real time).
- Multi-driver/team comparison, live strategy, fuel/tire modeling.
