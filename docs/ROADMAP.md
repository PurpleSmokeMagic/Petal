# Roadmap

Petal today is a single-page app with no server. These are the milestones referenced in the code and in `SECURITY.md`.

## Done (Thirduni, October 2026)

- Cycle engine, predictions and learning from logged periods
- Dashboard, planner and task check, meals and calorie targets, workouts, mood log and patterns
- AI assistant with consent per category and confirmed tool calls: local (Ollama) or online (Groq through a Vercel function, after a consent screen)
- Security pass: CSP with hashed scripts, input and import validation, CSV formula protection
- 32 unit tests, Vercel deployment with security headers

## Milestone 1: accounts and storage

- Sign in with email, Google or Apple through the provider's hosted flows (no custom password storage)
- Server-side storage with row level security. Only a local cache, cleared on log out
- Append-only log of plan changes

## Milestone 6: Pro and hosted assistant

- Billing, with Pro checked on the server
- Check Pro and the session in `/api/chat`, add a shared rate limit and a cost cap, then consider Claude as the hosted model
- Remove the "Preview Pro features" switch

## Also planned

- Self-host the font and tighten the CSP
- Tell the person when saving to storage fails
- French and Arabic interface
- Review of the exercise catalog by a qualified trainer or physiotherapist
- The 30-scenario assistant evaluation in `AI_RULES.md`
