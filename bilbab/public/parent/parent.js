import { api, el, $, toast, connectEvents, distanceMeters, fmtDistance, fmtTime, STATUS_AR, STATUS_KIND, store, logout } from '/shared/ui.js';

const app = $('#app');
const state = {
  me: null, tab: 'home', pos: null, geoError: null, watching: false, busy: false,
  selected: null, // Set of student ids; null = all eligible
  dev: false, demo: store('bb_demo_geo') === true,
  autoDoneDay: store('bb_auto_day'),
};
const settings = () => ({ auto: store('bb_auto') === true, car: store('bb_car') ?? '' });

boot();

async function boot() {
  try { state.dev = (await api('/api/health')).dev; } catch { /* offline */ }
  try {
    const me = await api('/api/me');
    if (me.kind !== 'guardian') throw new Error('staff');
    signedIn(me);
  } catch { renderLogin(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function signedIn(me) {
  state.me = me;
  $('#logout').classList.remove('hidden');
  $('#logout').onclick = logout;
  connectEvents('/api/events', onEvent, $('#conn'));
  if (state.demo && state.dev) useDemoPosition();
  else if (store('bb_geo_ok')) startWatch(); // permission was granted before: no extra tap
  render();
}

// ---------------- login ----------------
function renderLogin() {
  const err = el('div.alert.error.hidden', { role: 'alert' });
  const phone = el('input#phone', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', placeholder: '05XXXXXXXX', required: true });
  const form = el('form.card.stack', {
    onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      try {
        const r = await api('/api/auth/otp', { method: 'POST', body: { phone: phone.value } });
        renderOtp(phone.value, r.dev_code);
      } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    },
  },
  el('h1', 'أهلاً بك'),
  el('p.muted', 'ادخل برقم جوالك المسجّل لدى المدرسة. ستبقى مسجّلاً ولن نطلب منك الدخول كل يوم.'),
  // The button sits right under the field, so the keyboard never covers it.
  el('div.field', el('label', { for: 'phone' }, 'رقم الجوال'), phone),
  err,
  el('button.block', { type: 'submit' }, 'أرسل رمز التحقق'));
  app.replaceChildren(el('div.wrap', form));
  phone.focus();
}

function renderOtp(phoneValue, devCode) {
  const err = el('div.alert.error.hidden', { role: 'alert' });
  const code = el('input#code.otp', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 4, pattern: '[0-9٠-٩]{4}', required: true });
  const submit = async () => {
    err.classList.add('hidden');
    try { signedIn(await api('/api/auth/verify', { method: 'POST', body: { phone: phoneValue, code: code.value } })); }
    catch (x) { err.textContent = x.message; err.classList.remove('hidden'); code.select(); }
  };
  code.addEventListener('input', () => { if (code.value.length === 4) submit(); });
  const form = el('form.card.stack', { onsubmit: (e) => { e.preventDefault(); submit(); } },
    el('h1', 'رمز التحقق'),
    el('p.muted', `أرسلنا رمزاً من 4 أرقام إلى ${phoneValue}`),
    devCode ? el('p.pill.info', `وضع التجربة: الرمز ${devCode}`) : null,
    el('div.field', el('label', { for: 'code' }, 'الرمز'), code),
    err,
    el('button.block', { type: 'submit' }, 'دخول'),
    el('button.ghost.block', { type: 'button', onclick: renderLogin }, 'تغيير الرقم'));
  app.replaceChildren(el('div.wrap', form));
  code.focus();
}

// ---------------- location (only while the app is open) ----------------
function startWatch() {
  if (state.watching || !('geolocation' in navigator)) return;
  state.watching = true;
  navigator.geolocation.watchPosition(
    (p) => { store('bb_geo_ok', true); state.geoError = null; state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; tick(); },
    (e) => { state.geoError = e.code === 1 ? 'denied' : 'unavailable'; state.watching = e.code !== 1; render(); },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  );
}
function useDemoPosition() {
  const s = state.me.schools[0];
  if (s) state.pos = { lat: s.lat + 0.0004, lng: s.lng, accuracy: 10 };
}

function nearest() {
  const schools = state.me?.schools ?? [];
  if (!schools.length) return null;
  if (!state.pos) return { school: schools[0], distance: null };
  return schools.map((s) => ({ school: s, distance: distanceMeters(s.lat, s.lng, state.pos.lat, state.pos.lng) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function tick() {
  render();
  // Hands-free: announce on entering the zone, once a day, if the parent turned it on.
  const n = nearest(), c = buttonState(n);
  if (c.kind === 'ready' && settings().auto && state.autoDoneDay !== state.me.today) {
    state.autoDoneDay = store('bb_auto_day', state.me.today);
    announce(true);
  }
}

// ---------------- home ----------------
function kidsAt(schoolId) { return state.me.children.filter((k) => k.school_id === schoolId); }
const isLive = (k) => k.pickup && ['announced', 'sent'].includes(k.pickup.status);

function buttonState(n) {
  if (!n) return { kind: 'none', text: 'لا يوجد طلاب مرتبطون بحسابك', sub: 'تواصل مع المدرسة لإضافة رقمك' };
  const kids = kidsAt(n.school.id);
  const callable = kids.filter((k) => k.today && !isLive(k) && k.pickup?.status !== 'released');
  const live = kids.filter(isLive);
  const chosen = callable.filter((k) => !state.selected || state.selected.has(k.id));
  if (!callable.length && live.length) return { kind: 'done', text: 'تم إبلاغ المدرسة', sub: 'سيصلك إشعار عند التسليم' };
  if (!callable.length) return { kind: 'none', text: 'لا يوجد نداء اليوم', sub: kids.some((k) => k.pickup?.status === 'released') ? 'تم تسليم أبنائك' : 'لا يوجد طلاب مصرّح لك اليوم' };
  if (!state.pos) return { kind: 'locate', text: 'فعّل الموقع', sub: 'نستخدمه فقط وأنت داخل التطبيق' };
  const slack = Math.min(state.pos.accuracy ?? 0, 50);
  if (n.distance > n.school.radius_m + slack) return { kind: 'far', text: `تبعد ${fmtDistance(n.distance)}`, sub: `يتفعّل الزر عند الاقتراب من ${n.school.name}` };
  if (!n.school.open_now) return { kind: 'closed', text: 'خارج وقت الانصراف', sub: `النداء من ${n.school.dismiss_start} إلى ${n.school.dismiss_end}` };
  if (!chosen.length) return { kind: 'pick', text: 'اختر طالباً', sub: 'حدد من تريد استلامه' };
  return { kind: 'ready', text: live.length ? 'نادِ البقية' : 'وصلت', sub: chosen.length === 1 ? `نادِ ${chosen[0].name.split(' ')[0]}` : `نادِ ${chosen.length} أبناء`, chosen };
}

async function announce(auto = false) {
  const n = nearest(); const b = buttonState(n);
  if (b.kind === 'locate') { startWatch(); return; }
  if (b.kind !== 'ready' || state.busy) return;
  state.busy = true; render();
  try {
    const r = await api('/api/announce', { method: 'POST', body: { ...state.pos, student_ids: b.chosen.map((k) => k.id), car: settings().car, auto } });
    for (const p of [...r.created, ...r.already]) applyPickup(p);
    toast(auto ? 'أعلنّا وصولك تلقائياً، المدرسة تنادي أبناءك الآن' : 'تم! المدرسة تنادي أبناءك الآن', 'success');
    navigator.vibrate?.(80);
  } catch (x) {
    toast(x.message, 'error');
    if (x.status === 401) location.reload();
  } finally { state.busy = false; render(); }
}

function renderHome() {
  const n = nearest(); const b = buttonState(n);
  const btn = el('button.arrive#arrive', {
    class: b.kind === 'ready' ? 'ready' : b.kind === 'done' ? 'done' : '',
    disabled: !['ready', 'locate'].includes(b.kind) || state.busy,
    onclick: () => announce(false),
    'aria-describedby': 'arrive-sub',
  }, state.busy ? 'جارٍ الإرسال…' : b.text, el('small#arrive-sub', b.sub));

  const geoMsg = state.geoError === 'denied'
    ? el('div.alert', 'الموقع مرفوض. فعّله من إعدادات المتصفح لهذا الموقع ("أثناء الاستخدام" يكفي)، أو أعطِ المشرف رمز الاستلام من تبويب «حسابي».')
    : null;

  const sections = [el('section.hero', btn, geoMsg)];
  if (state.dev) {
    sections.push(el('label.check.small.muted', el('input', { type: 'checkbox', checked: state.demo, onchange: (e) => {
      state.demo = store('bb_demo_geo', e.target.checked);
      if (state.demo) useDemoPosition(); else { state.pos = null; startWatch(); }
      render();
    } }), 'وضع التجربة: اعتبرني عند المدرسة'));
  }

  for (const s of state.me.schools) {
    const kids = kidsAt(s.id);
    sections.push(el('section.stack',
      el('h2', s.name),
      el('div.kids', kids.map(kidRow))));
  }
  if (!state.me.children.length) sections.push(el('div.alert', 'لا يوجد طلاب مرتبطون برقمك بعد. اطلب من المدرسة أو من ولي الأمر تفويضك.'));
  return el('div.wrap.stack', sections);
}

function kidRow(k) {
  const live = isLive(k);
  const callable = k.today && !live && k.pickup?.status !== 'released';
  const on = callable && (!state.selected || state.selected.has(k.id));
  const steps = k.pickup && k.pickup.status !== 'cancelled'
    ? el('div.steps', { 'aria-hidden': 'true' }, ['announced', 'sent', 'released'].map((st, i) =>
      el('span', { class: ['announced', 'sent', 'released'].indexOf(k.pickup.status) >= i ? 'on' : '' })))
    : null;
  const box = callable ? el('input', { type: 'checkbox', checked: on, 'aria-label': `نداء ${k.name}`, onchange: (e) => {
    const all = state.me.children.filter((c) => c.today && !isLive(c)).map((c) => c.id);
    state.selected ??= new Set(all);
    e.target.checked ? state.selected.add(k.id) : state.selected.delete(k.id);
    render();
  } }) : null;
  const status = k.pickup
    ? el('span.pill', { class: STATUS_KIND[k.pickup.status] }, STATUS_AR[k.pickup.status], k.pickup.status === 'released' ? ` ${fmtTime(k.pickup.released_at)}` : '')
    : !k.today ? el('span.pill.muted', 'غير مصرّح اليوم') : null;
  const by = k.pickup && k.pickup.guardian.id !== state.me.id && k.pickup.status !== 'cancelled'
    ? el('div.meta', `بواسطة ${k.pickup.guardian.name} (${k.pickup.guardian.relation_ar})`) : null;
  const cancel = live && (k.pickup.guardian.id === state.me.id || k.role === 'owner')
    ? el('button.ghost.sm', { onclick: () => cancelPickup(k.pickup.id) }, 'إلغاء') : null;
  return el('label.kid', { class: on ? 'on' : !k.today ? 'off' : '' },
    box,
    el('div.grow', el('div.name', k.name), el('div.meta', [k.grade, k.class_name].filter(Boolean).join(' · '), k.role === 'delegate' ? ' · مفوّض' : ''), by, steps),
    status, cancel);
}

async function cancelPickup(id) {
  try { applyPickup(await api(`/api/pickups/${id}/cancel`, { method: 'POST', body: {} })); toast('تم إلغاء النداء'); }
  catch (x) { toast(x.message, 'error'); }
}

// ---------------- realtime ----------------
function applyPickup(p) {
  const k = state.me.children.find((c) => c.id === p.student.id);
  if (k) k.pickup = p;
}
function onEvent(type, p) {
  if (type === 'open') { refresh(); return; }
  if (type !== 'pickup' || !state.me) return;
  const prev = state.me.children.find((c) => c.id === p.student.id)?.pickup;
  applyPickup(p);
  render({ live: true });
  if (prev?.status === p.status) return;
  const first = p.student.name.split(' ')[0];
  const mine = p.guardian.id === state.me.id;
  let msg = null;
  if (p.status === 'announced' && !mine) msg = `${p.guardian.name} (${p.guardian.relation_ar}) وصل لاستلام ${first}`;
  if (p.status === 'sent') msg = `${first} في الطريق إلى البوابة`;
  if (p.status === 'released') msg = mine ? `تم تسليم ${first} إليك ✓` : `تم تسليم ${first} إلى ${p.guardian.name} ✓`;
  if (p.status === 'cancelled' && !mine) msg = `أُلغي نداء ${first}`;
  if (!msg) return;
  toast(msg, p.status === 'released' ? 'success' : '');
  navigator.vibrate?.([60, 40, 60]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then((r) => r.showNotification('بالباب', { body: msg, tag: p.id, lang: 'ar', dir: 'rtl', icon: '/shared/icon.svg' }))
      .catch(() => new Notification('بالباب', { body: msg }));
  }
}
async function refresh() {
  try { const me = await api('/api/me'); if (me.kind !== 'guardian') return location.reload(); state.me = me; render({ live: true }); } catch (x) { if (x.status === 401) location.reload(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) refresh(); });

// ---------------- delegation ----------------
const REL = [['driver', 'السائق'], ['mother', 'الأم'], ['father', 'الأب'], ['brother', 'الأخ'], ['sister', 'الأخت'], ['grandfather', 'الجد'], ['grandmother', 'الجدة'], ['uncle', 'العم/الخال'], ['aunt', 'العمة/الخالة'], ['relative', 'قريب']];

function renderDelegates() {
  const mine = state.me.children.filter((k) => k.role === 'owner');
  if (!mine.length) return el('div.wrap', el('div.alert', 'التفويض متاح لولي الأمر فقط.'));
  const list = state.me.delegates.length
    ? el('div.card', state.me.delegates.map((d) => el('div.delegate',
      el('div', el('div', el('strong', d.name), ` · ${d.relation_ar}`),
        el('div.small.muted', d.phone, ' · ', d.student_ids.map((sid) => state.me.children.find((k) => k.id === sid)?.name.split(' ')[0]).filter(Boolean).join('، '),
          ' · ', d.valid_to ? (d.valid_from === d.valid_to ? `ليوم ${d.valid_to} فقط` : `حتى ${d.valid_to}`) : 'دائم')),
      el('button.danger.sm', { onclick: () => removeDelegate(d) }, 'إلغاء التفويض'))))
    : el('p.muted', 'لا يوجد مفوّضون بعد.');

  const err = el('div.alert.error.hidden', { role: 'alert' });
  const scope = el('select#scope', el('option', { value: 'today' }, 'اليوم فقط'), el('option', { value: 'always' }, 'دائماً حتى ألغيه'), el('option', { value: 'range' }, 'فترة محددة'));
  const range = el('div.row.hidden', el('div.grow', el('label', { for: 'from' }, 'من'), el('input#from', { type: 'date' })), el('div.grow', el('label', { for: 'to' }, 'إلى'), el('input#to', { type: 'date' })));
  scope.onchange = () => range.classList.toggle('hidden', scope.value !== 'range');
  const form = el('form.card.stack#delegate-form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      const f = e.target;
      const ids = [...f.querySelectorAll('input[name=kid]:checked')].map((i) => i.value);
      try {
        state.me = await api('/api/delegates', { method: 'POST', body: {
          name: f.dname.value, phone: f.dphone.value, relation: f.relation.value, student_ids: ids,
          scope: scope.value, valid_from: f.from.value || undefined, valid_to: f.to.value || undefined,
        } });
        toast('تم التفويض وأرسلنا له رسالة', 'success');
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    },
  },
  el('h2', 'فوّض سائقاً أو قريباً'),
  el('div.field', el('label', { for: 'dname' }, 'الاسم'), el('input#dname', { name: 'dname', required: true, maxlength: 80 })),
  el('div.field', el('label', { for: 'dphone' }, 'رقم الجوال'), el('input#dphone', { name: 'dphone', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '05XXXXXXXX', required: true })),
  el('div.field', el('label', { for: 'relation' }, 'الصلة'), el('select#relation', { name: 'relation' }, REL.map(([val, t]) => el('option', { value: val }, t)))),
  el('fieldset', el('legend', 'يستلم'), mine.map((k) => el('label.check', el('input', { type: 'checkbox', name: 'kid', value: k.id, checked: true }), k.name))),
  el('div.field', el('label', { for: 'scope' }, 'المدة'), scope),
  range,
  err,
  el('button.block', { type: 'submit' }, 'فوّض'));
  return el('div.wrap.stack', el('h1', 'التفويض'), el('p.muted', 'المفوّض يدخل برقم جواله ويظهر له زر «وصلت» لأبنائك فقط، وتصلك إشعارات بكل خطوة.'), list, form);
}

async function removeDelegate(d) {
  if (!confirm(`إلغاء تفويض ${d.name}؟`)) return;
  try { state.me = await api(`/api/delegates/${d.id}`, { method: 'DELETE' }); toast('تم إلغاء التفويض'); render(); }
  catch (x) { toast(x.message, 'error'); }
}

// ---------------- account ----------------
function renderAccount() {
  const s = settings();
  const notif = 'Notification' in window
    ? el('button.secondary.block', { disabled: Notification.permission === 'granted', onclick: async () => { await Notification.requestPermission(); render(); } },
      Notification.permission === 'granted' ? 'الإشعارات مفعّلة' : 'فعّل الإشعارات')
    : null;
  return el('div.wrap.stack',
    el('h1', state.me.name),
    el('p.muted', state.me.phone),
    el('div.card.stack',
      el('h2', 'رمز الاستلام'),
      el('div.code#pickup-code', state.me.pickup_code),
      el('p.small.muted', 'إذا انقطع الإنترنت أو لم يعمل الموقع، أعطِ هذا الرمز لمشرف البوابة وسيُنادى أبناؤك.')),
    el('div.card.stack',
      el('h2', 'الاستلام بدون لمس'),
      el('label.check', el('input#auto', { type: 'checkbox', checked: s.auto, onchange: (e) => { store('bb_auto', e.target.checked); if (e.target.checked) startWatch(); } }),
        'أعلن وصولي تلقائياً عند دخول نطاق المدرسة'),
      el('p.small.muted', 'افتح التطبيق قبل الوصول وضعه على الحامل. لا نتتبع موقعك والتطبيق مغلق.'),
      el('div.field', el('label', { for: 'car' }, 'سيارتك (تظهر للمشرف)'),
        el('input#car', { value: s.car, maxlength: 60, placeholder: 'مثال: كامري بيضاء', onchange: (e) => store('bb_car', e.target.value.trim()) }))),
    notif,
    el('button.secondary.block', { onclick: logout }, 'تسجيل الخروج'));
}

// ---------------- shell ----------------
function render({ live = false } = {}) {
  if (!state.me) return;
  const views = { home: renderHome, delegates: renderDelegates, account: renderAccount };
  const focused = document.activeElement?.id;
  const nav = el('nav.tabs', { 'aria-label': 'التنقل' },
    [['home', 'الرئيسية'], ['delegates', 'التفويض'], ['account', 'حسابي']].map(([t, label]) =>
      el('button', { 'aria-current': state.tab === t ? 'page' : false, onclick: () => { state.tab = t; render(); window.scrollTo(0, 0); } }, label)));
  // don't wipe a form the user is typing in when a realtime event arrives
  if (live && state.tab !== 'home' && app.dataset.tab === state.tab && document.activeElement?.closest?.('form')) return;
  app.dataset.tab = state.tab;
  app.replaceChildren(views[state.tab](), nav);
  if (focused) document.getElementById(focused)?.focus?.();
}
