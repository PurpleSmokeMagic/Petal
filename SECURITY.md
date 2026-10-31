# Petal security review

Reviewed on 31 October 2026 against STRIDE, the OWASP Top 10 (2021) and the OWASP Top 10 for LLM applications (2025), and updated the same day for the Petal agent.
Scope: everything in this folder. That covers:
- the single page app (`index.html`, `src/*.js`)
- the agent (`agent/petal-agent.js`, `api/agent.js`)
- the build (`build.js`) and the Vercel config

There is no account system or payment flow yet, so findings about them are design requirements for milestone 1 and milestone 6 (see `docs/ROADMAP.md`).

## How data moves today

```
person ──> browser tab (Petal) ──> localStorage "petal.state.v1"   (all health data, plain JSON)
                    │
                    ├──> fonts.googleapis.com / fonts.gstatic.com  (font files only, no referrer)
                    │
                    └──> /api/agent on the same site (only after the person agrees)
                         gets: cycle data, plus only what Privacy settings allow, and the chat
                         never: name, username, ids (in setup mode, the name only if they type it)
                         └──> Groq, United States (llama-3.3-70b-versatile)
                              the key stays in the function (Vercel environment variable)
```

Trust boundaries:
1. The person and the page.
2. The page and browser storage, including imported files.
3. The page and the agent endpoint, which treats every request as untrusted.
4. The agent and the model, whose output is untrusted.
5. The page and third party origins (Google Fonts).

## Fixed

| # | Finding | Category | Fix |
|---|---------|----------|-----|
| 1 | No Content Security Policy. Any HTML injection could run script. | STRIDE T, E. OWASP A03, A05 | CSP meta in `index.html`: `default-src 'none'`, `script-src 'self'`, `connect-src 'self'`. `build.js` swaps the script rule for SHA-256 hashes of the four inlined scripts, so the built page runs no other inline script. |
| 2 | Saved state and imported files were trusted. A crafted export could put markup into settings that the app renders unescaped. | T, E. A03, A08 | `migrate` validates every field. Every log entry goes through a per kind sanitizer that fixes types and caps lengths. Ids are limited to `[\w-]`. |
| 3 | Prototype pollution through `__proto__` keys in imported JSON. | T. A08 | `safeParse` drops `__proto__`, `constructor` and `prototype` keys. Used for storage, imports, the agent's tool arguments and the endpoint body. |
| 4 | CSV export allowed formula injection (`=HYPERLINK(...)` runs in Excel or Sheets). | T. A03 | `csvCell` prefixes text that starts with `= + - @` or a tab with `'`. |
| 5 | The store was always exposed as `window.petalStore`. | I. A05 | Only with `?debug` in the URL. |
| 6 | Nothing showed whether an entry was created by the assistant. | R | Tasks and moods carry `source: 'user' | 'assistant'`. Planner rows say "Added by assistant". |
| 7 | Referrer leaked to Google Fonts. | I | `<meta name="referrer" content="no-referrer">`. |
| 8 | No hosting headers. | T, I. A05 | `vercel.json` sends `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS and `noindex`. |
| 9 | **Setup steps could be skipped** by typing `#/setup/7` into the URL, then finishing setup without a name or last period. The app then ran on missing data. | T. A01, A04 | `setupStepAllowed()` gives the furthest step the saved progress and required answers allow. The router redirects anything later. `advanceSetup()` never moves past a missing answer, and `completeSetup()` refuses until the name and last period are saved. An imported "done" without them restarts setup. After setup, step URLs open only to edit an answer from Settings. |
| 10 | Agent key, consent and abuse. | S, I, D, E. A01, A02, A10, LLM02, LLM06, LLM10 | Key only in a Vercel environment variable. Consent screen names Groq and its country before anything is sent. The endpoint fixes the instructions, model and tools, rebuilds messages from `user` and `assistant` text only, sanitises the snapshot with `migrate()`, checks `Origin`, sizes and the date, rate limits each address, calls one fixed URL and logs nothing. |
| 11 | The first version of the function cancelled its own model call. It listened for the request's `close` event, which fires once the body is read. | D | Listens on the response instead. Found in end to end testing. |

Tests: `test/petal-engine.test.js` (engine, validation, setup guard) and `test/agent.test.js` (agent loop and endpoint with a scripted model). 41 passing.

## STRIDE

| Threat | Where | Status |
|--------|-------|--------|
| **Spoofing** | No accounts. Anyone using the device is "the user". Log out only hides screens. | **Open, high before launch.** Milestone 1: real auth with server sessions. On a shared device, recommend Delete instead of Log out until then. |
| | Anyone can call `/api/agent` directly. `Origin` stops other websites in a browser, but a script outside a browser can fake it. | **Accepted for testing.** Abuse is bounded: Petal's own instructions refuse off topic requests, the tools are fixed, 700 tokens a round, 10 requests a minute per address, and Groq's free tier limits. It can use up the free quota, never money. With accounts: require a session. |
| **Tampering** | localStorage is editable by the person, extensions and any script on the origin. | Mitigated. Re-validated on load (fix 2). Script injection blocked by CSP (fix 1). |
| | Setup URLs. | Fixed (fix 9). |
| | The model proposes changes. | Mitigated. `validateToolCall()` runs on the server before a card is shown and in the browser before saving. Unknown tools, out of range values, future period starts and empty changes are refused, not clamped. Nothing is saved without a tap on Save. |
| **Repudiation** | No audit trail. | Partly fixed (fix 6). With a server, keep an append only log of plan changes. |
| **Information disclosure** | Health data is plain JSON in localStorage. | **Open, medium.** With accounts: server storage with row level security, only a cache locally. |
| | Google Fonts sees the visitor's IP. | **Open, low.** Self host the font and drop Google from the CSP. |
| | Data sent to the agent and Groq. | Mitigated. Consent first. Only the categories allowed in Privacy settings, built by `assistantSnapshot()`, never names or ids. In setup mode only yes or no per topic. Chats are kept in memory only and the function logs nothing. Check Groq's data retention terms before a real launch. |
| **Denial of service** | Long text could fill storage, and a full quota fails silently. | Mitigated. Lengths capped. Still open: tell the person when a save fails. |
| | Agent requests. | Mitigated. See the limits table in `docs/AI_RULES.md`. |
| **Elevation of privilege** | Pro is a client flag (`settings.plan`). | **Open by design** (`docs/ENTITLEMENTS.md`). Enforce on the server and remove the preview switch before launch. |
| | The model tries to widen its own access. | Mitigated. No tool can change Privacy settings, consent, plan or setup progress, except `finish_setup`, which the app checks again. |
| | XSS. | Mitigated. Every dynamic value goes through `esc()`, model text is escaped before the only two markups allowed (bold, If/then), and CSP blocks inline and foreign script. |

## OWASP Top 10 (2021)

| Item | Result |
|------|--------|
| A01 Broken access control | Setup skipping fixed (fix 9). Pro gating is client only. With accounts: row level security on every table, and session checks in `/api/agent`. |
| A02 Cryptographic failures | No secrets in the client. The Groq key lives only in Vercel, and `GET /api/agent` reports only whether it is set. Data at rest is unencrypted in browser storage. |
| A03 Injection | XSS covered by `esc()` and CSP. CSV injection fixed. Prompt injection: see LLM01. No SQL yet. |
| A04 Insecure design | Client side entitlements and local data are known trade offs until milestone 1. The agent design keeps a person in the loop for every change. |
| A05 Security misconfiguration | CSP in the page plus real headers from `vercel.json`. The Python dev server is for local testing only. |
| A06 Vulnerable components | No runtime dependencies in the app or the function. Node is used only to build and test. |
| A07 Identification and authentication failures | Not built (milestone 1). Use the provider's hosted flows. |
| A08 Software and data integrity failures | Imports and snapshots validated. Inline scripts pinned by hash. Google Fonts CSS cannot use SRI. |
| A09 Logging and monitoring failures | The agent deliberately logs nothing, so abuse monitoring is limited to Vercel's request logs. |
| A10 Server side request forgery | The function calls one fixed URL and ignores any model, URL, tools or instructions sent by the client. |

## OWASP Top 10 for LLM applications (2025)

| Item | Result |
|------|--------|
| LLM01 Prompt injection | Logged text sits inside a `<user_data>` fence it cannot close. The real controls: narrow tools, validation on both sides, and a tap on Save for every change. **Residual:** injected text can still change the wording of advice or the values in a proposed change, which the person sees before saving. |
| LLM02 Sensitive information disclosure | Consent screen, category toggles, no names or ids, nothing stored. |
| LLM03 Supply chain | The model is fixed on the server (`GROQ_MODEL`, default `llama-3.3-70b-versatile`). |
| LLM04 Data and model poisoning | No training or fine tuning. Not applicable. |
| LLM05 Improper output handling | Model text is escaped before rendering. Tool arguments are validated twice. Model output never becomes HTML, URLs or code. |
| LLM06 Excessive agency | Fixed tool list per mode. Writes only after a tap. No delete, no settings, no network, no consent changes. |
| LLM07 System prompt leakage | The instructions hold no secrets. |
| LLM08 Vector and embedding weaknesses | No retrieval. Not applicable. |
| LLM09 Misinformation | Every chat answer carries the basis line, "This is an estimate, not medical advice." and a clinician pointer. **Before launch:** run the evaluation set in `docs/AI_RULES.md`. |
| LLM10 Unbounded consumption | Free tier, so a used up quota rather than a bill. Bounded rounds, tokens and sizes, and a per address rate limit (in memory per instance, so best effort). Before a paid key, add a shared rate limit and a monthly cost cap. |

## Open items, in priority order

1. **Before any public launch:** accounts and server storage with row level security, sessions checked in `/api/agent`, Pro enforced on the server, and the Pro preview switch removed.
2. Before a paid key: a shared rate limit (for example Vercel KV) and a monthly cost cap, and check the provider's data retention terms.
3. Self host the font and tighten the CSP to `'self'` only.
4. Show a message when saving to storage fails.
5. Run the evaluation set in `docs/AI_RULES.md`. Recheck when changing models.

## Setting up the agent (Vercel)

1. Create a free key at console.groq.com (API Keys).
2. In Vercel: the project, Settings, Environment Variables. Add `GROQ_API_KEY` for Production and Preview. Optional: `GROQ_MODEL`.
3. Redeploy. `GET /api/agent` should answer `{"available":true}`.

Never put the key in the code, the README or a chat message. If it leaks, revoke it in the Groq console and add a new one.
