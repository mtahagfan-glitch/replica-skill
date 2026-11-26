# هنو TV (Android TV / Google TV)

تطبيق التلفزيون: يرسم الترجمة العربية فوق اللعبة القادمة من HDMI، مثل SARD تمامًا. الماك (هنو) يقرأ ويترجم ويرسل كل سطر عبر الواي فاي.

```
PS5 ──HDMI──► التلفزيون (اللعبة بجودتها الكاملة) + هنو TV يرسم العربي فوقها
  └─ Remote Play ─► الماك: هنو يقرأ ويترجم ─── واي فاي (منفذ 8787) ───┘
```

- `LineServer.java`: مستقبل HTTP صغير (`GET /ping`, `POST /line`) يتحقق من رمز من 6 أرقام، ويرد على CORS و Private Network Access.
- `OverlayService.java`: خدمة أمامية تضع نافذة `TYPE_APPLICATION_OVERLAY` شفافة فوق كل شيء، وترسم السطر في نفس مكان منطقة الترجمة (إحداثيات نسبية من هنو).
- `MainActivity.java`: شاشة واحدة: إذن العرض فوق التطبيقات، العنوان والرمز، سطر تجربة.
- `BootReceiver.java`: يشغّل الخدمة عند تشغيل التلفزيون.
- الخط: Tajawal Bold (OFL، `assets/fonts/OFL.txt`).

## البناء

```bash
ANDROID_SDK=/path/to/sdk ./build.sh     # يحتاج platforms;android-34 و build-tools;34.0.0 و JDK
```
بدون Gradle: aapt2 + javac + d8 + apksigner. الناتج `hanu-tv.apk` (حوالي 70KB).
مفتاح التوقيع `.keystore` لا يُرفع للمستودع. التحديث بمفتاح مختلف يحتاج حذف التطبيق القديم أولًا.

## التثبيت على التلفزيون من الماك

```bash
bash ~/Downloads/install-hanu-mac.sh tv
```
يعرض عنوانًا مثل `http://192.168.1.5:8000/h.apk` تكتبه في تطبيق Downloader على التلفزيون.
