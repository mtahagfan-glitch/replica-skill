// Gate supervisor (mode=gate) and class teacher (mode=teacher) share this screen.
import { api, el, $, toast, connectEvents, chime, speak, unlockAudio, since, fmtTime, STATUS_AR, STATUS_KIND, store, staffLogin, logout } from '/shared/ui.js';

const mode = document.body.dataset.mode || 'gate';
const app = $('#app');
const state = { me: null, pickups: new Map(), stats: {}, fresh: new Set(), voice: store('bb_voice') ?? true };

staffLogin(mode === 'teacher' ? 'المعلمة' : 'مشرف البوابة', start);

async function start(me) {
  state.me = me;
  $('#who').textContent = `${me.name} · ${me.school.name}`;
  $('#logout').classList.remove('hidden');
  $('#logout').onclick = logout;
  if (mode === 'teacher') $('#title').textContent = me.class_name ? `فصل ${me.class_name}` : 'المعلمة';
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  await load();
  connectEvents('/api/events', onEvent, $('#conn'));
  setInterval(renderQueue, 15_000); // waiting timers
}

async function load() {
  const q = await api('/api/school/queue');
  state.pickups = new Map(q.pickups.map((p) => [p.id, p]));
  state.stats = q.stats;
  render();
}

function onEvent(type, p) {
  if (type === 'open') { load().catch(() => {}); return; }
  if (type !== 'pickup') return;
  if (mode === 'teacher' && p.student.class_name !== state.me.class_name) return;
  const prev = state.pickups.get(p.id);
  state.pickups.set(p.id, p);
  if (!prev || prev.status !== p.status) {
    state.stats[p.status] = (state.stats[p.status] ?? 0) + 1;
    if (prev) state.stats[prev.status] = Math.max(0, (state.stats[prev.status] ?? 1) - 1);
  }
  if (!prev && p.status === 'announced') {
    state.fresh.add(p.id);
    setTimeout(() => state.fresh.delete(p.id), 3000);
    chime();
    if (state.voice) speak(`${p.student.name}، ${p.student.class_name || ''}. ${p.guardian.relation_ar} عند البوابة`);
  }
  renderQueue();
}

async function act(p, action) {
  try {
    const r = await api(`/api/school/pickups/${p.id}/${action}`, { method: 'POST', body: {} });
    onEvent('pickup', r);
  } catch (x) { toast(x.message, 'error'); load().catch(() => {}); }
}

function card(p) {
  const actions = [];
  if (p.status === 'announced') actions.push(el('button.secondary.sm', { onclick: () => act(p, 'sent') }, mode === 'teacher' ? 'أرسلته للبوابة' : 'أُرسل'));
  if (mode !== 'teacher' && p.status === 'sent') actions.push(el('span'));
  if (mode !== 'teacher' && ['announced', 'sent'].includes(p.status)) {
    actions.push(el('button.success.sm', { onclick: () => act(p, 'release') }, 'تم التسليم'));
    actions.push(el('button.danger.sm', { onclick: () => confirm(`إلغاء نداء ${p.student.name}؟`) && act(p, 'cancel'), 'aria-label': `إلغاء نداء ${p.student.name}` }, 'إلغاء'));
  }
  const g = p.guardian;
  return el('article.pk', { class: `${p.status}${state.fresh.has(p.id) ? ' new' : ''}`, dataset: { id: p.id } },
    el('div.row.between',
      el('span.pill', { class: STATUS_KIND[p.status] }, STATUS_AR[p.status]),
      el('span.small.muted', p.status === 'released' ? `سُلّم ${fmtTime(p.released_at)}` : `ينتظر ${since(p.announced_at)}`)),
    el('div.student', p.student.name),
    el('div.small.muted', [p.student.grade, p.student.class_name].filter(Boolean).join(' · ')),
    el('div.who', { class: g.delegate ? 'delegate' : '' },
      `${g.relation_ar}: ${g.name}`, g.delegate && g.granted_by ? ` (مفوّض من ${g.granted_by})` : ''),
    mode !== 'teacher' ? el('div.small.muted', [g.phone, p.car, p.method === 'staff' ? 'نداء يدوي' : p.method === 'auto' ? 'تلقائي' : null].filter(Boolean).join(' · ')) : null,
    actions.length ? el('div.actions', { class: actions.length === 1 ? 'one' : '' }, actions) : null);
}

function renderQueue() {
  const box = $('#queue');
  if (!box) return;
  const order = { announced: 0, sent: 1, released: 2, cancelled: 3 };
  const list = [...state.pickups.values()].filter((p) => p.status !== 'cancelled')
    .sort((a, b) => order[a.status] - order[b.status] || a.announced_at - b.announced_at);
  box.replaceChildren(...(list.length ? list.map(card) : [el('div.empty', 'لا يوجد نداء الآن. ستظهر الأسماء هنا فور وصول أولياء الأمور.')]));
  const s = $('#stats');
  if (s) s.replaceChildren(
    el('div.stat', el('b', state.stats.announced ?? 0), el('span', 'بانتظار الإرسال')),
    el('div.stat', el('b', state.stats.sent ?? 0), el('span', 'في الطريق')),
    el('div.stat', el('b', state.stats.released ?? 0), el('span', 'سُلّموا اليوم')));
}

function sidePanel() {
  const err = el('div.alert.error.hidden', { role: 'alert' });
  const code = el('input#manual-code.code-in', { inputmode: 'numeric', maxlength: 6, placeholder: '••••••', autocomplete: 'off' });
  const manual = el('form.card.stack', {
    onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      try {
        const r = await api('/api/school/manual', { method: 'POST', body: { code: code.value } });
        r.created.forEach((p) => onEvent('pickup', p));
        toast(r.created.length ? `تم نداء ${r.created.map((p) => p.student.name.split(' ')[0]).join('، ')}` : 'تم النداء مسبقاً', 'success');
        code.value = '';
      } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    },
  }, el('h2', 'نداء برمز الاستلام'), el('p.small.muted', 'لولي أمر بلا جوال أو بلا إنترنت: الرمز في تبويب «حسابي» في تطبيقه.'),
  el('label.sr-only', { for: 'manual-code' }, 'رمز الاستلام'), code, err, el('button.block', { type: 'submit' }, 'نادِ'));

  const results = el('div.results');
  const search = el('input#search', { type: 'search', placeholder: 'اسم الطالب أو الفصل أو رقم نور' });
  let t;
  search.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    if (search.value.trim().length < 2) { results.replaceChildren(); return; }
    const rows = await api(`/api/school/students?q=${encodeURIComponent(search.value.trim())}`);
    results.replaceChildren(...rows.map((s) => el('div.res',
      el('strong', s.name), el('div.small.muted', [s.grade, s.class_name].filter(Boolean).join(' · ')),
      el('div.small', s.guardians.map((g) => `${g.relation_ar}: ${g.name} ${g.phone}${g.role === 'delegate' ? ' (مفوّض)' : ''}`).join(' | ') || 'لا يوجد أولياء أمور'))));
  }, 250); };

  return el('aside.side.stack', manual,
    el('div.card.stack', el('h2', 'تحقق من طالب'), el('label.sr-only', { for: 'search' }, 'بحث'), search, results));
}

function render() {
  const voice = el('label.check.small', el('input', { type: 'checkbox', checked: state.voice, onchange: (e) => { state.voice = store('bb_voice', e.target.checked); unlockAudio(); } }), 'نطق الأسماء');
  const main = el('section.stack', el('div.row.between', el('h1', mode === 'teacher' ? 'طلاب فصلك المطلوبون' : 'النداء المباشر'), voice),
    el('div.stats#stats'), el('div.queue#queue', { 'aria-live': 'polite' }));
  app.replaceChildren(el('div.wrap.wide', mode === 'teacher' ? main : el('div.layout', sidePanel(), main)));
  renderQueue();
}
