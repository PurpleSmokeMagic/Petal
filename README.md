# Petal

Cycle syncing planner. Single page app in vanilla JavaScript, no runtime dependencies.

- Run locally: `python -m http.server 5173 --bind 127.0.0.1` in this folder, then open http://127.0.0.1:5173
- Tests: `node --test test/petal-engine.test.js`
- Build one self contained file: `node build.js` (writes `dist/index.html`)
- Deploy: Vercel runs `node build.js` and serves `dist` (see `vercel.json`)

## For testers

- Everything you enter stays in your own browser. There is no server and no account yet.
- To try Pro screens: Settings, Subscription, turn on "Preview Pro features".
- The assistant needs Ollama on your computer. The Assistant tab shows the steps.
- Security notes: `SECURITY.md`.
