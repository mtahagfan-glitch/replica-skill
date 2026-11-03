// Hall TV: /display/?school=ID&key=DISPLAY_KEY. No login, read-only, no phone numbers.
import { el, $, chime, speak, unlockAudio } from '/shared/ui.js';

const qs = new URLSearchParams(location.search);
const school = qs.get('school'), key = qs.get('key');
const base = `/api/display/${encodeURIComponent(school)}`;
const live = new Map();
const fresh = new Set();
let sound = false;

$('#start').onclick = () => { unlockAudio(); sound = true; $('#start').remove(); document.documentElement.requestFullscreen?.().catch(() => {}); };
setInterval(() => { $('#clock').textContent = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date()); }, 1000);

async function load() {
  const r = await fetch(`${base}/queue?key=${encodeURIComponent(key)}`);
  if (!r.ok) { $('#board').replaceChildren(el('div.none', 'رابط الشاشة غير صحيح. انسخه من لوحة الإدارة.')); return false; }
  const d = await r.json();
  $('#school').textContent = d.school;
  live.clear(); d.pickups.forEach((p) => live.set(p.id, p));
  render();
  return true;
}

function render() {
  const list = [...live.values()].sort((a, b) => b.announced_at - a.announced_at);
  $('#board').replaceChildren(...(list.length ? list.map((p) => el('div.call', { class: `${p.status}${fresh.has(p.id) ? ' new' : ''}` },
    el('div.n', p.student.name),
    el('div.c', [p.student.grade, p.student.class_name].filter(Boolean).join(' · ')),
    el('div.g', p.status === 'sent' ? 'في الطريق إلى البوابة' : `${p.guardian.relation_ar} عند البوابة`)))
    : [el('div.none', 'لا يوجد نداء حالياً')]));
}

function connect() {
  const es = new EventSource(`${base}/events?key=${encodeURIComponent(key)}`);
  es.onopen = () => { $('#conn').className = 'conn on'; load(); };
  es.onerror = () => { $('#conn').className = 'conn off'; };
  es.addEventListener('pickup', (e) => {
    const p = JSON.parse(e.data);
    const isNew = !live.has(p.id);
    if (['announced', 'sent'].includes(p.status)) live.set(p.id, p); else live.delete(p.id);
    if (isNew && p.status === 'announced') {
      fresh.add(p.id); setTimeout(() => { fresh.delete(p.id); render(); }, 4000);
      if (sound) { chime(); setTimeout(() => speak(`${p.student.name}. ${p.student.class_name || ''}`), 700); }
    }
    render();
  });
}

load().then((ok) => ok && connect());
