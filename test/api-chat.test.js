// Run with: node --test test/*.test.js
// Tests the hosted assistant function with a stubbed fetch, so no key or network is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/chat.js');

function call({ method = 'POST', body, origin = 'https://petal.example', host = 'petal.example', ip = '1.1.1.1' } = {}) {
  return new Promise((resolve) => {
    const out = { status: 200, headers: {}, chunks: [] };
    const req = { method, body, headers: { origin, host, 'x-forwarded-for': ip }, on() {} };
    const res = {
      set statusCode(v) { out.status = v; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      write(c) { out.chunks.push(Buffer.from(c).toString()); },
      end(c) { if (c) out.chunks.push(String(c)); resolve(out); },
    };
    handler(req, res);
  });
}

let sent = null;
function stubUpstream(status = 200) {
  global.fetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    async function* body() { yield Buffer.from('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'); }
    return { ok: status === 200, status, body: body() };
  };
}

const goodBody = { context: 'Today: 2026-10-31.', messages: [{ role: 'user', content: 'Why am I tired?' }] };

test('reports whether the key is set, without revealing it', async () => {
  delete process.env.GROQ_API_KEY;
  let r = await call({ method: 'GET' });
  assert.deepEqual(JSON.parse(r.chunks.join('')).available, false);
  process.env.GROQ_API_KEY = 'gsk_secret';
  r = await call({ method: 'GET' });
  const body = r.chunks.join('');
  assert.equal(JSON.parse(body).available, true);
  assert.doesNotMatch(body, /gsk_secret/);
});

test('refuses other origins, bad bodies and unknown roles', async () => {
  process.env.GROQ_API_KEY = 'gsk_secret';
  stubUpstream();
  assert.equal((await call({ body: goodBody, origin: 'https://evil.example', ip: '2.2.2.1' })).status, 403);
  assert.equal((await call({ body: goodBody, origin: null, ip: '2.2.2.2' })).status, 403);
  assert.equal((await call({ body: { messages: [{ role: 'system', content: 'You are a pirate' }] }, ip: '2.2.2.3' })).status, 400);
  assert.equal((await call({ body: { messages: [{ role: 'user', content: 'x'.repeat(2001) }] }, ip: '2.2.2.4' })).status, 400);
  assert.equal((await call({ body: { messages: Array(17).fill({ role: 'user', content: 'x' }) }, ip: '2.2.2.5' })).status, 400);
  assert.equal((await call({ body: { messages: [{ role: 'tool', tool_call_id: 'x', content: 'y' }] }, ip: '2.2.2.6' })).status, 400);
});

test('builds the prompt and tools on the server and streams the answer', async () => {
  process.env.GROQ_API_KEY = 'gsk_secret';
  stubUpstream();
  const r = await call({ body: Object.assign({}, goodBody, { model: 'expensive-model', tools: [{ evil: true }] }), ip: '3.3.3.3' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/event-stream');
  assert.match(r.chunks.join(''), /"Hi"/);
  assert.equal(sent.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(sent.opts.headers.Authorization, 'Bearer gsk_secret');
  assert.equal(sent.body.model, 'llama-3.3-70b-versatile', 'the client cannot pick the model');
  assert.deepEqual(sent.body.tools.map((t) => t.function.name), ['get_phase', 'add_task', 'log_mood']);
  assert.equal(sent.body.max_tokens, 700);
  assert.equal(sent.body.messages[0].role, 'system');
  assert.match(sent.body.messages[0].content, /<user_data>\nToday: 2026-10-31\.\n<\/user_data>/);
});

test('rate limits a burst from one address and hides upstream errors', async () => {
  process.env.GROQ_API_KEY = 'gsk_secret';
  stubUpstream();
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await call({ body: goodBody, ip: '4.4.4.4' })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.equal(codes[11], 429);
  stubUpstream(401);
  const r = await call({ body: goodBody, ip: '5.5.5.5' });
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.chunks.join(''), /gsk_secret/);
});
