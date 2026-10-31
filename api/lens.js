/*
 * Petal Lens endpoint (Vercel server function): the photo agent. Looks at one photo of a meal or
 * a workout, comments on it for the person's phase and diet, and proposes a log they can Save.
 *
 *   GET  /api/lens  -> { available: true | false }
 *   POST /api/lens  { today, snapshot, image, note } -> server sent events, as /api/agent
 *          image  data:image/jpeg|png|webp;base64,...  (the app resizes it and strips its metadata)
 *          note   optional text from the person, up to 500 characters
 *
 * The photo is checked (type, size, and the file's own signature bytes), sent to the model once
 * and never stored or logged. Environment: GROQ_API_KEY, GROQ_VISION_MODEL (optional).
 */
const P = require('../src/petal-engine.js');
const { runAgent, createGroqLLM } = require('../agent/petal-agent.js');
const S = require('../agent/server.js');

// Groq models that can see images, best first. Any other id that looks like a vision model is the fallback.
const pickModel = S.createModelPicker({
  preference: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  fallback: /llama-4|vision|maverick|scout|-vl\b|-vl-/i,
  envVar: 'GROQ_VISION_MODEL',
});
const LIMITS = { imageChars: 1400000, bodyBytes: 1500000, noteChars: 500, perMinute: 5 };
const limited = S.createRateLimiter(LIMITS.perMinute);

// The declared type must match the file's own first bytes, so a renamed file is refused.
const SIGNATURES = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
function checkImage(url) {
  if (typeof url !== 'string' || url.length > LIMITS.imageChars) return false;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!m) return false;
  const head = Buffer.from(m[2].slice(0, 24), 'base64');
  return head.length >= 12 && SIGNATURES[m[1]](head);
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
  if (!S.validToday(body.today, Date.now())) return S.json(res, 400, { error: 'today' });
  if (!checkImage(body.image)) return S.json(res, 400, { error: 'image' });
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > LIMITS.noteChars)) return S.json(res, 400, { error: 'note' });
  let state;
  try { state = P.migrate(P.safeParse(JSON.stringify(body.snapshot || {}))); } catch (e) { return S.json(res, 400, { error: 'snapshot' }); }

  const note = String(body.note || '').trim();
  const messages = [{ role: 'user', content: [
    { type: 'text', text: note ? 'My note: ' + note : 'What do you see? Comment on it for me and give one recommendation.' },
    { type: 'image_url', image_url: { url: body.image } },
  ] }];
  await S.streamEvents(res, async (send, signal) => runAgent({
    llm: createGroqLLM({ key, model: await pickModel(key) }),
    mode: 'photo', today: body.today, state, messages, onEvent: send, signal,
  }), pickModel.reset);
};

module.exports.checkImage = checkImage;
