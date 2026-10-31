/*
 * Petal agent client. Talks only to this site's /api/agent (api/agent.js), which runs the
 * Petal agent on the server and holds the model key.
 *
 *   PetalAssistant.available()  -> true when the agent is set up on this deployment
 *   PetalAssistant.send({ mode, today, snapshot, messages, signal, onToken, onAction })
 *                               -> resolves when the answer is complete; throws { status | code }
 *
 * Security notes (see SECURITY.md):
 * - Same origin, fixed path, no keys in the browser.
 * - The app builds the snapshot from Privacy settings only (Petal.assistantSnapshot).
 * - Actions are proposals. The UI validates them again and saves only after the person taps Save.
 * - Text is passed to the UI as plain text. The UI escapes it before rendering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetalAssistant = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { timeoutMs: 90000, maxReplyChars: 6000 };
  const ENDPOINT = '/api/agent';

  async function available(signal) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
    try {
      const res = await fetch(ENDPOINT, { signal, credentials: 'omit', cache: 'no-store' });
      return res.ok && (await res.json()).available === true;
    } catch (e) {
      return false;
    }
  }

  async function send({ mode, today, snapshot, messages, signal, onToken, onAction }) {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, LIMITS.timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, today, snapshot, messages }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = new Error('The agent answered ' + res.status + '.');
        err.status = res.status;
        throw err;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (ev.type === 'token' && typeof ev.text === 'string' && text.length < LIMITS.maxReplyChars) {
            text += ev.text;
            if (onToken) onToken(text);
          } else if (ev.type === 'action' && onAction) {
            onAction(String(ev.name || ''), ev.args && typeof ev.args === 'object' ? ev.args : {});
          } else if (ev.type === 'error') {
            const err = new Error('Agent error');
            err.code = String(ev.code || 'upstream');
            throw err;
          }
        }
      }
      return text;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  }

  return { available, send, LIMITS };
});
