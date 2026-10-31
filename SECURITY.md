# Petal security review

Reviewed on 31 October 2026 against STRIDE, the OWASP Top 10 (2021) and the OWASP Top 10 for LLM applications (2025).
Scope: everything in this folder. That is the single page app (`index.html`, `src/*.js`), the build (`build.js`), and the local AI assistant.
There is no server, account system or payment flow yet, so findings about them are design requirements for milestone 1 and milestone 6.

## How data moves today

```
person ──> browser tab (Petal) ──> localStorage "petal.state.v1"   (all health data, plain JSON)
                    │
                    ├──> fonts.googleapis.com / fonts.gstatic.com  (font files only, no referrer)
                    │
                    └──> model server on this computer (Ollama, 127.0.0.1:11434)
                         gets: cycle day and phase, plus only what Privacy settings allow
                         never: name, username, ids
```

Trust boundaries:
1. The person and the page.
2. The page and browser storage, including imported files.
3. The page and the model, whose output is untrusted.
4. The page and third party origins (Google Fonts).

## Fixed in this pass

| # | Finding | Category | Fix |
|---|---------|----------|-----|
| 1 | No Content Security Policy. Any HTML injection could run script. | STRIDE T, E. OWASP A03, A05 | CSP meta in `index.html`: `default-src 'none'`, `script-src 'self'`, connections only to loopback. `build.js` swaps the script rule for SHA-256 hashes of the four inlined scripts, so `dist/petal.html` runs no other inline script. |
| 2 | Saved state and imported files were trusted. A crafted `petal-export.json` could put markup into settings that the app renders without escaping (reminder time, days before, theme). | T, E. A03, A08 | `migrate` now validates every field. Settings are checked against enums and patterns. Every log entry goes through a per kind sanitizer that fixes types and caps lengths. Ids are limited to `[\w-]`. |
| 3 | Prototype pollution through `__proto__` keys in imported JSON. | T. A08 | `safeParse` drops `__proto__`, `constructor` and `prototype` keys when reading storage and imports. |
| 4 | CSV export allowed formula injection. A task titled `=HYPERLINK(...)` runs in Excel or Sheets. | T. A03 | `csvCell` prefixes text that starts with `= + - @` or a tab with `'`. Numbers are untouched. |
| 5 | The store was always exposed as `window.petalStore`. | I. A05 | Only exposed with `?debug` in the URL. |
| 6 | Nothing showed whether an entry was created by the assistant. | R | Tasks and moods carry `source: 'user' | 'assistant'`. Planner rows say "Added by assistant". |
| 7 | Referrer leaked to Google Fonts. | I | `<meta name="referrer" content="no-referrer">`. |

Tests for 2, 3, 4 and the assistant rules are in `test/petal-engine.test.js` (28 passing).

## STRIDE

| Threat | Where | Status |
|--------|-------|--------|
| **Spoofing** | No accounts. Anyone using the device is "the user". Log out only hides screens, and the data stays readable on the device. | **Open, high before launch.** Milestone 1: real auth (Supabase email, Google, Apple) with server sessions. On a shared device, recommend Delete instead of Log out until then. |
| | Assistant endpoint could be pointed at another host that pretends to be a model. | Fixed. Loopback only (`isLoopbackUrl`), checked when saving the setting and again before every request. No credentials in the URL, no path. |
| **Tampering** | localStorage is editable by the person, browser extensions and any script that runs on the origin. | Mitigated. Everything is re-validated on load (fix 2). Script injection is blocked by CSP (fix 1). |
| | Imported files. | Mitigated (fixes 2 and 3). No import screen exists yet, so wire it to `importData` only. |
| | Model tool calls could write junk or call tools that do not exist. | Mitigated. `validateToolCall` refuses unknown tools, bad JSON, past or far dates and unknown enums. Writes need a tap on "Add it" and are validated again at that moment. |
| **Repudiation** | No audit trail. | Partly fixed (fix 6). With a server, keep an append only log of plan changes and subscription events. |
| **Information disclosure** | Health data is stored as plain JSON in localStorage, readable by anyone with the device or a malicious extension. | **Open, medium.** Browser storage cannot keep secrets from the device owner. With accounts: store on the server with row level security. Keep only a cache locally, cleared on log out. |
| | Google Fonts sees the visitor's IP on every load. | **Open, low.** Self host Plus Jakarta Sans (woff2 in `public/fonts`) and remove the two Google hosts from the CSP. |
| | Data sent to the model. | Mitigated. Only consented categories are sent, never names or ids. The model runs on the device, and the chat is kept in memory only. |
| **Denial of service** | Long text could fill storage, and a full quota fails silently. | Mitigated. Lengths are capped on input and import. Still open: tell the person when a save fails. |
| | Assistant requests. | Mitigated. 1000 character input, last 16 messages, `max_tokens` 700, 6000 character reply cap, 120 second timeout, Stop button, at most 3 tool rounds and 4 tool calls. |
| **Elevation of privilege** | Pro is a client flag (`settings.plan`). Anyone can switch it on. | **Open by design**, documented in `ENTITLEMENTS.md`. Pro must be enforced on the server: the edge function checks the subscription before calling a hosted model. The "Preview Pro features" switch must not ship. |
| | XSS leading to full control of the page. | Mitigated. Every dynamic value goes through `esc()`, and CSP blocks inline and foreign script. |

## OWASP Top 10 (2021)

| Item | Result |
|------|--------|
| A01 Broken access control | No server yet. Pro gating is client only (see Elevation of privilege). With Supabase: row level security on every table (`user_id = auth.uid()`), plus the subscription check in edge functions. |
| A02 Cryptographic failures | No secrets in the client and no API keys. Data at rest is unencrypted in browser storage (see Information disclosure). When hosted: HTTPS only, HSTS. |
| A03 Injection | XSS: `esc()` on all output, model text escaped before the only two markups allowed (bold, If/then). CSV injection fixed. No SQL yet: use parameterised queries or the Supabase client, never string SQL. |
| A04 Insecure design | Client side entitlements and the local data model are known trade offs until milestone 1. The assistant follows the AI_RULES design: consent per category, basis line, human confirmation for writes. |
| A05 Security misconfiguration | CSP added. When hosted, also send these as real headers, because meta tags cannot set them: `Content-Security-Policy` with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security`. The Python dev server is for local testing only. |
| A06 Vulnerable components | No runtime dependencies. Node is used only to build and test. Keep it that way, or pin and audit anything added. |
| A07 Identification and authentication failures | Not built (milestone 1). Use the provider's hosted flows. Do not write custom password storage. |
| A08 Software and data integrity failures | Imports validated (fixes 2 and 3). Inline scripts pinned by hash in the build. Google Fonts CSS cannot use SRI, which is another reason to self host. |
| A09 Logging and monitoring failures | Nothing to log without a server. Later: log auth, billing and assistant errors, but never log prompts or health data without consent (AI_RULES). |
| A10 Server side request forgery | No server. The client analogue is the assistant endpoint setting, which is limited to loopback. A future server function must call a fixed model URL, never one that comes from the client. |

## OWASP Top 10 for LLM applications (2025)

| Item | Result |
|------|--------|
| LLM01 Prompt injection | Logged text (mood notes, task titles) reaches the model. It sits inside a `<user_data>` fence that it cannot close, and the system prompt tells the model to treat it as data. The real control is that tools are narrow and every write needs a person's tap. **Residual:** injected text can still change the wording of advice. |
| LLM02 Sensitive information disclosure | Consent toggles decide which categories are sent. Names and ids are never sent. The model is local, and the chat is not persisted. |
| LLM03 Supply chain | Model weights come from the Ollama library. Pin a known model tag, such as `llama3.2:3b`, and pull from the official registry only. |
| LLM04 Data and model poisoning | No training or fine tuning. Not applicable. |
| LLM05 Improper output handling | Model output is escaped before rendering. Tool arguments are validated, then validated again before writing. Model text never becomes HTML, URLs or code. |
| LLM06 Excessive agency | Three tools only: `get_phase` (read), `add_task` and `log_mood` (writes that need confirmation). No delete, no edit, no settings, no network. |
| LLM07 System prompt leakage | The system prompt holds no secrets, only rules and the person's own consented data. |
| LLM08 Vector and embedding weaknesses | No retrieval. Not applicable. |
| LLM09 Misinformation | Health advice from a small local model can be wrong. Every answer carries the basis line, "This is an estimate, not medical advice." and a clinician pointer. **Before launch:** run the 30 scenario evaluation set from AI_RULES against the chosen model. |
| LLM10 Unbounded consumption | Local, so there is no cost exposure. Caps are listed under Denial of service. A hosted model will need a per user rate limit and a monthly cost cap in the edge function. |

## Open items, in priority order

1. **Before any public launch:** accounts and server side storage with row level security, and Pro enforced on the server. Remove the Pro preview switch.
2. Hosting headers from A05, including `frame-ancestors 'none'` (clickjacking).
3. Self host the font and tighten the CSP to `'self'` only.
4. Show a message when saving to storage fails.
5. Run the AI_RULES evaluation set against the model you pick. Recheck when changing models.
6. Hosted model (Claude through a server function, per CLAUDE.md): the key stays in the function, with a rate limit and cost cap. Keep the same tool validation server side.

## Running the assistant locally

1. Install Ollama from ollama.com and open it.
2. Run `ollama pull llama3.2`. Any model with tool support works. `qwen2.5:7b` follows instructions better if your machine can run it.
3. In Petal: Subscription, turn on "Preview Pro features", then open the Assistant tab.

Ollama only listens on 127.0.0.1 by default. Keep it that way: do not set `OLLAMA_HOST=0.0.0.0` or `OLLAMA_ORIGINS=*`, which would let other devices or any website use your model.
