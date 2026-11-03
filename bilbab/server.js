import { openDb, seed } from './lib/db.js';
import { createApp } from './lib/app.js';

const port = Number(process.env.PORT || 3000);
const db = openDb(process.env.DB_PATH || 'data/bilbab.db');
const seeded = process.env.SEED === '0' ? null : seed(db);
const server = createApp(db, { trustProxy: process.env.TRUST_PROXY === '1' });
server.listen(port, () => {
  console.log(`بالباب يعمل على http://localhost:${port}`);
  if (seeded) {
    console.log(`  بيانات تجريبية: جوالات أولياء الأمور 0500000001..0500000005`);
    console.log(`  الموظفون: admin / gate / teacher3a / teacher1b  كلمة المرور: ${seeded.staffPassword}`);
    console.log(`  شاشة النداء: http://localhost:${port}/display/?school=${seeded.school.id}&key=${seeded.displayKey}`);
  }
});
