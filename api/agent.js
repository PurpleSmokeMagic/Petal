/*
 * Petal agent endpoint (Vercel server function). Holds the Groq key; the browser never sees it.
 *
 *   GET  /api/agent  -> { available: true | false }
 *   POST /api/agent  { mode, today, snapshot, messages } -> server sent events:
 *          data: { "type": "token", "text": "..." }      streamed answer text
 *          data: { "type": "action", "name", "args" }    a change for the person to Save
 *          data: { "type": "error", "code" }             then the stream ends
 *          data: { "type": "done" }
 *
 * Every request is untrusted: the snapshot goes through Petal.migrate(), messages are rebuilt
 * from known fields, and the agent's instructions, model and tools are fixed here.
 * Nothing is logged or stored. Environment: GROQ_API_KEY (required), GROQ_MODEL (optional).
 */
const P = require('../src/petal-engine.js');
const { runAgent, createGroqLLM } = require('../agent/petal-agent.js');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const LIMITS = { bodyBytes: 96000, messages: 16, messageChars: 2000, perMinute: 10 };
const DAY_MS = 86400000;

// Best effort per instance limit. Serverless instances do not share memory, and Groq's own
// free tier limits sit behind this, so a burst can only use up the free quota, never cost money.
const hits = new Map();
function limited(ip, now) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMITS.perMinute;
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

function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > LIMITS.messages) return null;
  const out = [];
  for (const m of list) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > LIMITS.messageChars) return null;
    out.push({ role: m.role, content: m.content });
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

function cleanSetup(s) {
  const keys = ['name', 'lastPeriodStart', 'bodyAndGoal', 'diet', 'activity', 'occupation'];
  const out = {};
  keys.forEach((k) => { out[k] = Boolean(s && s[k] === true); });
  return out;
}

module.exports = async function handler(req, res) {
  const key = process.env.GROQ_API_KEY;
  if (req.method === 'GET') return json(res, 200, { available: Boolean(key) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'method' }); }
  if (!key) return json(res, 503, { error: 'not_configured' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (limited(ip, Date.now())) return json(res, 429, { error: 'rate_limited' });

  let body = req.body;
  if (typeof body === 'string') { try { body = P.safeParse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > LIMITS.bodyBytes) return json(res, 400, { error: 'body' });
  const mode = body.mode === 'setup' ? 'setup' : 'chat';
  if (!validToday(body.today, Date.now())) return json(res, 400, { error: 'today' });
  const messages = cleanMessages(body.messages);
  if (!messages) return json(res, 400, { error: 'messages' });
  let state;
  try { state = P.migrate(P.safeParse(JSON.stringify(body.snapshot || {}))); } catch (e) { return json(res, 400, { error: 'snapshot' }); }

  // Stop the model call if the browser goes away. The request's own 'close' fires as soon as
  // its body is read, so listen on the response, which closes on disconnect or after end().
  const ctrl = new AbortController();
  if (res.on) res.on('close', () => ctrl.abort());

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  const send = (event) => res.write('data: ' + JSON.stringify(event) + '\n\n');
  try {
    await runAgent({
      llm: createGroqLLM({ key, model: process.env.GROQ_MODEL || DEFAULT_MODEL }),
      mode, today: body.today, state, setup: cleanSetup(body.snapshot && body.snapshot.setup), messages,
      onEvent: send, signal: ctrl.signal,
    });
    send({ type: 'done' });
  } catch (e) {
    // Never pass Groq's error text on (it can echo the request).
    // Never pass the provider's message text on (it can echo the request); its status and short code are safe.
    if (!ctrl.signal.aborted) {
      send({ type: 'error', code: e && e.status === 429 ? 'rate_limited' : 'upstream', status: e && e.status ? Number(e.status) : undefined, reason: e && e.reason });
    }
  }
  res.end();
};

module.exports.cleanMessages = cleanMessages;
module.exports.validToday = validToday;
