import { api, el, $, toast, staffLogin, logout, fmtTime, STATUS_AR } from '/shared/ui.js';

const app = $('#app');
let me;

staffLogin('الإدارة', async (profile) => {
  if (profile.role !== 'admin') { app.replaceChildren(el('div.wrap', el('div.alert', 'هذه الصفحة لمدير المدرسة فقط.'), el('a.btn', { href: '/gate/' }, 'اذهب إلى البوابة'))); return; }
  me = profile;
  $('#who').textContent = me.name;
  $('#logout').classList.remove('hidden');
  $('#logout').onclick = logout;
  render();
});

function settingsCard() {
  const s = me.school;
  const f = (id, label, attrs = {}) => el('div.field', el('label', { for: id }, label), el(`input#${id}`, { name: id, ...attrs }));
  const err = el('div.alert.error.hidden', { role: 'alert' });
  const form = el('form.card.stack#settings', {
    onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      const x = e.target;
      try {
        me = await api('/api/admin/school', { method: 'PUT', body: {
          name: x.sname.value, lat: x.lat.value, lng: x.lng.value, radius_m: x.radius.value,
          dismiss_start: x.start.value, dismiss_end: x.end.value, enforce_window: x.enforce.checked,
        } });
        toast('تم الحفظ', 'success');
      } catch (y) { err.textContent = y.message; err.classList.remove('hidden'); }
    },
  },
  el('h2', 'المدرسة ونطاق النداء'),
  f('sname', 'اسم المدرسة', { value: s.name, required: true }),
  el('div.row', el('div.grow', f('lat', 'خط العرض', { value: s.lat, dir: 'ltr', inputmode: 'decimal' })), el('div.grow', f('lng', 'خط الطول', { value: s.lng, dir: 'ltr', inputmode: 'decimal' }))),
  el('button.secondary', { type: 'button', onclick: () => navigator.geolocation.getCurrentPosition(
    (p) => { $('#lat').value = p.coords.latitude.toFixed(6); $('#lng').value = p.coords.longitude.toFixed(6); toast('أُخذ موقعك الحالي. احفظ للتأكيد'); },
    () => toast('تعذّر تحديد الموقع', 'error'), { enableHighAccuracy: true }) }, 'استخدم موقعي الحالي (قف عند البوابة)'),
  f('radius', 'نصف قطر النطاق بالمتر', { value: s.radius_m, type: 'number', min: 50, max: 2000, dir: 'ltr' }),
  el('p.hint', '250 م مناسب لأغلب المدارس. وسّعه إذا كان طابور السيارات طويلاً.'),
  el('div.row', el('div.grow', f('start', 'بداية الانصراف', { value: s.dismiss_start, type: 'time', dir: 'ltr' })), el('div.grow', f('end', 'نهاية الانصراف', { value: s.dismiss_end, type: 'time', dir: 'ltr' }))),
  el('label.check', el('input#enforce', { type: 'checkbox', name: 'enforce', checked: !!s.enforce_window }), 'اسمح بالنداء في وقت الانصراف فقط'),
  err,
  el('button', { type: 'submit' }, 'حفظ'));
  return form;
}

function displayCard() {
  const url = `${location.origin}/display/?school=${encodeURIComponent(me.school.id)}&key=${encodeURIComponent(me.school.display_key)}`;
  return el('div.card.stack', el('h2', 'شاشة النداء في الساحة'),
    el('p.small.muted', 'افتح هذا الرابط على شاشة التلفاز أو أي متصفح. يعرض الأسماء وينطقها. لا تشاركه خارج المدرسة.'),
    el('input#display-url', { value: url, readonly: true, dir: 'ltr', onclick: (e) => e.target.select() }),
    el('div.row', el('a.btn.secondary', { href: url, target: '_blank', rel: 'noopener' }, 'افتح الشاشة'),
      el('button.secondary', { onclick: () => navigator.clipboard?.writeText(url).then(() => toast('نُسخ الرابط')) }, 'انسخ')));
}

function importCard() {
  const out = el('div');
  const ta = el('textarea#csv', { rows: 6, dir: 'auto', placeholder: 'اسم الطالب,الصف,الفصل,رقم نور,اسم ولي الأمر,جوال ولي الأمر,الصلة\nسارة خالد,الثالث,3/أ,1000000001,خالد,0500000001,father' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv', onchange: async (e) => { ta.value = await e.target.files[0].text(); } });
  return el('div.card.stack', el('h2', 'استيراد الطلاب وأولياء الأمور'),
    el('p.small.muted', 'صدّر من نور أو Excel بصيغة CSV (UTF-8). الأعمدة: اسم الطالب، الصف، الفصل، رقم نور، اسم ولي الأمر، الجوال، الصلة (father/mother أو الأب/الأم). صف لكل ولي أمر.'),
    file, el('label.sr-only', { for: 'csv' }, 'CSV'), ta,
    el('button', { onclick: async () => {
      try {
        const r = await api('/api/admin/import', { method: 'POST', body: { csv: ta.value } });
        out.replaceChildren(el('p.pill.success', `طلاب جدد: ${r.students} · أولياء أمور جدد: ${r.guardians} · روابط: ${r.links}`),
          ...r.errors.map((x) => el('div.small', `سطر ${x.row}: ${x.error}`)));
      } catch (x) { toast(x.message, 'error'); }
    } }, 'استيراد'), out);
}

async function staffCard() {
  const list = el('div.table-wrap');
  const load = async () => {
    const rows = await api('/api/admin/staff');
    const ROLE = { admin: 'مدير', gate: 'مشرف بوابة', teacher: 'معلم/ة' };
    list.replaceChildren(el('table', el('thead', el('tr', el('th', 'الاسم'), el('th', 'المستخدم'), el('th', 'الدور'))),
      el('tbody', rows.map((r) => el('tr', el('td', r.name), el('td', { dir: 'ltr' }, r.username), el('td', ROLE[r.role], r.class_name ? ` (${r.class_name})` : ''))))));
  };
  await load();
  const role = el('select#role', { name: 'role' }, el('option', { value: 'gate' }, 'مشرف بوابة'), el('option', { value: 'teacher' }, 'معلم/ة فصل'), el('option', { value: 'admin' }, 'مدير'));
  const cls = el('div.field.hidden', el('label', { for: 'cls' }, 'الفصل'), el('input#cls', { name: 'cls', placeholder: '3/أ' }));
  role.onchange = () => cls.classList.toggle('hidden', role.value !== 'teacher');
  const form = el('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault(); const x = e.target;
      try {
        await api('/api/admin/staff', { method: 'POST', body: { name: x.n.value, username: x.u.value, password: x.p.value, role: role.value, class_name: x.cls.value } });
        x.reset(); toast('أُضيف الموظف', 'success'); load();
      } catch (y) { toast(y.message, 'error'); }
    },
  },
  el('div.row', el('input', { name: 'n', placeholder: 'الاسم', required: true, 'aria-label': 'الاسم', class: 'grow' }),
    el('input', { name: 'u', placeholder: 'اسم المستخدم', dir: 'ltr', required: true, 'aria-label': 'اسم المستخدم', class: 'grow' }),
    el('input', { name: 'p', type: 'password', placeholder: 'كلمة مرور (8+)', required: true, 'aria-label': 'كلمة المرور', class: 'grow', autocomplete: 'new-password' })),
  el('div.field', el('label', { for: 'role' }, 'الدور'), role), cls,
  el('button', { type: 'submit' }, 'أضف موظفاً'));
  return el('div.card.stack', el('h2', 'الموظفون'), list, form);
}

async function reportCard() {
  const r = await api('/api/admin/report');
  return el('div.card.stack', el('h2', `تقرير اليوم ${r.day}`),
    el('div.stats', el('div.stat', el('b', r.total), el('span', 'نداء')), el('div.stat', el('b', r.released), el('span', 'تسليم')),
      el('div.stat', el('b', r.median_wait_s == null ? '—' : `${Math.round(r.median_wait_s / 60)} د`), el('span', 'متوسط الانتظار'))),
    el('div.table-wrap', el('table', el('thead', el('tr', ['الطالب', 'المستلم', 'الحالة', 'النداء', 'التسليم'].map((h) => el('th', h)))),
      el('tbody', r.rows.map((p) => el('tr', el('td', p.student.name), el('td', `${p.guardian.relation_ar}: ${p.guardian.name}`),
        el('td', STATUS_AR[p.status]), el('td', fmtTime(p.announced_at)), el('td', fmtTime(p.released_at))))))));
}

async function render() {
  app.replaceChildren(el('div.wrap.wide.stack',
    el('div.row', el('a.btn.secondary', { href: '/gate/' }, 'شاشة البوابة'), el('a.btn.secondary', { href: '/teacher/' }, 'شاشة المعلمة')),
    el('div.layout', el('div.stack', settingsCard(), displayCard()), el('div.stack', await reportCard(), await staffCard(), importCard()))));
}
