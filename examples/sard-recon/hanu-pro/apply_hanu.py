#!/usr/bin/env python3
"""Apply Hanu onto a chiaki-ng checkout: copy the hanu package and assets, then make the few edits it needs.
Usage: python3 apply_hanu.py /path/to/chiaki-ng
Idempotent: running it twice changes nothing the second time."""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[1])
APP = os.path.join(ROOT, "android", "app")
MAIN = os.path.join(APP, "src", "main")
PKG = os.path.join(MAIN, "java", "com", "metallic", "chiaki")


def edit(path, old, new, marker=None):
    path = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if (marker or new) in text:
        return
    if old not in text:
        sys.exit("anchor not found in %s:\n%s" % (path, old))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text.replace(old, new, 1))


# 1. the hanu package and its assets
shutil.copytree(os.path.join(HERE, "java", "com", "metallic", "chiaki", "hanu"), os.path.join(PKG, "hanu"), dirs_exist_ok=True)
os.makedirs(os.path.join(MAIN, "assets", "hanu"), exist_ok=True)
for f in os.listdir(os.path.join(HERE, "assets", "hanu")):
    shutil.copy(os.path.join(HERE, "assets", "hanu", f), os.path.join(MAIN, "assets", "hanu", f))

# 2. our own app id and name, so it installs beside any real Chiaki; ML Kit for reading
gradle = os.path.join(APP, "build.gradle")
edit(gradle, 'applicationId "com.metallic.chiaki"', 'applicationId "local.hanu.pro"')
edit(gradle, "    implementation libs.oboe\n",
     "    implementation libs.oboe\n    implementation 'com.google.mlkit:text-recognition:16.0.1'\n")
edit(gradle, "        externalNativeBuild {\n            cmake {\n                arguments \"-DCHIAKI_ENABLE_TESTS=OFF\",",
     "        ndk { abiFilters 'armeabi-v7a', 'arm64-v8a' }\n        externalNativeBuild {\n            cmake {\n                arguments \"-DCHIAKI_ENABLE_TESTS=OFF\",",
     marker="abiFilters")
edit(os.path.join(MAIN, "res", "values", "strings.xml"),
     '<string name="app_name">Chiaki</string>', '<string name="app_name">هنو</string>')

# 3. the stream: a TextureView (its pixels can be read) and the Hanu overlay on top
edit(os.path.join(MAIN, "res", "layout", "activity_stream.xml"), "<SurfaceView", "<TextureView")
act = os.path.join(PKG, "stream", "StreamActivity.kt")
edit(act, "\tprivate val uiVisibilityHandler = Handler(Looper.getMainLooper())\n",
     "\tprivate val uiVisibilityHandler = Handler(Looper.getMainLooper())\n"
     "\tprivate var hanuOverlay: com.metallic.chiaki.hanu.HanuStreamOverlay? = null\n")
edit(act, "\t\tviewModel.session.attachToSurfaceView(binding.surfaceView)\n",
     "\t\tviewModel.session.attachToTextureView(binding.surfaceView)\n"
     "\t\thanuOverlay = com.metallic.chiaki.hanu.HanuStreamOverlay(this, binding.mainStreamLayout, binding.surfaceView,\n"
     "\t\t\tconnectInfo.videoProfile.width, connectInfo.videoProfile.height).also { it.start() }\n")
edit(act, "\t\tsuper.onDestroy()\n\t\tcontrolsJob?.cancel()\n",
     "\t\tsuper.onDestroy()\n\t\tcontrolsJob?.cancel()\n\t\thanuOverlay?.stop()\n")

# 4. the start screen says where the phone settings page is
main = os.path.join(PKG, "main", "MainActivity.kt")
edit(main, "\t\tsetContentView(binding.root)\n\n\t\ttitle = \"\"\n",
     "\t\tsetContentView(binding.root)\n"
     "\t\tcom.metallic.chiaki.hanu.HanuServer.ensureStarted(this)\n"
     "\t\tif(savedInstanceState == null)\n"
     "\t\t\tandroid.app.AlertDialog.Builder(this)\n"
     "\t\t\t\t.setTitle(\"هنو\")\n"
     "\t\t\t\t.setMessage(\"افتح في جوالك (نفس الواي فاي):\\n\\n\" + com.metallic.chiaki.hanu.HanuServer.url() +\n"
     "\t\t\t\t\t\"\\n\\nالرمز: \" + com.metallic.chiaki.hanu.HanuServer.config.pairCode +\n"
     "\t\t\t\t\t\"\\n\\nمن هناك: اربط حساب البلايستيشن، ضع مفتاح Gemini، واضبط مكان الترجمة.\")\n"
     "\t\t\t\t.setPositiveButton(\"تمام\", null)\n"
     "\t\t\t\t.show()\n\n\t\ttitle = \"\"\n")

# 5. registration: the Account ID from the phone fills itself in
reg = os.path.join(PKG, "regist", "RegistActivity.kt")
edit(reg, "\t\tbinding.hostEditText.setText(intent.getStringExtra(EXTRA_HOST) ?: \"255.255.255.255\")\n",
     "\t\tbinding.hostEditText.setText(intent.getStringExtra(EXTRA_HOST) ?: \"255.255.255.255\")\n"
     "\t\tcom.metallic.chiaki.hanu.HanuServer.ensureStarted(this)\n"
     "\t\tcom.metallic.chiaki.hanu.HanuServer.config.accountId.takeIf { it.isNotEmpty() }?.let { binding.psnIdEditText.setText(it) }\n")

print("Hanu applied to", ROOT)
