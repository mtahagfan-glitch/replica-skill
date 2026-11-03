import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { id, hashPassword, randomDigits, randomToken } from './core.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));
  return db;
}

export function tx(db, fn) {
  db.exec('begin immediate');
  try { const r = fn(); db.exec('commit'); return r; }
  catch (e) { db.exec('rollback'); throw e; }
}

export function uniquePickupCode(db) {
  for (;;) {
    const c = randomDigits(6);
    if (c[0] !== '0' && !db.prepare('select 1 from guardians where pickup_code = ?').get(c)) return c;
  }
}

// Demo data: a Riyadh school with fake names (no real people). Only runs on an empty database.
export function seed(db) {
  if (db.prepare('select count(*) n from schools').get().n > 0) return null;
  const now = Date.now();
  const school = { id: 'sch_demo', name: 'مدرسة الرواد الأهلية (تجريبية)', lat: 24.7136, lng: 46.6753 };
  const displayKey = process.env.DEMO_DISPLAY_KEY || randomToken().slice(0, 16);
  db.prepare(`insert into schools (id,name,lat,lng,radius_m,dismiss_start,dismiss_end,enforce_window,display_key,created_at)
              values (?,?,?,?,?,?,?,?,?,?)`).run(school.id, school.name, school.lat, school.lng, 250, '11:30', '14:30', 1, displayKey, now);
  db.prepare('insert into gates (id,school_id,name) values (?,?,?)').run('gate_1', school.id, 'البوابة الرئيسية');
  db.prepare('insert into gates (id,school_id,name) values (?,?,?)').run('gate_2', school.id, 'بوابة الصفوف الأولية');

  const st = db.prepare('insert into students (id,school_id,name,grade,class_name,noor_id,created_at) values (?,?,?,?,?,?,?)');
  const kids = [
    ['stu_1', 'سارة خالد العتيبي', 'الثالث', '3/أ'],
    ['stu_2', 'عبدالله خالد العتيبي', 'الأول', '1/ب'],
    ['stu_3', 'ريم فهد القحطاني', 'الثالث', '3/أ'],
    ['stu_4', 'محمد سلطان الشهري', 'الخامس', '5/أ'],
    ['stu_5', 'لين ماجد الدوسري', 'الأول', '1/ب'],
    ['stu_6', 'فيصل ماجد الدوسري', 'الخامس', '5/أ'],
  ];
  kids.forEach(([sid, n, g, c], i) => st.run(sid, school.id, n, g, c, `10${String(i + 1).padStart(8, '0')}`, now));

  const gu = db.prepare('insert into guardians (id,phone,name,pickup_code,created_at) values (?,?,?,?,?)');
  const link = db.prepare('insert into guardian_students (guardian_id,student_id,relation,role,created_at) values (?,?,?,?,?)');
  const parents = [
    ['gua_1', '966500000001', 'خالد العتيبي', 'father', ['stu_1', 'stu_2']],
    ['gua_2', '966500000002', 'نورة العتيبي', 'mother', ['stu_1', 'stu_2']],
    ['gua_3', '966500000003', 'فهد القحطاني', 'father', ['stu_3']],
    ['gua_4', '966500000004', 'سلطان الشهري', 'father', ['stu_4']],
    ['gua_5', '966500000005', 'ماجد الدوسري', 'father', ['stu_5', 'stu_6']],
  ];
  for (const [gid, phone, n, rel, ks] of parents) {
    gu.run(gid, phone, n, uniquePickupCode(db), now);
    ks.forEach((k) => link.run(gid, k, rel, 'owner', now));
  }

  const sf = db.prepare('insert into staff (id,school_id,name,username,pass_hash,role,class_name,created_at) values (?,?,?,?,?,?,?,?)');
  const pw = process.env.DEMO_STAFF_PASSWORD || 'demo1234';
  sf.run(id(), school.id, 'مديرة المدرسة', 'admin', hashPassword(pw), 'admin', null, now);
  sf.run(id(), school.id, 'مشرفة البوابة', 'gate', hashPassword(pw), 'gate', null, now);
  sf.run(id(), school.id, 'معلمة 3/أ', 'teacher3a', hashPassword(pw), 'teacher', '3/أ', now);
  sf.run(id(), school.id, 'معلمة 1/ب', 'teacher1b', hashPassword(pw), 'teacher', '1/ب', now);
  return { school, displayKey, staffPassword: pw };
}
