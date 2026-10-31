# Data model

Everything lives in one JSON object in the browser's `localStorage` under the key `petal.state.v1` (schema version 1). There is no server yet. Source: `createInitialState()` and `migrate()` in `src/petal-engine.js`.

## State

| Section | Fields |
|---|---|
| `profile` | `displayName`, `username` (generated, editable), `heightCm`, `weightKg`, `units` (`metric` or `imperial`, display only), `birthDate` (optional, `YYYY-MM-DD`; gives the age), `age` (older saves only; `birthDate` wins), `avatar` (`{ kind: initial | emoji | photo, color, emoji, photo }`; the photo is a JPEG data URL of at most 120 KB, made on the phone), `activityTier` (1 to 4), `workoutsLiked`, `occupation` (`student`, `professional`, `homemaker`, `freelancer`), `isMom`, `sexuallyActive` (optional) |
| `cycle` | `lastPeriodStart`, `cycleLength`, `periodLength`, `typicalPain` (1 to 10), `typicalFlow` (`light`, `medium`, `heavy`) |
| `health` | `goal` (`loss`, `gain`, `maintain`), `conditions`, `dietStyles`, `allergies` |
| `logs` | Flat arrays, see below |
| `settings` | `theme`, `locale`, `plan` (`free` or `pro`, a UI mirror only), `onboardingStep`, `assistantCanUse` (consent per category), `assistant` (`consent`: agreed to send chats to the Petal agent), `notifications`, `signedOut` |

## Logs

Every entry has an `id` limited to `[\w-]`.

| Log | Fields |
|---|---|
| `meals` | `date`, `meal` (breakfast, lunch, dinner, snack), `name`, `foodId`, `quantity`, `kcal`, `carbsG`, `proteinG`, `fatG` |
| `workouts` | `date`, `type`, `durationMin`, `effort`, `notes`, `sets: [{ exercise, sets, reps, loadKg }]` |
| `tasks` | `title`, `dueAt`, `type` (work, study, personal, home), `effort` (light, medium, deep), `status` (pending, done, missed), `completedAt`, `logNote`, `phaseAtDue`, `source` (`user` or `assistant`) |
| `moods` | `date`, `moods` (energized, calm, focused, anxious, irritable, bloated, exhausted), `note`, `source` |
| `periods` | `startDate`, `endDate`, `flow`, `pain`, `notes` |
| `symptoms` | `date`, `symptoms`, `pain`, `notes` |

## `exercises` table

Read-only catalog in `src/exercise-catalog.js`.

| Field | Meaning |
|---|---|
| `slug` | Stable id |
| `name` | Display name |
| `location` | `gym`, `bodyweight`, `pilates` or `yoga` |
| `intensity` | 1 (gentle) to 5 (peak) |
| `phases` | Phases the exercise is offered in |
| `figure` | Key of the line drawing in `FIGURES` |
| `muscles` | Muscles worked |
| `dose` | For example "3 sets of 12" |
| `description` | How to do it safely |

## Validation

Saved state and imported files are never trusted. On load, `migrate()`:

- re-validates every field against its enum, pattern or range, caps text lengths, and passes each log entry through a per-kind sanitiser
- drops `__proto__`, `constructor` and `prototype` keys (`safeParse`)
- adds new settings fields to older saves

CSV export neutralises spreadsheet formulas. See `SECURITY.md`.
