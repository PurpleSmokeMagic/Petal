/*
 * Petal agent client. Talks only to this site's /api/agent (api/agent.js), which runs the
 * Petal agent on the server and holds the model key.
 *
 *   PetalAssistant.available()  -> true when the agent is set up on this deployment
 *   PetalAssistant.send({ mode, today, snapshot, messages, signal, onToken, onAction })
 *                               -> resolves when the answer is complete; throws { status | code }
 *   PetalAssistant.sendPhoto({ today, snapshot, image, note, signal, onToken, onAction })
 *                               -> the same, through Petal Lens (/api/lens), for one photo
 *   PetalAssistant.preparePhoto(file) -> JPEG data URL, at most 1024 px, metadata removed
 *   PetalAssistant.preparePhoto(file, { square: 256 }) -> a square crop for the avatar, kept on the phone
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

  // Redraws the photo on a canvas: shrinks it to 1024 px at most and drops EXIF, so location
  // and camera details never leave the phone. Returns a JPEG data URL.
  async function preparePhoto(file, opts) {
    const square = opts && opts.square;
    // Some phones send photos with no type, so decoding below is the real check.
    if (!file || (file.type && !/^image\//i.test(file.type))) throw new Error('not_image');
    if (file.size > 25 * 1024 * 1024) throw new Error('too_big');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    if (square) {
      // Centre crop to a square, then shrink.
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.width = canvas.height = Math.min(square, side);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    } else {
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/jpeg', square ? 0.8 : 0.82);
  }

  function send({ mode, today, snapshot, messages, signal, onToken, onAction }) {
    // The phone's offset from UTC lets the agent read task times the way the person sees them.
    return stream(ENDPOINT, { mode, today, tzOffset: -new Date().getTimezoneOffset(), snapshot, messages }, { signal, onToken, onAction });
  }

  function sendPhoto({ today, snapshot, image, note, signal, onToken, onAction }) {
    return stream('/api/lens', { today, snapshot, image, note }, { signal, onToken, onAction });
  }

  async function stream(endpoint, payload, { signal, onToken, onAction }) {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, LIMITS.timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  return { available, send, sendPhoto, preparePhoto, LIMITS };
});
