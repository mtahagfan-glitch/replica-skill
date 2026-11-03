// HTTP app: JSON API + Server-Sent Events + static files. Node standard library only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  schoolClock, inWindow, insideGeofence, normalizeSaudiPhone, displayPhone, id, sha256, randomToken,
  randomDigits, verifyPassword, hashPassword, safeEqual, grantActive, HttpError, v, parseCsv,
} from './core.js';
import { tx, uniquePickupCode } from './db.js';
import { sendSms } from './sms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const SESSION_DAYS = 90;           // stays signed in: the #1 complaint about the original
const OTP_TTL_MS = 5 * 60_000;
const RELEASED_VISIBLE_MS = 30 * 60_000;
const RELATIONS = ['father', 'mother', 'driver', 'brother', 'sister', 'grandfather', 'grandmother', 'uncle', 'aunt', 'relative', 'other'];
export const RELATION_AR = {
  father: 'الأب', mother: 'الأم', driver: 'السائق', brother: 'الأخ', sister: 'الأخت', grandfather: 'الجد',
  grandmother: 'الجدة', uncle: 'العم/الخال', aunt: 'العمة/الخالة', relative: 'قريب', other: 'آخر',
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

export function createApp(db, opts = {}) {
  const dev = opts.dev ?? process.env.NODE_ENV !== 'production';
  const now = opts.now ?? (() => Date.now());
  const clock = () => schoolClock(now());
  const log = opts.log ?? ((...a) => console.log(...a));

  // ---------- realtime hub (SSE) ----------
  const channels = new Map(); // channel -> Set<res>
  function subscribe(channel, res) {
    if (!channels.has(channel)) channels.set(channel, new Set());
    channels.get(channel).add(res);
    res.on('close', () => channels.get(channel)?.delete(res));
  }
  function publish(channel, type, data) {
    const set = channels.get(channel);
    if (!set) return;
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(msg);
  }
  const heartbeat = setInterval(() => {
    for (const set of channels.values()) for (const res of set) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  // ---------- rate limiting (in memory, per key) ----------
  const buckets = new Map();
  function limit(key, max, windowMs) {
    const t = now();
    const b = buckets.get(key) ?? { n: 0, reset: t + windowMs };
    if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
    b.n++; buckets.set(key, b);
    if (b.n > max) throw new HttpError(429, 'rate_limited', 'محاولات كثيرة، حاول بعد قليل');
  }

  function audit(actor, action, detail = '') {
    db.prepare('insert into audit (at,actor,action,detail) values (?,?,?,?)').run(now(), actor, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  // ---------- sessions ----------
  function createSession(res, kind, subjectId) {
    const token = randomToken();
    db.prepare('insert into sessions (token_hash,kind,subject_id,expires_at,created_at) values (?,?,?,?,?)')
      .run(sha256(token), kind, subjectId, now() + SESSION_DAYS * 864e5, now());
    setCookie(res, token);
  }
  function setCookie(res, token, maxAge = SESSION_DAYS * 86400) {
    res.setHeader('Set-Cookie', `bb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${dev ? '' : '; Secure'}`);
  }
  function readSession(req) {
    const m = /(?:^|;\s*)bb_session=([^;]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const row = db.prepare('select * from sessions where token_hash = ?').get(sha256(m[1]));
    if (!row || row.expires_at < now()) return null;
    // sliding: using the app keeps you signed in
    if (row.expires_at - now() < (SESSION_DAYS - 1) * 864e5) {
      db.prepare('update sessions set expires_at = ? where token_hash = ?').run(now() + SESSION_DAYS * 864e5, row.token_hash);
    }
    return { ...row, token: m[1] };
  }
  function requireGuardian(req) {
    const s = readSession(req);
    if (!s || s.kind !== 'guardian') throw new HttpError(401, 'auth', 'سجّل الدخول أولاً');
    const g = db.prepare('select * from guardians where id = ?').get(s.subject_id);
    if (!g) throw new HttpError(401, 'auth', 'سجّل الدخول أولاً');
    return g;
  }
  function requireStaff(req, roles = ['admin', 'gate', 'teacher']) {
    const s = readSession(req);
    if (!s || s.kind !== 'staff') throw new HttpError(401, 'auth', 'سجّل الدخول أولاً');
    const st = db.prepare('select * from staff where id = ?').get(s.subject_id);
    if (!st) throw new HttpError(401, 'auth', 'سجّل الدخول أولاً');
    if (!roles.includes(st.role)) throw new HttpError(403, 'forbidden', 'لا تملك صلاحية');
    return st;
  }

  // ---------- domain ----------
  function grantsFor(guardianId) {
    return db.prepare(`select gs.*, s.name student_name, s.grade, s.class_name, s.school_id, s.active,
                              sc.name school_name
                       from guardian_students gs join students s on s.id = gs.student_id
                       join schools sc on sc.id = s.school_id
                       where gs.guardian_id = ? and s.active = 1 order by s.name`).all(guardianId);
  }
  function activePickup(studentId, day) {
    return db.prepare(`select * from pickups where student_id = ? and day = ? and status in ('announced','sent')`).get(studentId, day);
  }
  function lastPickup(studentId, day) {
    return db.prepare(`select * from pickups where student_id = ? and day = ? order by announced_at desc limit 1`).get(studentId, day);
  }
  function pickupView(p) {
    const s = db.prepare('select name, grade, class_name from students where id = ?').get(p.student_id);
    const g = db.prepare('select name, phone from guardians where id = ?').get(p.guardian_id);
    const gs = db.prepare('select relation, role, granted_by from guardian_students where guardian_id = ? and student_id = ?').get(p.guardian_id, p.student_id);
    const grantor = gs?.granted_by ? db.prepare('select name from guardians where id = ?').get(gs.granted_by) : null;
    return {
      id: p.id, status: p.status, method: p.method, car: p.car, distance_m: p.distance_m,
      announced_at: p.announced_at, sent_at: p.sent_at, released_at: p.released_at,
      student: { id: p.student_id, name: s?.name, grade: s?.grade, class_name: s?.class_name },
      guardian: { id: p.guardian_id, name: g?.name, phone: displayPhone(g?.phone), relation: gs?.relation ?? 'other',
        relation_ar: RELATION_AR[gs?.relation] ?? 'آخر', delegate: gs?.role === 'delegate', granted_by: grantor?.name ?? null },
    };
  }
  // Everyone who should hear about this student's pickup: owners + whoever announced.
  function notifyPickup(p, type) {
    const view = pickupView(p);
    publish(`s:${p.school_id}`, type, view);
    const owners = db.prepare(`select guardian_id from guardian_students where student_id = ? and role = 'owner'`).all(p.student_id).map((r) => r.guardian_id);
    for (const gid of new Set([...owners, p.guardian_id])) publish(`g:${gid}`, type, view);
    return view;
  }

  function announceFor(guardian, school, studentIds, { method, distance, car, actor }) {
    const c = clock();
    const eligible = grantsFor(guardian.id).filter((g) => g.school_id === school.id && grantActive(g, c));
    const chosen = studentIds ? eligible.filter((g) => studentIds.includes(g.student_id)) : eligible;
    if (!chosen.length) throw new HttpError(400, 'no_students', 'لا يوجد طلاب مصرّح لك باستلامهم من هذه المدرسة اليوم');
    const created = [], already = [];
    tx(db, () => {
      for (const g of chosen) {
        const live = activePickup(g.student_id, c.day);
        if (live) { already.push(live); continue; }
        const p = { id: id(), school_id: school.id, student_id: g.student_id, guardian_id: guardian.id, day: c.day,
          status: 'announced', method, distance_m: distance ?? null, car: car ?? '', announced_at: now() };
        db.prepare(`insert into pickups (id,school_id,student_id,guardian_id,day,status,method,distance_m,car,announced_at)
                    values (?,?,?,?,?,?,?,?,?,?)`).run(p.id, p.school_id, p.student_id, p.guardian_id, p.day, p.status, p.method, p.distance_m, p.car, p.announced_at);
        created.push(p);
      }
    });
    audit(actor, 'announce', { school: school.id, created: created.map((p) => p.student_id), method });
    return { created: created.map((p) => notifyPickup(p, 'pickup')), already: already.map(pickupView) };
  }

  function transition(staff, pickupId, to) {
    const p = db.prepare('select * from pickups where id = ?').get(pickupId);
    if (!p || p.school_id !== staff.school_id) throw new HttpError(404, 'not_found', 'غير موجود');
    if (staff.role === 'teacher') {
      if (to !== 'sent') throw new HttpError(403, 'forbidden', 'لا تملك صلاحية');
      const s = db.prepare('select class_name from students where id = ?').get(p.student_id);
      if (s.class_name !== staff.class_name) throw new HttpError(403, 'forbidden', 'الطالب ليس في فصلك');
    }
    const allowed = { sent: ['announced'], released: ['announced', 'sent'], cancelled: ['announced', 'sent'] };
    if (!allowed[to].includes(p.status)) {
      if (p.status === to) return pickupView(p); // idempotent double tap
      throw new HttpError(409, 'conflict', 'تم تحديث الحالة مسبقاً');
    }
    const col = to === 'sent' ? 'sent_at' : to === 'released' ? 'released_at' : null;
    db.prepare(`update pickups set status = ?, handled_by = ?${col ? `, ${col} = ?` : ''} where id = ?`)
      .run(...[to, staff.id, ...(col ? [now()] : []), p.id]);
    audit(`staff:${staff.id}`, `pickup_${to}`, p.id);
    return notifyPickup(db.prepare('select * from pickups where id = ?').get(p.id), 'pickup');
  }

  function meView(g) {
    const c = clock();
    const grants = grantsFor(g.id);
    const schools = {};
    for (const gr of grants) {
      if (!schools[gr.school_id]) {
        const s = db.prepare('select id,name,lat,lng,radius_m,dismiss_start,dismiss_end,enforce_window from schools where id = ?').get(gr.school_id);
        schools[s.id] = { ...s, open_now: !s.enforce_window || inWindow(c.hm, s.dismiss_start, s.dismiss_end) };
      }
    }
    const children = grants.map((gr) => {
      const p = lastPickup(gr.student_id, c.day);
      return {
        id: gr.student_id, name: gr.student_name, grade: gr.grade, class_name: gr.class_name, school_id: gr.school_id,
        school_name: gr.school_name, relation: gr.relation, role: gr.role, today: grantActive(gr, c),
        valid_to: gr.valid_to, pickup: p ? pickupView(p) : null,
      };
    });
    const delegates = db.prepare(`select g.id, g.name, g.phone, gs.relation, gs.days, gs.valid_from, gs.valid_to,
                                         group_concat(gs.student_id) student_ids
                                  from guardian_students gs join guardians g on g.id = gs.guardian_id
                                  where gs.granted_by = ? and gs.role = 'delegate' group by g.id order by g.name`).all(g.id)
      .map((d) => ({ ...d, phone: displayPhone(d.phone), relation_ar: RELATION_AR[d.relation], student_ids: d.student_ids.split(',') }));
    return { kind: 'guardian', id: g.id, name: g.name, phone: displayPhone(g.phone), pickup_code: g.pickup_code,
      today: c.day, schools: Object.values(schools), children, delegates };
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

  route('GET', '/api/health', () => ({ ok: true, time: clock(), dev }));

  // Auth: phone OTP for guardians
  route('POST', '/api/auth/otp', async ({ body, ip }) => {
    const phone = normalizeSaudiPhone(body.phone);
    if (!phone) throw new HttpError(400, 'invalid_phone', 'رقم الجوال غير صحيح. مثال: 05XXXXXXXX');
    limit(`otp:ip:${ip}`, 20, 10 * 60_000);
    limit(`otp:phone:${phone}`, 4, 10 * 60_000);
    const g = db.prepare('select id from guardians where phone = ?').get(phone);
    // Same answer whether the number exists or not: no phone-number enumeration.
    let devCode;
    if (g) {
      const code = randomDigits(4);
      db.prepare('insert into otps (phone,code_hash,expires_at,attempts) values (?,?,?,0) on conflict(phone) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0')
        .run(phone, sha256(code), now() + OTP_TTL_MS);
      await sendSms(phone, `رمز الدخول إلى بالباب: ${code}`);
      if (dev) devCode = code;
    }
    return { sent: true, ...(devCode ? { dev_code: devCode } : {}) };
  });

  route('POST', '/api/auth/verify', ({ body, res, ip }) => {
    const phone = normalizeSaudiPhone(body.phone);
    const code = String(body.code ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    limit(`verify:ip:${ip}`, 30, 10 * 60_000);
    const row = phone && db.prepare('select * from otps where phone = ?').get(phone);
    if (!row || row.expires_at < now() || row.attempts >= 5) throw new HttpError(400, 'bad_code', 'الرمز غير صحيح أو انتهت صلاحيته');
    if (!safeEqual(sha256(code), row.code_hash)) {
      db.prepare('update otps set attempts = attempts + 1 where phone = ?').run(phone);
      throw new HttpError(400, 'bad_code', 'الرمز غير صحيح أو انتهت صلاحيته');
    }
    db.prepare('delete from otps where phone = ?').run(phone);
    const g = db.prepare('select * from guardians where phone = ?').get(phone);
    createSession(res, 'guardian', g.id);
    audit(`guardian:${g.id}`, 'login');
    return meView(g);
  });

  route('POST', '/api/staff/login', ({ body, res, ip }) => {
    limit(`staff:ip:${ip}`, 20, 10 * 60_000);
    const username = v.str(body.username, 'اسم المستخدم', { max: 60 }).toLowerCase();
    const st = db.prepare('select * from staff where username = ?').get(username);
    if (!st || !verifyPassword(String(body.password ?? ''), st.pass_hash)) throw new HttpError(400, 'bad_login', 'بيانات الدخول غير صحيحة');
    createSession(res, 'staff', st.id);
    audit(`staff:${st.id}`, 'login');
    return staffView(st);
  });

  route('POST', '/api/logout', ({ req, res }) => {
    const s = readSession(req);
    if (s) db.prepare('delete from sessions where token_hash = ?').run(s.token_hash);
    setCookie(res, '', 0);
    return { ok: true };
  });

  function staffView(st) {
    const sc = db.prepare('select id,name,lat,lng,radius_m,dismiss_start,dismiss_end,enforce_window,display_key from schools where id = ?').get(st.school_id);
    const gates = db.prepare('select id,name from gates where school_id = ?').all(st.school_id);
    return { kind: 'staff', id: st.id, name: st.name, role: st.role, class_name: st.class_name,
      school: st.role === 'admin' ? sc : { ...sc, display_key: undefined }, gates };
  }

  route('GET', '/api/me', ({ req }) => {
    const s = readSession(req);
    if (!s) return { kind: 'anonymous' }; // not an error: keeps the console clean on the login screen
    if (s.kind === 'guardian') return meView(requireGuardian(req));
    return staffView(requireStaff(req));
  });

  // Guardian: I'm at the gate
  route('POST', '/api/announce', ({ req, body }) => {
    const g = requireGuardian(req);
    limit(`announce:${g.id}`, 30, 60 * 60_000);
    const lat = v.num(body.lat, 'الموقع', { min: -90, max: 90 });
    const lng = v.num(body.lng, 'الموقع', { min: -180, max: 180 });
    const accuracy = v.num(body.accuracy, 'الدقة', { min: 0, max: 100000, optional: true });
    const studentIds = v.ids(body.student_ids, 'الطلاب');
    const car = v.str(body.car, 'السيارة', { optional: true, max: 60 });
    const c = clock();
    const schoolIds = [...new Set(grantsFor(g.id).filter((x) => grantActive(x, c)).map((x) => x.school_id))];
    if (!schoolIds.length) throw new HttpError(400, 'no_students', 'لا يوجد طلاب مصرّح لك باستلامهم اليوم');
    let best = null;
    for (const sid of schoolIds) {
      const sc = db.prepare('select * from schools where id = ?').get(sid);
      const f = insideGeofence(sc, lat, lng, accuracy);
      if (!best || f.distance < best.f.distance) best = { sc, f };
    }
    if (!best.f.inside) {
      throw new HttpError(400, 'outside', `أنت على بعد ${best.f.distance} م من ${best.sc.name}. اقترب من المدرسة (أقل من ${best.sc.radius_m} م).`);
    }
    if (best.sc.enforce_window && !inWindow(c.hm, best.sc.dismiss_start, best.sc.dismiss_end)) {
      throw new HttpError(400, 'closed', `النداء متاح من ${best.sc.dismiss_start} إلى ${best.sc.dismiss_end}`);
    }
    return announceFor(g, best.sc, studentIds, { method: body.auto ? 'auto' : 'geofence', distance: best.f.distance, car, actor: `guardian:${g.id}` });
  });

  route('POST', '/api/pickups/:id/cancel', ({ req, params }) => {
    const g = requireGuardian(req);
    const p = db.prepare('select * from pickups where id = ?').get(params.id);
    if (!p) throw new HttpError(404, 'not_found', 'غير موجود');
    const isOwner = db.prepare(`select 1 from guardian_students where guardian_id = ? and student_id = ? and role = 'owner'`).get(g.id, p.student_id);
    if (p.guardian_id !== g.id && !isOwner) throw new HttpError(403, 'forbidden', 'لا تملك صلاحية');
    if (!['announced', 'sent'].includes(p.status)) throw new HttpError(409, 'conflict', 'لا يمكن الإلغاء الآن');
    db.prepare(`update pickups set status = 'cancelled', handled_by = ? where id = ?`).run(`guardian:${g.id}`, p.id);
    audit(`guardian:${g.id}`, 'pickup_cancelled', p.id);
    return notifyPickup(db.prepare('select * from pickups where id = ?').get(p.id), 'pickup');
  });

  // Guardian: authorise a driver / relative, in one form
  route('POST', '/api/delegates', ({ req, body }) => {
    const g = requireGuardian(req);
    limit(`delegate:${g.id}`, 30, 60 * 60_000);
    const name = v.str(body.name, 'الاسم', { max: 80 });
    const phone = normalizeSaudiPhone(body.phone);
    if (!phone) throw new HttpError(400, 'invalid_phone', 'رقم الجوال غير صحيح. مثال: 05XXXXXXXX');
    if (phone === g.phone) throw new HttpError(400, 'self', 'لا يمكنك تفويض نفسك');
    const relation = v.oneOf(body.relation, 'صلة القرابة', RELATIONS);
    const studentIds = v.ids(body.student_ids, 'الطلاب', { optional: false });
    const scope = v.oneOf(body.scope ?? 'always', 'المدة', ['today', 'range', 'always']);
    const c = clock();
    let from = null, to = null, days = '0123456';
    if (scope === 'today') { from = c.day; to = c.day; }
    if (scope === 'range') {
      from = v.date(body.valid_from, 'من', { optional: false }); to = v.date(body.valid_to, 'إلى', { optional: false });
      if (to < from) throw new HttpError(400, 'invalid', 'تاريخ النهاية قبل البداية');
    }
    if (body.days != null) {
      days = String(body.days).replace(/[^0-6]/g, '');
      if (!days) throw new HttpError(400, 'invalid', 'اختر يوماً واحداً على الأقل');
    }
    const owned = new Set(db.prepare(`select student_id from guardian_students where guardian_id = ? and role = 'owner'`).all(g.id).map((r) => r.student_id));
    if (!studentIds.length || !studentIds.every((s) => owned.has(s))) throw new HttpError(403, 'forbidden', 'يمكنك تفويض أبنائك فقط');
    const result = tx(db, () => {
      let d = db.prepare('select * from guardians where phone = ?').get(phone);
      if (!d) {
        d = { id: id(), phone, name, pickup_code: uniquePickupCode(db) };
        db.prepare('insert into guardians (id,phone,name,pickup_code,created_at) values (?,?,?,?,?)').run(d.id, d.phone, d.name, d.pickup_code, now());
      }
      for (const sid of studentIds) {
        const existing = db.prepare('select role from guardian_students where guardian_id = ? and student_id = ?').get(d.id, sid);
        if (existing?.role === 'owner') continue; // the other parent is already an owner
        db.prepare(`insert into guardian_students (guardian_id,student_id,relation,role,granted_by,days,valid_from,valid_to,created_at)
                    values (?,?,?,'delegate',?,?,?,?,?)
                    on conflict(guardian_id,student_id) do update set relation=excluded.relation, granted_by=excluded.granted_by,
                    days=excluded.days, valid_from=excluded.valid_from, valid_to=excluded.valid_to`)
          .run(d.id, sid, relation, g.id, days, from, to, now());
      }
      return d;
    });
    audit(`guardian:${g.id}`, 'delegate_add', { delegate: result.id, studentIds, scope });
    sendSms(phone, `${g.name} فوّضك لاستلام الطلاب عبر تطبيق بالباب. ادخل برقم جوالك.`).catch(() => {});
    return meView(g);
  });

  route('DELETE', '/api/delegates/:id', ({ req, params }) => {
    const g = requireGuardian(req);
    const owned = db.prepare(`select student_id from guardian_students where guardian_id = ? and role = 'owner'`).all(g.id).map((r) => r.student_id);
    if (owned.length) {
      db.prepare(`delete from guardian_students where guardian_id = ? and role = 'delegate' and student_id in (${owned.map(() => '?').join(',')})`).run(params.id, ...owned);
    }
    audit(`guardian:${g.id}`, 'delegate_remove', params.id);
    return meView(g);
  });

  // Staff: live queue
  route('GET', '/api/school/queue', ({ req }) => {
    const st = requireStaff(req);
    const c = clock();
    const rows = db.prepare(`select * from pickups where school_id = ? and day = ?
                             and (status in ('announced','sent') or (status = 'released' and released_at > ?))
                             order by announced_at`).all(st.school_id, c.day, now() - RELEASED_VISIBLE_MS);
    let list = rows.map(pickupView);
    if (st.role === 'teacher') list = list.filter((p) => p.student.class_name === st.class_name);
    const stats = db.prepare(`select status, count(*) n from pickups where school_id = ? and day = ? group by status`).all(st.school_id, c.day);
    return { day: c.day, pickups: list, stats: Object.fromEntries(stats.map((s) => [s.status, s.n])) };
  });

  route('POST', '/api/school/pickups/:id/sent', ({ req, params }) => transition(requireStaff(req), params.id, 'sent'));
  route('POST', '/api/school/pickups/:id/release', ({ req, params }) => transition(requireStaff(req, ['admin', 'gate']), params.id, 'released'));
  route('POST', '/api/school/pickups/:id/cancel', ({ req, params }) => transition(requireStaff(req, ['admin', 'gate']), params.id, 'cancelled'));

  // Staff: parent without a phone / no signal reads out their 6-digit pickup code
  route('POST', '/api/school/manual', ({ req, body }) => {
    const st = requireStaff(req, ['admin', 'gate']);
    const code = String(body.code ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'invalid', 'رمز الاستلام 6 أرقام');
    const g = db.prepare('select * from guardians where pickup_code = ?').get(code);
    if (!g) throw new HttpError(404, 'not_found', 'رمز غير معروف');
    const sc = db.prepare('select * from schools where id = ?').get(st.school_id);
    return announceFor(g, sc, null, { method: 'staff', car: v.str(body.car, 'السيارة', { optional: true, max: 60 }), actor: `staff:${st.id}` });
  });

  route('GET', '/api/school/students', ({ req, query }) => {
    const st = requireStaff(req);
    const q = `%${String(query.get('q') ?? '').trim().slice(0, 40)}%`;
    return db.prepare(`select id,name,grade,class_name,noor_id from students where school_id = ? and active = 1 and (name like ? or noor_id like ? or class_name like ?) order by class_name, name limit 200`)
      .all(st.school_id, q, q, q).map((s) => ({
        ...s,
        guardians: db.prepare(`select g.name, g.phone, gs.relation, gs.role from guardian_students gs join guardians g on g.id = gs.guardian_id where gs.student_id = ?`).all(s.id)
          .map((x) => ({ ...x, phone: displayPhone(x.phone), relation_ar: RELATION_AR[x.relation] })),
      }));
  });

  // Admin
  route('PUT', '/api/admin/school', ({ req, body }) => {
    const st = requireStaff(req, ['admin']);
    const lat = v.num(body.lat, 'خط العرض', { min: 16, max: 33 });       // Saudi bounding box
    const lng = v.num(body.lng, 'خط الطول', { min: 34, max: 56 });
    const radius = v.num(body.radius_m, 'نصف القطر', { min: 50, max: 2000 });
    const start = v.hm(body.dismiss_start, 'بداية الانصراف');
    const end = v.hm(body.dismiss_end, 'نهاية الانصراف');
    const name = v.str(body.name, 'اسم المدرسة', { max: 120 });
    db.prepare('update schools set name=?, lat=?, lng=?, radius_m=?, dismiss_start=?, dismiss_end=?, enforce_window=? where id=?')
      .run(name, lat, lng, Math.round(radius), start, end, body.enforce_window ? 1 : 0, st.school_id);
    audit(`staff:${st.id}`, 'school_update');
    return staffView(st);
  });

  // CSV: student_name, grade, class, noor_id, guardian_name, guardian_phone, relation
  route('POST', '/api/admin/import', ({ req, body }) => {
    const st = requireStaff(req, ['admin']);
    const rows = parseCsv(v.str(body.csv, 'الملف', { max: 2_000_000 }));
    if (rows.length && /name|اسم/i.test(rows[0][0])) rows.shift();
    const report = { students: 0, guardians: 0, links: 0, errors: [] };
    tx(db, () => {
      rows.forEach((r, i) => {
        const [sname, grade = '', cls = '', noor = '', gname = '', gphone = '', rel = 'father'] = r;
        if (!sname) return report.errors.push({ row: i + 1, error: 'اسم الطالب فارغ' });
        let s = noor ? db.prepare('select * from students where school_id = ? and noor_id = ?').get(st.school_id, noor) : null;
        if (!s) s = db.prepare('select * from students where school_id = ? and name = ? and class_name = ?').get(st.school_id, sname, cls);
        if (!s) {
          s = { id: id() };
          db.prepare('insert into students (id,school_id,name,grade,class_name,noor_id,created_at) values (?,?,?,?,?,?,?)').run(s.id, st.school_id, sname, grade, cls, noor || null, now());
          report.students++;
        }
        if (!gphone) return;
        const phone = normalizeSaudiPhone(gphone);
        if (!phone) return report.errors.push({ row: i + 1, error: `جوال غير صحيح: ${gphone}` });
        let g = db.prepare('select * from guardians where phone = ?').get(phone);
        if (!g) {
          g = { id: id() };
          db.prepare('insert into guardians (id,phone,name,pickup_code,created_at) values (?,?,?,?,?)').run(g.id, phone, gname || 'ولي أمر', uniquePickupCode(db), now());
          report.guardians++;
        }
        const relation = RELATIONS.includes(rel) ? rel : (Object.entries(RELATION_AR).find(([, ar]) => ar.includes(rel))?.[0] ?? 'other');
        const r2 = db.prepare(`insert into guardian_students (guardian_id,student_id,relation,role,created_at) values (?,?,?,'owner',?)
                               on conflict(guardian_id,student_id) do update set role='owner', relation=excluded.relation, granted_by=null, valid_from=null, valid_to=null, days='0123456'`)
          .run(g.id, s.id, relation, now());
        report.links += Number(r2.changes);
      });
    });
    audit(`staff:${st.id}`, 'import', report);
    return report;
  });

  route('GET', '/api/admin/staff', ({ req }) => {
    const st = requireStaff(req, ['admin']);
    return db.prepare('select id,name,username,role,class_name from staff where school_id = ? order by role, name').all(st.school_id);
  });
  route('POST', '/api/admin/staff', ({ req, body }) => {
    const st = requireStaff(req, ['admin']);
    const name = v.str(body.name, 'الاسم', { max: 80 });
    const username = v.str(body.username, 'اسم المستخدم', { max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'invalid', 'اسم المستخدم: حروف إنجليزية وأرقام فقط');
    const password = v.str(body.password, 'كلمة المرور', { min: 8, max: 100 });
    const role = v.oneOf(body.role, 'الدور', ['admin', 'gate', 'teacher']);
    const cls = role === 'teacher' ? v.str(body.class_name, 'الفصل', { max: 20 }) : null;
    if (db.prepare('select 1 from staff where username = ?').get(username)) throw new HttpError(409, 'conflict', 'اسم المستخدم مستخدم');
    db.prepare('insert into staff (id,school_id,name,username,pass_hash,role,class_name,created_at) values (?,?,?,?,?,?,?,?)')
      .run(id(), st.school_id, name, username, hashPassword(password), role, cls, now());
    audit(`staff:${st.id}`, 'staff_add', username);
    return { ok: true };
  });

  route('GET', '/api/admin/report', ({ req, query }) => {
    const st = requireStaff(req, ['admin']);
    const day = v.date(query.get('day'), 'اليوم') ?? clock().day;
    const rows = db.prepare(`select * from pickups where school_id = ? and day = ? order by announced_at`).all(st.school_id, day).map(pickupView);
    const done = rows.filter((r) => r.released_at);
    const waits = done.map((r) => (r.released_at - r.announced_at) / 1000).sort((a, b) => a - b);
    return { day, total: rows.length, released: done.length, median_wait_s: waits.length ? Math.round(waits[Math.floor(waits.length / 2)]) : null, rows };
  });

  // ---------- server ----------
  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 2_500_000) throw new HttpError(413, 'too_large', 'الملف كبير جداً'); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'طلب غير صالح'); }
  }

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  }

  function serveStatic(req, res, pathname) {
    let p = decodeURIComponent(pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        if (!path.extname(p)) { res.writeHead(302, { Location: pathname + '/' }).end(); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('غير موجود'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': path.extname(file) === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
      fs.createReadStream(file).pipe(res);
    });
  }

  function sse(req, res, channels_) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    for (const ch of channels_) subscribe(ch, res);
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://local');
    const ip = (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress;
    try {
      if (url.pathname === '/api/events') {
        const s = readSession(req);
        if (!s) throw new HttpError(401, 'auth', 'سجّل الدخول أولاً');
        if (s.kind === 'guardian') return sse(req, res, [`g:${s.subject_id}`]);
        const st = requireStaff(req);
        return sse(req, res, [`s:${st.school_id}`]);
      }
      const disp = /^\/api\/display\/([^/]+)\/(events|queue)$/.exec(url.pathname);
      if (disp) {
        const sc = db.prepare('select * from schools where id = ?').get(disp[1]);
        if (!sc || !safeEqual(url.searchParams.get('key') ?? '', sc.display_key)) throw new HttpError(403, 'forbidden', 'مفتاح الشاشة غير صحيح');
        if (disp[2] === 'events') return sse(req, res, [`s:${sc.id}`]);
        const rows = db.prepare(`select * from pickups where school_id = ? and day = ? and status in ('announced','sent') order by announced_at`).all(sc.id, clock().day);
        // The hall screen shows only what's needed: name, class, who's at the gate. No phone numbers.
        return json(res, 200, { school: sc.name, pickups: rows.map(pickupView).map((p) => ({ ...p, guardian: { name: p.guardian.name, relation_ar: p.guardian.relation_ar } })) });
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') {
          // CSRF: same-origin JSON only
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'csrf', 'طلب مرفوض');
          if (req.method !== 'DELETE' && !String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'json_only', 'طلب غير صالح');
        }
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          const body = req.method === 'GET' ? {} : await readBody(req);
          const out = await r.handler({ req, res, body, params: m.groups ?? {}, query: url.searchParams, ip });
          return json(res, 200, out);
        }
        throw new HttpError(404, 'not_found', 'غير موجود');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'غير مسموح');
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.code, message: e.message });
      if (String(e.message).includes('UNIQUE constraint failed: pickups')) return json(res, 409, { error: 'conflict', message: 'تم النداء مسبقاً' });
      log('error', e);
      return json(res, 500, { error: 'server', message: 'حدث خطأ، حاول مرة أخرى' });
    }
  });

  function json(res, status, body) {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  server.on('close', () => clearInterval(heartbeat));
  return server;
}
