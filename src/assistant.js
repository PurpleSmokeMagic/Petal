/*
 * Petal assistant client. Two ways to reach a model:
 * - local:  a model on this device through the OpenAI compatible API that Ollama,
 *           LM Studio and llama.cpp serve.
 * - hosted: Petal's own server function (/api/chat), which holds the Groq key. Used only
 *           after the person agrees in the app.
 *
 *   PetalAssistant.status(baseUrl)            -> { ok, models: [name], error }
 *   PetalAssistant.hostedStatus()             -> { available, provider, model }
 *   PetalAssistant.chat({ baseUrl, model, messages, tools, signal, onToken })
 *   PetalAssistant.chat({ hosted: true, context, messages, signal, onToken })
 *                                             -> { content, toolCalls: [{ id, name, arguments }] }
 *
 * Security notes (see SECURITY.md):
 * - Loopback endpoints only. The engine refuses any other host, and this file checks again
 *   before every request, so a tampered setting cannot send health data off the device.
 * - No API keys in the browser. The hosted path posts to this site only (fixed path, same origin);
 *   the server builds the system prompt and tool list itself.
 * - Responses are plain text to the caller. The UI escapes them before rendering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./petal-engine.js'));
  else root.PetalAssistant = factory(root.Petal);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  const LIMITS = { firstTokenMs: 120000, maxTokens: 700, maxReplyChars: 6000 };

  function endpoint(baseUrl, path) {
    if (!P.isLoopbackUrl(baseUrl)) throw new Error('The assistant only connects to a model on this device.');
    return new URL(path, baseUrl).toString();
  }

  // Lists installed models. Tries Ollama's own list first, then the OpenAI style list.
  async function status(baseUrl, signal) {
    try {
      let res = await fetch(endpoint(baseUrl, '/api/tags'), { signal, credentials: 'omit' });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, models: (data.models || []).map((m) => String(m.name)).filter(Boolean).sort() };
      }
      res = await fetch(endpoint(baseUrl, '/v1/models'), { signal, credentials: 'omit' });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, models: (data.data || []).map((m) => String(m.id)).filter(Boolean).sort() };
      }
      return { ok: false, models: [], error: 'http ' + res.status };
    } catch (e) {
      return { ok: false, models: [], error: e && e.name === 'AbortError' ? 'aborted' : 'offline' };
    }
  }

  // Is the hosted assistant set up on this deployment? A static server answers 404, which means no.
  async function hostedStatus(signal) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return { available: false };
    try {
      const res = await fetch('/api/chat', { signal, credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return { available: false };
      const data = await res.json();
      return { available: data.available === true, provider: String(data.provider || ''), model: String(data.model || '') };
    } catch (e) {
      return { available: false };
    }
  }

  // Reads a server sent event stream and yields each JSON payload.
  async function* sse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch (e) { /* skip a malformed chunk */ }
      }
    }
  }

  async function chat({ hosted, context, baseUrl, model, messages, tools, signal, onToken }) {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, LIMITS.firstTokenMs);
    try {
      const res = hosted
        ? await fetch('/api/chat', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, messages }),
          signal: ctrl.signal,
        })
        : await fetch(endpoint(baseUrl, '/v1/chat/completions'), {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, tools, stream: true, max_tokens: LIMITS.maxTokens, temperature: 0.4 }),
          signal: ctrl.signal,
        });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error('The model server answered ' + res.status + '.');
        err.status = res.status;
        err.detail = text.slice(0, 300);
        throw err;
      }
      let content = '';
      const calls = [];
      for await (const chunk of sse(res)) {
        clearTimeout(timer);
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (!delta) continue;
        if (delta.content && content.length < LIMITS.maxReplyChars) {
          content += delta.content;
          if (onToken) onToken(content);
        }
        (delta.tool_calls || []).forEach((tc, n) => {
          const i = tc.index != null ? tc.index : n;
          const c = calls[i] || (calls[i] = { id: tc.id || 'call_' + i, name: '', arguments: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function && tc.function.name) c.name += tc.function.name;
          if (tc.function && tc.function.arguments != null) {
            c.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          }
        });
      }
      return { content: content.slice(0, LIMITS.maxReplyChars), toolCalls: calls.filter(Boolean).slice(0, 4) };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  }

  return { status, hostedStatus, chat, LIMITS };
});
