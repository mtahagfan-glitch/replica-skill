-- Bilbab schema (SQLite for dev / single school; same shape ports to Postgres).
-- Times are epoch milliseconds (UTC). "day" is the school-local date (Asia/Riyadh, UTC+3, no DST).
pragma foreign_keys = on;
pragma journal_mode = wal;

create table if not exists schools (
  id text primary key,
  name text not null,
  lat real not null,
  lng real not null,
  radius_m integer not null default 250 check (radius_m between 50 and 2000),
  dismiss_start text not null default '11:30',   -- HH:MM school-local
  dismiss_end text not null default '14:30',
  enforce_window integer not null default 1,
  display_key text not null,                     -- for the hall TV, no login
  created_at integer not null
);

create table if not exists gates (
  id text primary key,
  school_id text not null references schools(id) on delete cascade,
  name text not null
);
create index if not exists gates_school on gates(school_id);

create table if not exists students (
  id text primary key,
  school_id text not null references schools(id) on delete cascade,
  name text not null,
  grade text not null default '',
  class_name text not null default '',
  noor_id text,                                  -- رقم الهوية/السجل في نور (optional)
  active integer not null default 1,
  created_at integer not null
);
create index if not exists students_school on students(school_id, class_name);
create unique index if not exists students_noor on students(school_id, noor_id) where noor_id is not null;

create table if not exists guardians (
  id text primary key,
  phone text not null unique,                    -- E.164 without +, e.g. 9665XXXXXXXX
  name text not null,
  pickup_code text not null unique,              -- 6 digits, fallback at the gate
  created_at integer not null
);

-- Who may pick up whom. role=owner: parent/legal guardian. role=delegate: driver, relative...
create table if not exists guardian_students (
  guardian_id text not null references guardians(id) on delete cascade,
  student_id text not null references students(id) on delete cascade,
  relation text not null,                        -- father, mother, driver, brother, grandfather...
  role text not null check (role in ('owner','delegate')),
  granted_by text references guardians(id) on delete cascade,
  days text not null default '0123456',          -- JS weekday digits, 0 = Sunday
  valid_from text,                               -- YYYY-MM-DD, null = open
  valid_to text,
  created_at integer not null,
  primary key (guardian_id, student_id)
);
create index if not exists gs_student on guardian_students(student_id);

create table if not exists staff (
  id text primary key,
  school_id text not null references schools(id) on delete cascade,
  name text not null,
  username text not null unique,
  pass_hash text not null,
  role text not null check (role in ('admin','gate','teacher')),
  class_name text,                               -- teachers: which class they release
  created_at integer not null
);

create table if not exists sessions (
  token_hash text primary key,
  kind text not null check (kind in ('guardian','staff')),
  subject_id text not null,
  expires_at integer not null,
  created_at integer not null
);
create index if not exists sessions_subject on sessions(kind, subject_id);

create table if not exists otps (
  phone text primary key,
  code_hash text not null,
  expires_at integer not null,
  attempts integer not null default 0
);

create table if not exists pickups (
  id text primary key,
  school_id text not null references schools(id) on delete cascade,
  student_id text not null references students(id) on delete cascade,
  guardian_id text not null references guardians(id) on delete cascade,
  day text not null,
  status text not null check (status in ('announced','sent','released','cancelled')),
  method text not null check (method in ('geofence','auto','staff')),
  distance_m integer,
  car text not null default '',
  announced_at integer not null,
  sent_at integer,
  released_at integer,
  handled_by text
);
-- One live call per student per day: a double tap, or mother and driver both announcing, can't duplicate it.
create unique index if not exists pickups_one_active on pickups(student_id, day) where status in ('announced','sent');
create index if not exists pickups_school_day on pickups(school_id, day, status);

create table if not exists audit (
  id integer primary key autoincrement,
  at integer not null,
  actor text not null,
  action text not null,
  detail text not null default ''
);
