# Petal 🌸

**A cycle-syncing planner for working women and students.** Petal plans tasks, workouts, meals and moods around the menstrual cycle, with an AI assistant that runs on your own computer, or online once you agree.

**Live demo:** https://petal-swart-phi.vercel.app
No install and no account. For judges, to see every feature: **Settings → Subscription → turn on "Preview Pro features"**.

Built by **Lyna Cherif** for Thirduni Cohort 1, October 2026.

---

## The problem

Women lose about 10 days of productivity a year to menstrual symptoms: 1.3 days absent and the equivalent of 8.9 days working at reduced capacity. 68% want more flexibility in their tasks during their period (32,748 women, Schoep et al., *BMJ Open*, 2019). Among young women, 71% have period pain, 20% miss classes and 41% report poorer concentration (21,573 women, Armour et al., *Journal of Women's Health*, 2019).

Period trackers predict *when* a period comes. Nothing helps women plan their work, training and meals *around* it.

## What Petal does

| Screen | What it does |
|---|---|
| **Onboarding (7 steps)** | Name, cycle data, occupation, body data and food allergies, used to personalise everything below. |
| **Dashboard** | Today's cycle day and phase, the week ahead, and the day's plan. |
| **Planner with task check** | Add a task and Petal checks it against your phase. It flags cautions (for example deep work in the late luteal phase) and proposes a better date. |
| **Meals** | A phase-aware menu with calorie and macro targets (Mifflin St Jeor equation, adjusted by activity and goal, plus 100 kcal in the late luteal phase). |
| **Workouts** | Weights, pilates and yoga, and running, with phase-matched picks and safety notes. For example, the run pace is eased when you log fatigue or are in the luteal phase. |
| **Mood log** | Log moods and see patterns by day, month and cycle phase. |
| **Goals and productivity trends** | Productivity by day of the week and by phase, so you can see your own pattern. |
| **AI assistant** | A chat that knows your phase and plans with you. It can propose tasks and mood logs, which you confirm before anything is saved. Runs online (Groq) after a consent screen, or fully on your computer (Ollama). |
| **Export** | CSV and JSON export of your data. |

## Privacy by design

- All data stays in your browser (`localStorage`). There is no account and no database.
- **The assistant asks before anything leaves the device.** Online mode sends your message and consented context to Groq (United States) through Petal's own server function, which holds the API key and stores nothing. Local mode runs on your computer through Ollama or LM Studio, and the app refuses any non-local model address.
- The model only receives your cycle phase plus the categories you allow in Privacy settings. It never receives your name or ids.
- A full security review (STRIDE, OWASP Top 10, OWASP Top 10 for LLM apps) is in [`SECURITY.md`](SECURITY.md).

### Running the assistant

**Online (no install).** Open **Assistant** on the live link and tap **Agree and continue**. You can switch back to local in chat options, which withdraws consent.

**On your computer (nothing leaves the device):**

1. Install [Ollama](https://ollama.com) and run `ollama pull llama3.2`.
2. On the live link, allow the site: set `OLLAMA_ORIGINS` to the live link's address, then restart Ollama. Not needed when you run Petal locally.
3. Open **Assistant**, then **Use a model on this computer**.

**Deploying your own copy:** add a free Groq key as the `GROQ_API_KEY` environment variable in Vercel (see `SECURITY.md`). Without it, only local mode is offered.

## Run locally

Requirements: Node 18+ (for tests and build) and Python 3 (or any static server).

```bash
git clone https://github.com/PurpleSmokeMagic/Petal.git
cd Petal
python -m http.server 5173 --bind 127.0.0.1    # open http://127.0.0.1:5173
node --test test/*.test.js                       # 32 tests
node build.js                                    # writes dist/index.html, one self-contained file
```

Tip: add `?today=2026-10-31` to the URL to pin the date.

## How it is built

```
index.html               app shell and Content Security Policy
design/petal.css         design system (phase colours, components)
src/petal-engine.js      data model, cycle engine, nutrition, workouts, task check, store, validation
src/exercise-catalog.js  exercises with phase guidance
src/assistant.js         assistant client: local model or /api/chat, streaming, tool calls
src/app.js               UI: screens and hash routes
api/chat.js              Vercel server function for the online assistant (holds the Groq key, builds the prompt)
test/                    32 unit tests (node:test), engine and server function
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
| [`docs/AI_RULES.md`](docs/AI_RULES.md) | What the assistant may see, answer rules, tools and limits |
| [`docs/ENTITLEMENTS.md`](docs/ENTITLEMENTS.md) | Free and Pro features |
| [`docs/SCREENS.md`](docs/SCREENS.md) | Screen codes used in the code, and their routes |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Done and planned milestones |
| [`SECURITY.md`](SECURITY.md) | Security review and open items |

## Tech stack

Vanilla JavaScript (no framework, no runtime dependencies), HTML, CSS · Node.js (build and `node:test`) · Vercel (static hosting, one server function, security headers) · Groq (hosted Llama 3.3 70B) · Ollama / LM Studio (local LLM, for example Llama 3.2) · AI tools used to build it: Claude (Anthropic) and Gemini (Google) for design, code, tests and the security review.

## Honest status

- **Pro** is a preview switch on the device. Billing and server-side checks are not built.
- **No accounts or sync yet.** Data lives in one browser. Log out only hides screens.
- **The online assistant is not checked for Pro on the server**, because there are no accounts yet. It is limited by origin, size and rate instead (see `SECURITY.md`).
- Fonts load from Google Fonts. Self-hosting is planned.
- Cycle prediction is an estimate. **Petal is not medical advice and not contraception.**

## Who built what

**Lyna Cherif** (solo): problem research, product design and screen flows, phase rules for tasks, workouts and nutrition, code and tests written with AI coding assistants (Claude, Gemini) and reviewed by her, security review, deployment, demo video.

## References

- Schoep ME, et al. Productivity loss due to menstruation-related symptoms: a nationwide cross-sectional survey among 32 748 women. *BMJ Open.* 2019;9:e026186.
- Armour M, et al. The prevalence and academic impact of dysmenorrhea in 21,573 young women: a systematic review and meta-analysis. *J Womens Health.* 2019;28(8):1161-1171.

