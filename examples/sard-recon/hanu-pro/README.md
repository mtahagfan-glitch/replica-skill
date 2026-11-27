# هنو الشامل (Android TV)

تطبيق Android TV واحد بدون ماك ولا جوال: يتصل بالبلايستيشن عبر Remote Play، يقرأ الترجمة الإنجليزية من الصورة
(ML Kit على التلفزيون)، يترجمها (Gemini + ذاكرة ترجمة)، ويرسم العربي فوق مكانها.
مبني فوق [chiaki-ng](https://github.com/streetpea/chiaki-ng) (AGPL-3.0). استخدام شخصي، غير منشور.

## الإصدار 0.1 (تجريبي)

- الصورة تُعرض داخل التطبيق (بث Remote Play على التلفزيون)، والعربي فوقها.
- صفحة إعدادات من الجوال: `http://IP-التلفزيون:8787` برمز من 6 أرقام: ربط حساب PSN، مفتاح Gemini، اللهجة، القاموس، مكان الترجمة.
- شريط حالة صغير: زمن القراءة والترجمة ومن الظهور إلى العربي.

الإصدار 0.2 المخطط: العمل في الخلفية والرسم فوق مدخل HDMI (بدون تأخير الصورة).

## الملفات

- `java/com/metallic/chiaki/hanu/`: HanuConfig، PsnAccount، Translator، SubtitleReader، HanuServer، HanuStreamOverlay.
- `assets/hanu/`: صفحة الجوال `phone.html` وخط Tajawal (OFL).
- `apply_hanu.py`: ينسخ الحزمة ويعدّل chiaki-ng (معرّف التطبيق، الاسم، ML Kit، TextureView، ربط الشاشات). يعمل مرتين بدون أثر.

## البناء

```bash
git clone https://github.com/streetpea/chiaki-ng.git && cd chiaki-ng && git checkout 43728af
git submodule update --init --depth 1 third-party/nanopb third-party/jerasure third-party/gf-complete android/app/src/main/cpp/oboe third-party/curl
python3 /path/to/hanu-pro/apply_hanu.py .
cd android && echo "sdk.dir=$ANDROID_SDK" > local.properties && ./gradlew assembleDebug
```
يحتاج: JDK 17+، Android SDK (platforms 35، build-tools 35، NDK 28.2.13676358، CMake 3.22.1)، و `protoc`.
في بيئة تمنع روابط أرشيف GitHub: استنسخ json-c (json-c-0.17-20230812) و miniupnp (miniupnpc_2_2_8) ومرّر
`-DFETCHCONTENT_SOURCE_DIR_JSON-C=...` و `-DFETCHCONTENT_SOURCE_DIR_MINIUPNPC=...` في وسائط cmake.
