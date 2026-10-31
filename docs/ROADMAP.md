# Roadmap

Petal today is a single-page app with no server. These are the milestones referenced in the code and in `SECURITY.md`.

## Done (Thirduni, October 2026)

- Cycle engine, predictions and learning from logged periods
- Dashboard, planner and task check, meals and calorie targets, workouts, mood log and patterns
- The Petal agent (server side, Groq as the model): consent screen, sharing per category, read tools on the server, every change confirmed with Save, setup by chat
- Setup steps that cannot be skipped, and a logo screen on open
- Security pass: CSP with hashed scripts, input and import validation, CSV formula protection
- Petal Lens, a photo agent for meals and workouts
- 46 unit tests, Vercel deployment with security headers

## Milestone 1: accounts and storage

- Sign in with email, Google or Apple through the provider's hosted flows (no custom password storage)
- Server-side storage with row level security. Only a local cache, cleared on log out
- Append-only log of plan changes

## Milestone 6: Pro and the agent

- Billing, with Pro checked on the server
- Check the session (and Pro, if the agent becomes a Pro feature) in `/api/agent`, add a shared rate limit and a cost cap, then consider Claude as the model behind the agent
- Remove the "Preview Pro features" switch

## Also planned

- Self-host the font and tighten the CSP
- Tell the person when saving to storage fails
- French and Arabic interface
- Review of the exercise catalog by a qualified trainer or physiotherapist
- The 30-scenario assistant evaluation in `AI_RULES.md`
