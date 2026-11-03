// Shared browser helpers. All text goes through textContent: no innerHTML with data.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.message || 'تعذّر الاتصال، حاول مرة أخرى');
    err.status = res.status; err.code = data?.error;
    throw err;
  }
  return data;
}

// el('div.card#x', {onclick, dataset:{}}, child, 'text', [children])
export function el(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [, tag = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(sel);
  const node = document.createElement(tag || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? node.classList.add(m[2]) : (node.id = m[2]);
  for (const [k, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), val);
    else if (k === 'dataset') Object.assign(node.dataset, val);
    else if (k === 'class') node.className += ' ' + val;
    else node.setAttribute(k, val === true ? '' : val);
  }
  const add = (k) => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else node.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return node;
}

export const $ = (s, root = document) => root.querySelector(s);

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = el('div#toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = el('div.toast', { class: kind }, msg);
  box.append(t);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => t.remove(), 4500);
}

// SSE with reconnect + a status dot. onEvent(type, data)
export function connectEvents(url, onEvent, dot) {
  let es, backoff = 1000;
  const open = () => {
    es = new EventSource(url, { withCredentials: true });
    es.onopen = () => { backoff = 1000; dot?.classList.replace('off', 'on') || dot?.classList.add('on'); onEvent('open'); };
    es.addEventListener('pickup', (e) => onEvent('pickup', JSON.parse(e.data)));
    es.onerror = () => {
      dot?.classList.replace('on', 'off') || dot?.classList.add('off');
      if (es.readyState === EventSource.CLOSED) { setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000); }
    };
  };
  open();
  return () => es?.close();
}

let audioCtx;
export function chime() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [880, 1175].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.18); g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.35);
      o.connect(g).connect(audioCtx.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.4);
    });
  } catch { /* no audio */ }
}
export function unlockAudio() { try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* */ } }

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-SA'; u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('ar'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

const timeFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
export const fmtTime = (ms) => (ms ? timeFmt.format(new Date(ms)) : '');
export function since(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} ث`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} د` : `${Math.floor(m / 60)} س ${m % 60} د`;
}
export function fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${Math.round(m)} م`;
}
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const STATUS_AR = { announced: 'بانتظار الإرسال', sent: 'في الطريق للبوابة', released: 'تم التسليم', cancelled: 'أُلغي' };
export const STATUS_KIND = { announced: 'warning', sent: 'info', released: 'success', cancelled: 'muted' };

export function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch { return null; }
  return val;
}

export async function staffLogin(roleHint, onIn) {
  // Renders a staff login card into #app and resolves with the staff profile.
  const app = $('#app');
  try { const me = await api('/api/me'); if (me.kind === 'staff') return onIn(me); } catch { /* not signed in */ }
  const err = el('div.alert.error.hidden', { role: 'alert' });
  const u = el('input#u', { autocomplete: 'username', dir: 'ltr', required: true, autocapitalize: 'none' });
  const p = el('input#p', { type: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
  const form = el('form.card.stack', {
    onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      try { onIn(await api('/api/staff/login', { method: 'POST', body: { username: u.value, password: p.value } })); }
      catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    },
  },
  el('h1', `دخول ${roleHint}`),
  el('div.field', el('label', { for: 'u' }, 'اسم المستخدم'), u),
  el('div.field', el('label', { for: 'p' }, 'كلمة المرور'), p),
  err,
  el('button.block', { type: 'submit' }, 'دخول'));
  app.replaceChildren(el('div.wrap', form));
  u.focus();
}

export async function logout() {
  await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
  location.reload();
}
