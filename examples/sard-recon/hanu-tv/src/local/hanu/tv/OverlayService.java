package local.hanu.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Random;

/**
 * Draws the Arabic line over whatever the TV shows (the PS5 on HDMI), in the place of the English subtitle.
 * The Mac (Hanu) sends each line over the home network to LineServer.
 */
public class OverlayService extends Service {
    static final String CHANNEL = "hanu";
    static volatile boolean running = false;
    static volatile String lastLine = "";

    private WindowManager wm;
    private FrameLayout root;
    private TextView text;
    private LineServer server;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable autoHide = () -> { if (text != null) text.setVisibility(View.INVISIBLE); };
    private Typeface face;

    static String code(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences("hanu", MODE_PRIVATE);
        String c = p.getString("code", null);
        if (c == null) {
            c = String.format(java.util.Locale.ROOT, "%06d", new Random().nextInt(1000000));
            p.edit().putString("code", c).apply();
        }
        return c;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        startInForeground();
        running = true;
        try { face = Typeface.createFromAsset(getAssets(), "fonts/Tajawal-Bold.ttf"); } catch (Exception e) { face = Typeface.DEFAULT_BOLD; }
        if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)) addOverlay();
        server = new LineServer(code(this), json -> main.post(() -> show(json)));
        server.start();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getBooleanExtra("test", false)) {
            show("{\"ar\":\"هنو جاهز. هذا مكان الترجمة العربية.\",\"region\":{\"x\":0.14,\"y\":0.79,\"w\":0.72,\"h\":0.13}}");
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        if (server != null) server.stop();
        main.removeCallbacksAndMessages(null);
        if (root != null && wm != null) { try { wm.removeView(root); } catch (Exception ignored) {} }
        super.onDestroy();
    }

    private void startInForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "هنو", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setContentTitle("هنو يعمل").setContentText("الترجمة العربية فوق اللعبة")
                .setSmallIcon(android.R.drawable.ic_menu_info_details).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    private void addOverlay() {
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        root = new FrameLayout(this);
        text = new TextView(this);
        text.setGravity(Gravity.CENTER);
        text.setTextDirection(View.TEXT_DIRECTION_RTL);
        text.setTypeface(face);
        text.setTextColor(Color.WHITE);
        text.setShadowLayer(6f, 0f, 0f, Color.BLACK);
        text.setVisibility(View.INVISIBLE);
        root.addView(text, new FrameLayout.LayoutParams(10, 10));
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        wm.addView(root, lp);
    }

    private void show(String json) {
        if (text == null) {
            if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) return;
            addOverlay();
        }
        try {
            JSONObject o = new JSONObject(json);
            String ar = o.optString("ar", "");
            String en = o.optString("en", "");
            lastLine = ar;
            main.removeCallbacks(autoHide);
            if (ar.isEmpty()) { text.setVisibility(View.INVISIBLE); return; }

            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            int W = dm.widthPixels, H = dm.heightPixels;
            JSONObject r = o.optJSONObject("region");
            double rx = r != null ? r.optDouble("x", .14) : .14, ry = r != null ? r.optDouble("y", .79) : .79;
            double rw = r != null ? r.optDouble("w", .72) : .72, rh = r != null ? r.optDouble("h", .13) : .13;
            JSONObject st = o.optJSONObject("style");
            double scale = st != null ? st.optDouble("scale", 1) : 1;
            int fg = parse(st != null ? st.optString("color", "#ffffff") : "#ffffff", Color.WHITE);
            int bg = parse(st != null ? st.optString("bg", "#000000") : "#000000", Color.BLACK);
            double alpha = st != null ? st.optDouble("alpha", .92) : .92;

            FrameLayout.LayoutParams p = new FrameLayout.LayoutParams((int) (rw * W), (int) (rh * H));
            p.leftMargin = (int) (rx * W);
            p.topMargin = (int) (ry * H);
            text.setLayoutParams(p);
            float px = (float) Math.max(18, rh * H * 0.42 * scale);
            text.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
            text.setTextColor(fg);
            GradientDrawable g = new GradientDrawable();
            g.setColor(Color.argb((int) Math.round(alpha * 255), Color.red(bg), Color.green(bg), Color.blue(bg)));
            g.setCornerRadius(px * 0.35f);
            text.setBackground(g);
            int pad = (int) (px * 0.5f);
            text.setPadding(pad, 0, pad, 0);
            boolean showEn = st != null && st.optBoolean("showEn", false);
            text.setText(showEn && !en.isEmpty() ? ar + "\n" + en : ar);
            text.setVisibility(View.VISIBLE);
            main.postDelayed(autoHide, 12000);   // never leave a stale line up if the Mac stops sending
        } catch (Exception ignored) {
        }
    }

    private static int parse(String c, int fallback) {
        try { return Color.parseColor(c); } catch (Exception e) { return fallback; }
    }
}
