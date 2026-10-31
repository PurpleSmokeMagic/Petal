/*
 * Hosted assistant: a Vercel server function that holds the Groq API key.
 *
 *   GET  /api/chat   -> { available: true | false, provider, model }
 *   POST /api/chat   { context: string, messages: [...] } -> server sent events, OpenAI style
 *
 * The browser never sees the key. The function builds the system prompt and the tool list
 * itself, so it cannot be used as a general purpose model: callers only send the person's
 * consented context and the chat history. Nothing is logged or stored here.
 * Environment: GROQ_API_KEY (required), GROQ_MODEL (optional).
 */
const P = require('../src/petal-engine.js');

const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const LIMITS = { bodyBytes: 64000, contextChars: 4000, messages: 16, messageChars: 2000, maxTokens: 700, perMinute: 10 };

// Best effort per instance limit. Serverless instances do not share memory, and Groq's own
// free tier limits sit behind this, so a burst can only exhaust the free quota, never cost money.
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
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === host;
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

// Rebuilds the history from known fields only. Anything else the client sends is dropped.
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > LIMITS.messages) return null;
  const toolIds = new Set();
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') return null;
    const content = typeof m.content === 'string' ? m.content : '';
    if (content.length > LIMITS.messageChars) return null;
    if (m.role === 'user') out.push({ role: 'user', content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.slice(0, 4).map((c) => {
          const id = String(c && c.id || '').slice(0, 64);
          toolIds.add(id);
          return { id, type: 'function', function: { name: String(c.function && c.function.name || '').slice(0, 40), arguments: String(c.function && c.function.arguments || '').slice(0, 2000) } };
        });
      }
      out.push(msg);
    } else if (m.role === 'tool' && toolIds.has(String(m.tool_call_id))) out.push({ role: 'tool', tool_call_id: String(m.tool_call_id), content });
    else return null;
  }
  return out[0].role === 'user' ? out : null;
}

module.exports = async function handler(req, res) {
  const key = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (req.method === 'GET') return json(res, 200, { available: Boolean(key), provider: 'Groq', model });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'method' }); }
  if (!key) return json(res, 503, { error: 'not_configured' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip, Date.now())) return json(res, 429, { error: 'rate_limited' });

  let body = req.body;
  if (typeof body === 'string') { try { body = P.safeParse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > LIMITS.bodyBytes) return json(res, 400, { error: 'body' });
  const context = typeof body.context === 'string' ? body.context.slice(0, LIMITS.contextChars) : '';
  const messages = cleanMessages(body.messages);
  if (!messages) return json(res, 400, { error: 'messages' });

  // Stop the upstream call if the browser goes away. The request's own 'close' fires as soon as
  // its body is read, so listen on the response, which closes on disconnect or after end().
  const ctrl = new AbortController();
  if (res.on) res.on('close', () => ctrl.abort());
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: P.buildSystemPrompt({ text: context }) }].concat(messages),
        tools: P.ASSISTANT_TOOLS,
        stream: true,
        max_tokens: LIMITS.maxTokens,
        temperature: 0.4,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    return json(res, 502, { error: 'upstream' });
  }
  if (!upstream.ok || !upstream.body) {
    // Pass the status class on, never Groq's error text (it can echo the request).
    return json(res, upstream.status === 429 ? 429 : 502, { error: upstream.status === 429 ? 'rate_limited' : 'upstream' });
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch (e) { /* client went away */ }
  res.end();
};

module.exports.LIMITS = LIMITS;
module.exports.cleanMessages = cleanMessages;
