# Cycle engine

How Petal turns a few setup answers into phases, predictions and advice. Source: `src/petal-engine.js`. Tests: `test/petal-engine.test.js`.

Petal gives estimates, not medical advice, and is never a method of contraception.

## Inputs

| Field | Range | Default |
|---|---|---|
| Last period start | `YYYY-MM-DD` | required |
| Cycle length | 21 to 45 days | 28 |
| Period length | 2 to 10 days | 5 |

All dates are local calendar dates. Derived values (cycle day, phase, predictions, scores) are computed on read and never stored.

## Phases

```
ovulationDay = max(cycleLength - 14, periodLength + 1)
menstrual    = day 1 .. periodLength
follicular   = periodLength + 1 .. ovulationDay - 1   (can be empty on short cycles with long periods)
ovulation    = ovulationDay
luteal       = ovulationDay + 1 .. cycleLength
fertile      = ovulationDay - 5 .. ovulationDay + 1   (overlay, not a phase)
late luteal  = the last 7 days of the cycle
```

Ovulation is placed 14 days before the next period because the luteal phase varies less than the follicular phase.

Cycle day for any date, past or future:

```
cycleDay = (daysBetween(lastPeriodStart, date) mod cycleLength) + 1
```

## Learning from logged periods

`getEffectiveCycle()`:

- Cycle lengths between logged period starts are measured. Gaps under 15 or over 60 days are ignored as logging mistakes.
- With **3 or more** measured cycles, the typed cycle length is replaced by the **rolling mean of the last 6**.
- If the longest and shortest of those cycles differ by **more than 7 days**, the cycle is flagged as irregular.
- Every result carries a basis line: "Based on your setup answers" or "Based on your last N cycles".

## Next period prediction

`predictNextPeriod()` returns a **range**, never a single certain date:

| Situation | Margin around the predicted start |
|---|---|
| Regular, spread of 3 days or less | ± 1 day |
| Spread of 4 to 7 days | ± 2 days |
| Irregular (spread over 7 days) | ± half the spread, plus a note suggesting a clinician |

## Task check (Pro)

`getTaskAdvice()` checks a task against the phase of its due date:

| Result | Rule |
|---|---|
| `peak` | Due within 1 day of the estimated ovulation date |
| `caution` | Deep focus work due in the menstrual or luteal phase. Suggests the 2nd day of the next follicular phase (1 day of margin, since phases are estimates) |
| `ok` | Anything else, and any date already past |

It also reports how many tasks are already in that week and whether a tired mood (exhausted, anxious, irritable) was logged today.

## Workout plan

`getWorkoutPlan()` sets an intensity cap from 1 (gentle) to 5 (peak). It is advice only and never blocks a workout.

| Phase | Cap |
|---|---|
| Menstrual | 3 |
| Follicular | 4 |
| Ovulation | 5 |
| Luteal | 4 |
| Late luteal | 3 |

Each of these signals lowers the cap by 1: exhausted logged today, pain of 6/10 or more logged today, a session with effort 8/10 or more yesterday.

- Weights: suggested load is 40, 50, 60, 80 or 100% of usual loads for caps 1 to 5.
- Running targets: menstrual 15 to 20 min, follicular 30 to 40, ovulation 30 to 45, luteal 20 to 30. With any signal, the top of the range is capped at the bottom plus 10. Mothers get 75% of the time.
- Workout types the person said they like get a +1 ranking bonus.

Exercises come from `src/exercise-catalog.js` (20 entries across gym, bodyweight, pilates and yoga). The catalog is marked as a draft that needs review by a qualified trainer or physiotherapist before launch.

## Nutrition

`getCalorieTarget()`:

```
BMR  = 10 × weightKg + 6.25 × heightCm − 5 × age − 161     (Mifflin St Jeor, female)
TDEE = BMR × activity factor (1.2, 1.375, 1.55 or 1.725)
kcal = TDEE × (1 − 0.15 for loss | + 0.10 for gain | 0 for maintain)
```

- Age defaults to 30 when not given, and the basis line says so.
- Macros: 45% carbs, 25% protein, 30% fat.
- **Pro, late luteal:** +100 kcal and 50 / 22 / 28% macros.
- Micronutrient focus by phase: menstrual iron, magnesium, B vitamins; follicular vitamin E, zinc; ovulation fibre, antioxidants; luteal magnesium, calcium, vitamin B6.
- The calorie ring turns green under 50%, amber from 50%, orange from 80%, red at 100%.

## Scores

- **Mood score:** energized +2, calm +1, focused +1, anxious −1, irritable −1, bloated −1, exhausted −2. Charts clamp the daily total to −3..+3. Averages are available by day, month and phase.
- **Productivity score:** tasks done minus tasks missed, plus a completion rate. Available by day and month.
