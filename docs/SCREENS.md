# Screens

The code refers to screens by short codes from the design mockups. Routes are hash routes in `src/app.js`.

| Code | Screen | Route |
|---|---|---|
| F2 to F8 | Onboarding, 7 steps: name, cycle baseline, how periods feel, body and goal, diet, daily activity, life (occupation) | `#/setup/1` to `#/setup/7` |
| F9 | Dashboard: phase card with a month calendar, quick actions, calories at the bottom | `#/` |
| | Day timeline: week strip, all day circles, tasks in time order, Now marker | `#/day/YYYY-MM-DD` |
| F10 | Meal menu | overlay on the dashboard |
| F11 | Day detail | overlay on the dashboard |
| F12 | Mood log | `#/mood`, `#/mood/new` |
| F13 | Assistant chat with the Petal agent | `#/assistant` |
| | Setup by chat with the Petal agent | `#/setup/chat` |
| | Logo screen for 1 second on every open | before any route |
| P1 | New task | from the planner |
| P2 | Task check: caution, with a suggested date | after saving a task |
| P3 | Task check: peak or fine | after saving a task |
| P4 to P6 | Planner (Goals tab) | `#/goals` |
| P7, P8 | Productivity trends | `#/goals/productivity` |
| W1 to W6 | Workout screens: hub, weight training, exercise detail, pilates and yoga, running timer | `#/workout`, `#/workout/weights`, `#/workout/pilates-yoga`, `#/workout/run` |
| W2 | Phase caution banner, with a short form on the exercise lists (W3, W4) | inside workouts |
| | Settings, privacy, notifications, subscription | `#/settings/...` |

Add `?today=2026-10-31` to the URL to pin the date the mockups use. Add `?debug` to expose the store as `window.petalStore`.
