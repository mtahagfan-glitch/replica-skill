# Architecture

**الآن (MVP):** Node.js 22 بدون أي مكتبة خارجية (`node:http`، `node:sqlite`)، Server-Sent Events للوقت الحقيقي، واجهات PWA بـ JavaScript خالص. يعمل على أي VPS بأمر واحد `npm start`. مناسب لمدرسة أو عدة مدارس.

**للإنتاج على مستوى مدن:**

| الطبقة | الآن | الإنتاج |
| --- | --- | --- |
| قاعدة البيانات | SQLite | Postgres (نفس المخطط) |
| الوقت الحقيقي | SSE داخل العملية | SSE + Redis pub/sub عند تعدد الخوادم |
| تطبيق الجوال | PWA | Expo (React Native) لإشعارات APNs/FCM والتطبيق مغلق + CarPlay |
| SMS | محوّل Taqnyat / Unifonic | نفسه، مع اسم مرسل مسجّل لدى هيئة الاتصالات |
| الاستضافة | أي VPS | داخل السعودية (STC Cloud، Oracle جدة، Google دمام) لنظام حماية البيانات الشخصية |

## API

| method path | من | الغرض |
| --- | --- | --- |
| POST /api/auth/otp, /api/auth/verify | ولي أمر | دخول بالجوال |
| POST /api/staff/login | موظف | دخول |
| GET /api/me | الكل | الملف + الأبناء + الحالة اليوم |
| POST /api/announce | ولي أمر | «وصلت» (يتحقق من النطاق والوقت والصلاحية) |
| POST /api/pickups/:id/cancel | ولي أمر | إلغاء |
| POST/DELETE /api/delegates | ولي أمر (owner) | تفويض/إلغاء |
| GET /api/events | الكل | SSE: قناة ولي الأمر / قناة المدرسة |
| GET /api/school/queue | موظف | الطابور |
| POST /api/school/pickups/:id/{sent,release,cancel} | معلمة (sent لفصلها) / بوابة | الانتقالات |
| POST /api/school/manual | بوابة | نداء برمز الاستلام |
| GET /api/display/:school/{queue,events}?key | شاشة | بدون أرقام جوالات |
| PUT /api/admin/school, POST /api/admin/import, /api/admin/staff, GET /api/admin/report | مدير | الإدارة |

## الأمان

- الجلسة: كوكي HttpOnly + SameSite=Lax + Secure في الإنتاج، والتوكن مخزّن كـ SHA-256.
- CSRF: رفض أي Origin مختلف + JSON فقط.
- OTP: 4 أرقام، 5 دقائق، 5 محاولات، حد للطلبات لكل رقم ولكل IP، ونفس الرد للرقم غير المسجل.
- الصلاحيات: المعلمة لفصلها فقط؛ التفويض لأبنائك فقط؛ الشاشة بمفتاح ولا تعرض الجوالات.
- **السياج الجغرافي ميزة راحة وليس أماناً** (يمكن تزييف GPS). الأمان الحقيقي عند التسليم: المشرف يرى اسم المستلم وصلته، ومن فوّضه.
- سجل تدقيق `audit` لكل عملية.

## ما يحتاج انتباهاً

- ذروة 12:00 إلى 13:30: مئات الاتصالات المفتوحة لكل مدرسة. SSE يتحملها على خادم واحد؛ مع التوسع أضف Redis.
- iOS يوقف الصفحة في الخلفية: إشعار التسليم مضمون فقط والتطبيق مفتوح حتى نبني نسخة Expo.
- الأوقات بتوقيت الرياض (UTC+3 بدون توقيت صيفي).
