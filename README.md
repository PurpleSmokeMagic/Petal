# Petal 🌸

**A cycle-syncing planner for working women and students.** Petal plans tasks, workouts, meals and moods around the menstrual cycle, with its own AI agent that plans with you and can fill in your setup and logs, once you agree.

**Live demo:** https://petal-dz.vercel.app
No install and no account. For judges, to see every feature: **Settings → Subscription → turn on "Preview Pro features"**.

Built by **Lyna Cherif** for Thirduni Cohort 1, October 2026.

---

## The problem

Women lose about 10 days of productivity a year to menstrual symptoms: 1.3 days absent and the equivalent of 8.9 days working at reduced capacity. 68% want more flexibility in their tasks during their period (32,748 women, Schoep et al., *BMJ Open*, 2019). Among young women, 71% have period pain, 20% miss classes and 41% report poorer concentration (21,573 women, Armour et al., *Journal of Women's Health*, 2019).

Period trackers predict *when* a period comes. Nothing helps women plan their work, training and meals *around* it.

## What Petal does

| Screen | What it does |
|---|---|
| **Onboarding (7 steps, or by chat)** | Name, cycle data, occupation, body data and food allergies, used to personalise everything below. Answer the forms, or chat with the agent and save its suggestions. Steps cannot be skipped. |
| **Dashboard** | Today's cycle day and phase, the week ahead, and the day's plan. |
| **Planner with task check** | Add a task and Petal checks it against your phase. It flags cautions (for example deep work in the late luteal phase) and proposes a better date. |
| **Meals** | A phase-aware menu with calorie and macro targets (Mifflin St Jeor equation, adjusted by activity and goal, plus 100 kcal in the late luteal phase). |
| **Workouts** | Weights, pilates and yoga, and running, with phase-matched picks and safety notes. For example, the run pace is eased when you log fatigue or are in the luteal phase. |
| **Mood log** | Log moods and see patterns by day, month and cycle phase. |
| **Goals and productivity trends** | Productivity by day of the week and by phase, so you can see your own pattern. |
| **Petal Lens** | A second agent for photos. Snap a meal or a workout and Lens says what it sees, comments for your phase and diet, gives one recommendation and offers to log it. Photos are shrunk on the phone with location removed, and never saved. |
| **Petal agent** | Petal's own agent: its instructions, tools and reasoning loop run on Petal's server, with a Groq hosted open model (GPT-OSS 120B when available) as the language model. It looks up your phase, next period, training plan and calorie target, and proposes changes to your profile, cycle, diet, tasks, moods, meals, workouts and periods. Each change shows a Save button. |
| **Export** | CSV and JSON export of your data. |

## Privacy by design

- All data stays in your browser (`localStorage`). There is no account and no database.
- **The agent asks before anything leaves the device.** After you agree, your message and consented data go to Petal's server function, which holds the API key, runs the agent and stores nothing, and from there to Groq (United States).
- The agent only receives your cycle data plus the categories you allow in Privacy settings. It never receives your name or ids (in setup by chat, only what you type).
- Nothing is saved until you tap Save, and every change is validated on the server and again in the browser.
- A full security review (STRIDE, OWASP Top 10, OWASP Top 10 for LLM apps) is in [`SECURITY.md`](SECURITY.md).

### Using the agent

Nothing to install. Open **Assistant** (or **Set up by chatting instead** on the first setup screen) and tap **Agree and continue**. Withdraw any time in chat options or Privacy settings.

**Deploying your own copy:** add a free Groq key as the `GROQ_API_KEY` environment variable in Vercel (see `SECURITY.md`). Without it, the app works and the agent shows as unavailable. How the agent works: [`docs/AI_RULES.md`](docs/AI_RULES.md).

## Run locally

Requirements: Node 18+ (for tests and build) and Python 3 (or any static server).

```bash
git clone https://github.com/PurpleSmokeMagic/Petal.git
cd Petal
python -m http.server 5173 --bind 127.0.0.1    # open http://127.0.0.1:5173
node --test test/*.test.js                       # 46 tests
node build.js                                    # writes dist/index.html, one self-contained file
```

Tip: add `?today=2026-10-31` to the URL to pin the date.

## How it is built

```
index.html               app shell and Content Security Policy
design/petal.css         design system (phase colours, components)
src/petal-engine.js      data model, cycle engine, nutrition, workouts, task check, store, validation
src/exercise-catalog.js  exercises with phase guidance
src/assistant.js         agent client: talks to /api/agent, streams text and proposed changes
src/app.js               UI: screens and hash routes
agent/petal-agent.js     the Petal agent: instructions, setup and chat modes, tool loop, Groq connector
agent/server.js          shared request checks: origin, rate limit, date, model picking, event streaming
api/agent.js             Vercel server function: checks requests, holds the key, runs the agent, streams events
api/lens.js              Petal Lens: the photo agent's endpoint, strict image checks, a Groq vision model
test/                    46 unit tests (node:test): engine, agent loop, both endpoints and Lens
build.js                 inlines everything into one file and hashes scripts for the CSP
vercel.json              Vercel build and security headers
docs/                    engine, data model, assistant rules, entitlements, screens, roadmap
```

**Cycle model.** Calendar method: phase boundaries from cycle and period length, with ovulation about 14 days before the next period. With 3 or more logged cycles, the logged average replaces the typed length and irregular cycles are flagged. Next period is shown as a range, not a single date.

**Security.** CSP with SHA-256 hashed scripts, every input validated and length capped, imported files sanitised (including prototype pollution), CSV formula injection blocked, model tool calls validated before anything is written.

## Documentation

| File | What it covers |
|---|---|
| [`docs/CYCLE_ENGINE.md`](docs/CYCLE_ENGINE.md) | Phase maths, predictions, task check, workout and nutrition rules |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Stored state, logs, exercise catalog, validation |
| [`docs/AI_RULES.md`](docs/AI_RULES.md) | The Petal agent: how it runs, what it may see, tools, answer rules and limits |
| [`docs/ENTITLEMENTS.md`](docs/ENTITLEMENTS.md) | Free and Pro features |
| [`docs/SCREENS.md`](docs/SCREENS.md) | Screen codes used in the code, and their routes |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Done and planned milestones |
| [`SECURITY.md`](SECURITY.md) | Security review and open items |

## Tech stack

Vanilla JavaScript (no framework, no runtime dependencies), HTML, CSS · Node.js (build and `node:test`) · Vercel (static hosting, one server function, security headers) · Groq (open models such as GPT-OSS 120B, the language model behind the Petal agent) · AI tools used to build it: Claude (Anthropic) and Gemini (Google) for design, code, tests and the security review.

## Honest status

- **Pro** is a preview switch on the device. Billing and server-side checks are not built.
- **No accounts or sync yet.** Data lives in one browser. Log out only hides screens.
- **The agent is free for everyone while testing**, and the server cannot tell people apart without accounts. It is limited by origin, size and rate instead (see `SECURITY.md`).
- Fonts load from Google Fonts. Self-hosting is planned.
- Cycle prediction is an estimate. **Petal is not medical advice and not contraception.**

## Who built what

**Lyna Cherif** (solo): problem research, product design and screen flows, phase rules for tasks, workouts and nutrition, code and tests written with AI coding assistants (Claude, Gemini) and reviewed by her, security review, deployment, demo video.

## References

- Schoep ME, et al. Productivity loss due to menstruation-related symptoms: a nationwide cross-sectional survey among 32 748 women. *BMJ Open.* 2019;9:e026186.
- Armour M, et al. The prevalence and academic impact of dysmenorrhea in 21,573 young women: a systematic review and meta-analysis. *J Womens Health.* 2019;28(8):1161-1171.

