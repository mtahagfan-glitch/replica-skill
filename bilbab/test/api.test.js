import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb, seed } from '../lib/db.js';
import { createApp } from '../lib/app.js';
import { normalizeSaudiPhone, insideGeofence, schoolClock, inWindow, parseCsv, grantActive } from '../lib/core.js';

// 2026-11-03 09:00 UTC = 12:00 Riyadh, a Tuesday (weekday 2), inside the 11:30-14:30 window.
let NOW = Date.parse('2026-11-03T09:00:00Z');
const SCHOOL = { lat: 24.7136, lng: 46.6753 };
let server, base, db, seeded;

before(async () => {
  db = openDb(':memory:');
  seeded = seed(db);
  server = createApp(db, { dev: true, now: () => NOW, log: () => {} });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => null);
    return { status: r.status, data, setCookie: sc };
  };
  return {
    get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p),
    cookie: () => cookie,
    async loginPhone(phone) {
      const o = await call('POST', '/api/auth/otp', { phone });
      assert.equal(o.status, 200, JSON.stringify(o.data));
      const v = await call('POST', '/api/auth/verify', { phone, code: o.data.dev_code });
      assert.equal(v.status, 200, JSON.stringify(v.data));
      return v;
    },
    async loginStaff(username) {
      const r = await call('POST', '/api/staff/login', { username, password: seeded.staffPassword });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    },
  };
}

// Open an SSE stream and collect events.
function listen(cookie, path = '/api/events') {
  const events = [];
  let req;
  const ready = new Promise((resolve) => {
    req = http.get(base + path, { headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /event: (.+)/.exec(chunk)?.[1]; const data = /data: (.+)/.exec(chunk)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      });
      resolve(res.statusCode);
    });
  });
  const waitFor = async (pred, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const e = events.find(pred); if (e) return e; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('event not received');
  };
  return { ready, events, waitFor, close: () => req.destroy() };
}

const at = (dLat = 0.0005, acc = 10) => ({ lat: SCHOOL.lat + dLat, lng: SCHOOL.lng, accuracy: acc }); // ~55 m north

// ---------- pure helpers ----------
test('saudi phone numbers normalise in every common form', () => {
  for (const p of ['0501234567', '501234567', '+966501234567', '00966501234567', '٠٥٠١٢٣٤٥٦٧', '050 123 4567', '050-123-4567']) {
    assert.equal(normalizeSaudiPhone(p), '966501234567', p);
  }
  for (const p of ['0401234567', '05012345', 'abc', '', null]) assert.equal(normalizeSaudiPhone(p), null, String(p));
});

test('geofence: inside, outside, and a huge accuracy cannot fake presence', () => {
  const s = { ...SCHOOL, radius_m: 250 };
  assert.equal(insideGeofence(s, SCHOOL.lat + 0.0005, SCHOOL.lng, 10).inside, true);
  assert.equal(insideGeofence(s, SCHOOL.lat + 0.01, SCHOOL.lng, 10).inside, false); // ~1.1 km
  assert.equal(insideGeofence(s, SCHOOL.lat + 0.0027, SCHOOL.lng, 5000).inside, false); // 300 m, "accuracy 5 km"
});

test('school clock is Riyadh time and the window check works', () => {
  assert.deepEqual(schoolClock(Date.parse('2026-11-03T21:30:00Z')), { day: '2026-11-04', hm: '00:30', weekday: 3 });
  assert.equal(inWindow('12:00', '11:30', '14:30'), true);
  assert.equal(inWindow('15:00', '11:30', '14:30'), false);
});

test('delegation applies only on its days and dates', () => {
  const c = { day: '2026-11-03', weekday: 2 };
  assert.equal(grantActive({ role: 'delegate', days: '0123456' }, c), true);
  assert.equal(grantActive({ role: 'delegate', days: '01', valid_from: null }, c), false);
  assert.equal(grantActive({ role: 'delegate', days: '0123456', valid_to: '2026-11-02' }, c), false);
  assert.equal(grantActive({ role: 'owner', days: '' }, c), true);
});

test('csv parser handles quotes, BOM and Arabic semicolons', () => {
  assert.deepEqual(parseCsv('﻿a,"b, c",d\r\n1؛2؛3\n'), [['a', 'b, c', 'd'], ['1', '2', '3']]);
});

// ---------- auth ----------
test('unknown phone gets the same answer and no code (no enumeration)', async () => {
  const r = await client().post('/api/auth/otp', { phone: '0599999999' });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, true);
  assert.equal(r.data.dev_code, undefined);
});

test('wrong OTP fails, and 5 wrong tries lock the code', async () => {
  const c = client();
  const o = await c.post('/api/auth/otp', { phone: '0500000004' });
  const wrong = o.data.dev_code === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/verify', { phone: '0500000004', code: wrong })).status, 400);
  assert.equal((await c.post('/api/auth/verify', { phone: '0500000004', code: o.data.dev_code })).status, 400);
});

test('sign-in lasts 90 days in an http-only cookie (no daily logins)', async () => {
  const v = await client().loginPhone('0500000003');
  assert.match(v.setCookie, /HttpOnly/);
  assert.match(v.setCookie, /Max-Age=7776000/);
});

test('cross-site POST is refused', async () => {
  const c = client(); await c.loginPhone('0500000003');
  const r = await c.post('/api/announce', at(), { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

// ---------- core loop ----------
test('F01: father arrives, school is notified live, teacher sends, gate releases, father is notified', async () => {
  const father = client(); await father.loginPhone('0500000001');
  const gate = client(); await gate.loginStaff('gate');
  const teacher = client(); await teacher.loginStaff('teacher3a');
  const gateEvents = listen(gate.cookie()); assert.equal(await gateEvents.ready, 200);
  const fatherEvents = listen(father.cookie()); await fatherEvents.ready;
  const motherClient = client(); await motherClient.loginPhone('0500000002');
  const motherEvents = listen(motherClient.cookie()); await motherEvents.ready;

  const me = await father.get('/api/me');
  assert.equal(me.data.children.length, 2);

  // too far
  const far = await father.post('/api/announce', at(0.01));
  assert.equal(far.status, 400); assert.equal(far.data.error, 'outside');

  const r = await father.post('/api/announce', { ...at(), car: 'كامري بيضاء' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created.length, 2);
  const e = await gateEvents.waitFor((x) => x.data.student.name.startsWith('سارة'));
  assert.equal(e.data.status, 'announced');
  assert.equal(e.data.car, 'كامري بيضاء');
  assert.equal(e.data.guardian.relation_ar, 'الأب');
  await motherEvents.waitFor((x) => x.data.status === 'announced'); // the other parent knows too

  // double tap: nothing duplicated
  const again = await father.post('/api/announce', at());
  assert.equal(again.data.created.length, 0);
  assert.equal(again.data.already.length, 2);

  // teacher of 3/أ sees only Sara, can send her, cannot release, cannot touch 1/ب
  const tq = await teacher.get('/api/school/queue');
  assert.deepEqual(tq.data.pickups.map((p) => p.student.class_name), ['3/أ']);
  const sara = tq.data.pickups[0];
  const abd = r.data.created.find((p) => p.student.class_name === '1/ب');
  assert.equal((await teacher.post(`/api/school/pickups/${abd.id}/sent`)).status, 403);
  assert.equal((await teacher.post(`/api/school/pickups/${sara.id}/release`)).status, 403);
  assert.equal((await teacher.post(`/api/school/pickups/${sara.id}/sent`)).data.status, 'sent');
  await fatherEvents.waitFor((x) => x.data.id === sara.id && x.data.status === 'sent');

  const rel = await gate.post(`/api/school/pickups/${sara.id}/release`);
  assert.equal(rel.data.status, 'released');
  const done = await fatherEvents.waitFor((x) => x.data.id === sara.id && x.data.status === 'released');
  assert.ok(done.data.released_at >= done.data.announced_at);
  assert.equal((await gate.post(`/api/school/pickups/${sara.id}/release`)).data.status, 'released'); // idempotent

  // a second release day-of can't re-announce Sara (released), Abdullah still live
  const me2 = await father.get('/api/me');
  assert.equal(me2.data.children.find((k) => k.name.startsWith('سارة')).pickup.status, 'released');
  gateEvents.close(); fatherEvents.close(); motherEvents.close();
});

test('outside dismissal hours the button is refused', async () => {
  const saved = NOW;
  NOW = Date.parse('2026-11-03T05:00:00Z'); // 08:00 Riyadh
  const c = client(); await c.loginPhone('0500000003');
  const r = await c.post('/api/announce', at());
  assert.equal(r.status, 400); assert.equal(r.data.error, 'closed');
  NOW = saved;
});

test('F02: father authorises the driver for today; driver announces; father is told; tomorrow it has expired', async () => {
  const father = client(); await father.loginPhone('0500000005');
  const me = (await father.get('/api/me')).data;
  const lin = me.children.find((k) => k.name.startsWith('لين'));
  const d = await father.post('/api/delegates', { name: 'رحمت الله', phone: '0555555555', relation: 'driver', student_ids: [lin.id], scope: 'today' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.delegates[0].relation_ar, 'السائق');

  // can't delegate a child that isn't yours
  const bad = await father.post('/api/delegates', { name: 'x', phone: '0555555556', relation: 'driver', student_ids: ['stu_1'], scope: 'always' });
  assert.equal(bad.status, 403);

  const fatherEvents = listen(father.cookie()); await fatherEvents.ready;
  const driver = client(); await driver.loginPhone('0555555555');
  const dme = (await driver.get('/api/me')).data;
  assert.deepEqual(dme.children.map((k) => k.name), [lin.name]); // only Lin, not her brother
  const r = await driver.post('/api/announce', at());
  assert.equal(r.data.created.length, 1);
  const ev = await fatherEvents.waitFor((x) => x.data.student.id === lin.id && x.data.status === 'announced');
  assert.equal(ev.data.guardian.delegate, true);
  assert.equal(ev.data.guardian.granted_by, 'ماجد الدوسري');
  fatherEvents.close();

  const saved = NOW;
  NOW += 864e5; // tomorrow
  const tomorrow = (await driver.get('/api/me')).data;
  assert.equal(tomorrow.children[0].today, false);
  assert.equal((await driver.post('/api/announce', at())).data.error, 'no_students');
  NOW = saved;

  // removing the driver leaves the father's own link alone
  const after_ = await father.del(`/api/delegates/${dme.id}`);
  assert.equal(after_.data.delegates.length, 0);
  assert.equal(after_.data.children.length, 2);
});

test('gate can call by the 6-digit pickup code (no phone / no signal)', async () => {
  const gate = client(); await gate.loginStaff('gate');
  const code = db.prepare(`select pickup_code from guardians where phone = '966500000004'`).get().pickup_code;
  const r = await gate.post('/api/school/manual', { code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created[0].method, 'staff');
  assert.equal((await gate.post('/api/school/manual', { code: '000000' })).status, 404);
});

test('hall display needs its key and never shows phone numbers', async () => {
  assert.equal((await fetch(`${base}/api/display/sch_demo/queue?key=wrong`)).status, 403);
  const r = await (await fetch(`${base}/api/display/sch_demo/queue?key=${seeded.displayKey}`)).json();
  assert.ok(r.pickups.length > 0);
  assert.ok(r.pickups.every((p) => p.guardian.phone === undefined));
});

test('parents can not use staff endpoints, teachers can not use admin', async () => {
  const p = client(); await p.loginPhone('0500000003');
  assert.equal((await p.get('/api/school/queue')).status, 401);
  const t = client(); await t.loginStaff('teacher1b');
  assert.equal((await t.put('/api/admin/school', {})).status, 403);
  assert.equal((await t.post('/api/school/manual', { code: '123456' })).status, 403);
});

test('admin imports a Noor/Excel CSV with Arabic relations and Arabic digits', async () => {
  const a = client(); await a.loginStaff('admin');
  const csv = 'اسم الطالب,الصف,الفصل,رقم نور,ولي الأمر,الجوال,الصلة\n'
    + 'نوف سعد الحربي,الثاني,2/أ,1099990001,سعد الحربي,٠٥٠٧٧٧٧٧٧٧,الأب\n'
    + 'نوف سعد الحربي,الثاني,2/أ,1099990001,هيا الحربي,0508888888,الأم\n'
    + 'بلا جوال,الثاني,2/أ,,خطأ,123,الأب\n';
  const r = await a.post('/api/admin/import', { csv });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.students, 2);
  assert.equal(r.data.guardians, 2);
  assert.equal(r.data.errors.length, 1);
  const mom = client(); await mom.loginPhone('0508888888');
  const me = (await mom.get('/api/me')).data;
  assert.equal(me.children[0].name, 'نوف سعد الحربي');
  assert.equal(me.children[0].relation, 'mother');
});

test('admin settings validate (geofence must be in Saudi Arabia)', async () => {
  const a = client(); await a.loginStaff('admin');
  const bad = await a.put('/api/admin/school', { name: 'x', lat: 51.5, lng: -0.1, radius_m: 250, dismiss_start: '11:30', dismiss_end: '14:30' });
  assert.equal(bad.status, 400);
  const ok = await a.put('/api/admin/school', { name: 'مدرسة الرواد', lat: SCHOOL.lat, lng: SCHOOL.lng, radius_m: 300, dismiss_start: '١١:٠٠', dismiss_end: '14:30', enforce_window: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.school.dismiss_start, '11:00');
});

test('OTP requests are rate limited per phone', async () => {
  const c = client();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await c.post('/api/auth/otp', { phone: '0500000003' })).status);
  assert.ok(codes.includes(429), codes.join(','));
});
