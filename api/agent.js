/*
 * Petal agent endpoint (Vercel server function). Holds the Groq key; the browser never sees it.
 *
 *   GET  /api/agent  -> { available: true | false }
 *   POST /api/agent  { mode, today, snapshot, messages } -> server sent events:
 *          data: { "type": "token", "text": "..." }      streamed answer text
 *          data: { "type": "action", "name", "args" }    a change for the person to Save
 *          data: { "type": "error", "code", "status", "reason" }   then the stream ends
 *          data: { "type": "done" }
 *
 * Every request is untrusted: the snapshot goes through Petal.migrate(), messages are rebuilt
 * from known fields, and the agent's instructions, model and tools are fixed here.
 * Nothing is logged or stored. Environment: GROQ_API_KEY (required), GROQ_MODEL (optional; otherwise
 * the best available model from MODEL_PREFERENCE is picked, so a retired model does not break the agent).
 */
const P = require('../src/petal-engine.js');
const { runAgent, createGroqLLM } = require('../agent/petal-agent.js');
const S = require('../agent/server.js');

// Models that follow instructions and call tools well, best first.
const MODEL_PREFERENCE = [
  'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct-0905', 'moonshotai/kimi-k2-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b', 'llama-3.1-8b-instant',
];
const pickModel = S.createModelPicker({ preference: MODEL_PREFERENCE, envVar: 'GROQ_MODEL' });
const LIMITS = { bodyBytes: 96000, messages: 16, messageChars: 2000, perMinute: 10 };
const limited = S.createRateLimiter(LIMITS.perMinute);

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
  if (req.method === 'GET') return S.json(res, 200, { available: Boolean(key) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return S.json(res, 405, { error: 'method' }); }
  if (!key) return S.json(res, 503, { error: 'not_configured' });
  if (!S.sameOrigin(req)) return S.json(res, 403, { error: 'origin' });
  if (limited(S.clientIp(req), Date.now())) return S.json(res, 429, { error: 'rate_limited' });

  const body = S.parseBody(req, LIMITS.bodyBytes);
  if (!body) return S.json(res, 400, { error: 'body' });
  const mode = body.mode === 'setup' ? 'setup' : 'chat';
  if (!S.validToday(body.today, Date.now())) return S.json(res, 400, { error: 'today' });
  const messages = cleanMessages(body.messages);
  if (!messages) return S.json(res, 400, { error: 'messages' });
  let state;
  try { state = P.migrate(P.safeParse(JSON.stringify(body.snapshot || {}))); } catch (e) { return S.json(res, 400, { error: 'snapshot' }); }

  await S.streamEvents(res, async (send, signal) => runAgent({
    llm: createGroqLLM({ key, model: await pickModel(key) }),
    mode, today: body.today, state, setup: cleanSetup(body.snapshot && body.snapshot.setup), messages,
    onEvent: send, signal,
  }), pickModel.reset);
};

module.exports.cleanMessages = cleanMessages;
