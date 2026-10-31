/*
 * Shared request checks for Petal's server functions (api/agent.js, api/lens.js).
 * Lives outside api/ so Vercel does not expose it as an endpoint.
 */
const P = require('../src/petal-engine.js');

const DAY_MS = 86400000;

// Best effort per instance limit. Serverless instances do not share memory, and Groq's own
// free tier limits sit behind this, so a burst can only use up the free quota, never cost money.
function createRateLimiter(perMinute) {
  const hits = new Map();
  return function limited(ip, now) {
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > perMinute;
  };
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
}

// Only pages served from this deployment may call it from a browser.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch (e) {
    return false;
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// The person's local date, which may differ from the server's by a day across time zones.
function validToday(today, now) {
  if (!P.isISODate(today)) return false;
  const t = Date.parse(today + 'T12:00:00Z');
  return Math.abs(t - now) <= 1.5 * DAY_MS;
}

function parseBody(req, maxChars) {
  let body = req.body;
  if (typeof body === 'string') { try { body = P.safeParse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > maxChars) return null;
  return body;
}

/*
 * Groq retires models over time, so each endpoint asks which models the key can use and takes
 * the first from its preference list (or the first id matching `fallback`). Cached for an hour,
 * and reset after a model_not_found error. envVar lets the deployer force a model.
 */
function createModelPicker({ preference, fallback, envVar }) {
  let choice = null;
  async function pick(key) {
    if (envVar && process.env[envVar]) return process.env[envVar];
    if (choice && Date.now() - choice.at < 3600000) return choice.id;
    let ids = [];
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
      if (res.ok) ids = ((await res.json()).data || []).map((m) => String(m.id));
    } catch (e) { /* fall back to the first preference */ }
    const id = preference.find((m) => ids.includes(m)) || (fallback && ids.find((m) => fallback.test(m))) || preference[0];
    choice = { at: Date.now(), id };
    return id;
  }
  pick.reset = () => { choice = null; };
  return pick;
}

// Streams agent events as server sent events. Never passes the provider's message text on
// (it can echo the request); its HTTP status and short error code are safe to show.
async function streamEvents(res, run, onModelMissing) {
  // Stop the model call if the browser goes away. The request's own 'close' fires as soon as
  // its body is read, so listen on the response, which closes on disconnect or after end().
  const ctrl = new AbortController();
  if (res.on) res.on('close', () => ctrl.abort());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  const send = (event) => res.write('data: ' + JSON.stringify(event) + '\n\n');
  try {
    await run(send, ctrl.signal);
    send({ type: 'done' });
  } catch (e) {
    if (e && e.reason === 'model_not_found' && onModelMissing) onModelMissing();
    if (!ctrl.signal.aborted) {
      send({ type: 'error', code: e && e.status === 429 ? 'rate_limited' : 'upstream', status: e && e.status ? Number(e.status) : undefined, reason: e && e.reason });
    }
  }
  res.end();
}

module.exports = { createRateLimiter, clientIp, sameOrigin, json, validToday, parseBody, createModelPicker, streamEvents };
