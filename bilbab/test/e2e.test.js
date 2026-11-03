// Full flow in real browsers: father (phone), gate supervisor (tablet), hall TV.
// Uses the preinstalled Playwright. Screenshots go to test-results/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { openDb, seed } from '../lib/db.js';
import { createApp } from '../lib/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const OUT = 'test-results';
const SCHOOL = { latitude: 24.7136, longitude: 46.6753 };
let server, base, browser, seeded, db;
const consoleErrors = [];

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  db = openDb(':memory:');
  seeded = seed(db);
  db.prepare('update schools set enforce_window = 0').run(); // run at any hour
  server = createApp(db, { dev: true, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.closeAllConnections?.(); server.close(); });

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR_FAILED/.test(m.text())) consoleErrors.push(`${label}: ${m.text()}`); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) consoleErrors.push(`${label}: failed ${r.url()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) consoleErrors.push(`${label}: ${r.status()} ${r.url()}`); });
  // offline container: don't wait on Google Fonts
  page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}

async function staffPage(path, username, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ar-SA' });
  const page = await ctx.newPage(); watch(page, username);
  await page.goto(base + path);
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByLabel('كلمة المرور').fill(seeded.staffPassword);
  await page.getByRole('button', { name: 'دخول' }).click();
  return page;
}

test('father taps «وصلت» → gate + hall TV see it live → gate releases → father sees «تم التسليم»', async () => {
  const gate = await staffPage('/gate/', 'gate');
  await gate.getByRole('heading', { name: 'النداء المباشر' }).waitFor();

  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
  watch(tv, 'tv');
  await tv.goto(`${base}/display/?school=sch_demo&key=${seeded.displayKey}`);
  await tv.getByText('لا يوجد نداء حالياً').waitFor();

  // Father on an iPhone, standing ~45 m from the gate, location "while using" only.
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar-SA', geolocation: { ...SCHOOL, latitude: SCHOOL.latitude + 0.0004, accuracy: 10 }, permissions: ['geolocation'] });
  const phone = await phoneCtx.newPage(); watch(phone, 'father');
  await phone.goto(base + '/parent/');
  await shot(phone, '01-parent-login');
  await phone.getByLabel('رقم الجوال').fill('0500000001');
  await phone.getByRole('button', { name: 'أرسل رمز التحقق' }).click();
  const hint = await phone.getByText(/وضع التجربة: الرمز/).textContent();
  await phone.getByLabel('الرمز').fill(hint.match(/\d{4}/)[0]); // auto-submits at 4 digits

  const arrive = phone.locator('#arrive');
  await arrive.waitFor();
  await phone.getByRole('button', { name: 'فعّل الموقع' }).click().catch(() => {}); // first run: one tap to allow location
  await assert.doesNotReject(phone.waitForFunction(() => document.querySelector('#arrive')?.classList.contains('ready'), null, { timeout: 5000 }));
  await shot(phone, '02-parent-ready');
  await arrive.click();
  await phone.getByText('تم! المدرسة تنادي أبناءك الآن').waitFor();

  // School side, live, no refresh
  const saraCard = gate.locator('article.pk', { hasText: 'سارة خالد العتيبي' });
  await saraCard.waitFor({ timeout: 5000 });
  await gate.locator('article.pk', { hasText: 'عبدالله خالد العتيبي' }).waitFor();
  assert.match(await saraCard.textContent(), /الأب: خالد العتيبي/);
  await tv.getByText('سارة خالد العتيبي').waitFor({ timeout: 5000 });
  await shot(gate, '03-gate-queue');
  await shot(tv, '04-hall-display');

  // Teacher of 3/أ sends Sara out
  const teacher = await staffPage('/teacher/', 'teacher3a', { width: 820, height: 1000 });
  const tCard = teacher.locator('article.pk', { hasText: 'سارة' });
  await tCard.waitFor();
  assert.equal(await teacher.locator('article.pk', { hasText: 'عبدالله' }).count(), 0, 'teacher sees only her class');
  await tCard.getByRole('button', { name: 'أرسلته للبوابة' }).click();
  await phone.getByText('في الطريق إلى البوابة').first().waitFor({ timeout: 5000 });
  await shot(teacher, '05-teacher');

  // Gate hands Sara over
  await saraCard.getByRole('button', { name: 'تم التسليم' }).click();
  await phone.locator('.kid', { hasText: 'سارة' }).getByText('تم التسليم').waitFor({ timeout: 5000 });
  await phone.getByText(/تم تسليم سارة إليك/).waitFor();
  await shot(phone, '06-parent-released');
  await tv.waitForFunction(() => !document.body.innerText.includes('سارة خالد العتيبي'), null, { timeout: 5000 });

  // Delegation in one form
  await phone.getByRole('button', { name: 'التفويض' }).click();
  await phone.getByLabel('الاسم').fill('رحمت الله');
  await phone.getByLabel('رقم الجوال').fill('0566666666');
  await phone.getByLabel('الصلة').selectOption('driver');
  await phone.getByRole('button', { name: 'فوّض', exact: true }).click();
  await phone.getByText('تم التفويض وأرسلنا له رسالة').waitFor();
  await phone.getByText('رحمت الله').waitFor();
  await shot(phone, '07-parent-delegate');

  await phone.getByRole('button', { name: 'حسابي' }).click();
  assert.match(await phone.locator('#pickup-code').textContent(), /^\d{6}$/);
  await shot(phone, '08-parent-account');

  // Stays signed in: a fresh load goes straight to the button
  await phone.reload();
  await phone.locator('#arrive').waitFor();

  const admin = await staffPage('/admin/', 'admin');
  await admin.getByRole('heading', { name: 'المدرسة ونطاق النداء' }).waitFor();
  await admin.getByText(/تقرير اليوم/).waitFor();
  await shot(admin, '09-admin');

  assert.deepEqual(consoleErrors, []);
});

test('parent screen works at 320px and with dark mode, no horizontal scroll', async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, colorScheme: 'dark', geolocation: { latitude: 24.80, longitude: 46.70 }, permissions: ['geolocation'] });
  await ctx.addCookies([]);
  const p = await ctx.newPage(); watch(p, 'small');
  await p.goto(base + '/parent/');
  await p.getByLabel('رقم الجوال').fill('٠٥٠٠٠٠٠٠٠٣'); // Arabic digits
  await p.getByRole('button', { name: 'أرسل رمز التحقق' }).click();
  const hint = await p.getByText(/وضع التجربة: الرمز/).textContent();
  await p.getByLabel('الرمز').fill(hint.match(/\d{4}/)[0]);
  await p.locator('#arrive').waitFor();
  await p.getByRole('button', { name: 'فعّل الموقع' }).click().catch(() => {});
  await p.getByText(/تبعد .* كم/).waitFor({ timeout: 5000 }); // far away: button disabled with distance
  assert.equal(await p.locator('#arrive').isDisabled(), true);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false);
  await p.screenshot({ path: `${OUT}/10-parent-far-dark-320.png` });
  assert.deepEqual(consoleErrors, []);
});
