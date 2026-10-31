# Entitlements (Free and Pro)

Source: `PRO_FEATURES` and `can()` in `src/petal-engine.js`.

| Feature key | What it unlocks | Free | Pro |
|---|---|---|---|
| `taskCheck` | Task check against the phase, with a suggested date | | ✓ |
| `productivityTrends` | Productivity charts by day and month | | ✓ |
| `phaseScaling` | +100 kcal and adjusted macros in the late luteal phase | | ✓ |
| `assistant` | The AI assistant | | ✓ |
| `phaseWorkouts` | Phase-matched exercise picks and the intensity cap | | ✓ |
| `moodPatterns` | Mood patterns by phase | | ✓ |
| Everything else | Onboarding, dashboard, phases, predictions, planner, meals, all exercises, mood log, export | ✓ | ✓ |

## Current state

- `settings.plan` is a **client-side flag**. **Settings → Subscription → "Preview Pro features"** switches it on, on that device only, for testing and demos.
- No billing exists yet.

## Before launch (milestone 6, see `ROADMAP.md`)

- Pro must be checked on the server. The server function checks the subscription before calling a hosted model.
- Remove the "Preview Pro features" switch.
