package local.hanu.tv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/** The one screen of Hanu TV: permission, the address and code to type on the Mac, a test line. */
public class MainActivity extends Activity {
    private TextView status, address, codeView;
    private Button permission, test;
    private Typeface face;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        try { face = Typeface.createFromAsset(getAssets(), "fonts/Tajawal-Bold.ttf"); } catch (Exception e) { face = Typeface.DEFAULT_BOLD; }
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setBackgroundColor(Color.rgb(11, 21, 32));
        col.setPadding(dp(48), dp(32), dp(48), dp(32));
        col.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        col.addView(label("هنو", 44, Color.WHITE));
        col.addView(label("الترجمة العربية فوق اللعبة", 18, Color.argb(180, 238, 243, 247)));
        status = label("", 18, Color.rgb(242, 184, 75));
        status.setPadding(0, dp(18), 0, dp(6));
        col.addView(status);

        permission = button("فعّل العرض فوق التطبيقات");
        permission.setOnClickListener(v -> openOverlaySettings());
        col.addView(permission);

        col.addView(label("في هنو على الماك: الإعدادات ← التلفزيون، واكتب:", 18, Color.argb(200, 238, 243, 247)));
        address = label("", 34, Color.WHITE);
        codeView = label("", 34, Color.rgb(43, 179, 163));
        col.addView(address);
        col.addView(codeView);

        test = button("اعرض سطر تجربة");
        test.setOnClickListener(v -> startService(new Intent(this, OverlayService.class).putExtra("test", true)));
        col.addView(test);
        col.addView(label("بعدها ارجع لمدخل HDMI والعب. هنو يبقى يعمل في الخلفية.", 16, Color.argb(160, 238, 243, 247)));
        setContentView(col);
    }

    @Override protected void onResume() {
        super.onResume();
        boolean ok = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
        if (ok) {
            Intent svc = new Intent(this, OverlayService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
            status.setText("جاهز ✓");
            status.setTextColor(Color.rgb(43, 179, 163));
            permission.setVisibility(View.GONE);
            test.setVisibility(View.VISIBLE);
            test.requestFocus();
        } else {
            status.setText("الخطوة الأولى: اسمح لهنو بالعرض فوق التطبيقات");
            permission.setVisibility(View.VISIBLE);
            test.setVisibility(View.GONE);
            permission.requestFocus();
        }
        String ip = ip();
        address.setText("العنوان: " + (ip == null ? "غير متصل بالشبكة" : ip));
        codeView.setText("الرمز: " + OverlayService.code(this));
    }

    private void openOverlaySettings() {
        Intent[] tries = {
                new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())),
                new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())),
        };
        for (Intent i : tries) {
            try { startActivity(i); return; } catch (Exception ignored) {}
        }
        status.setText("لم تفتح الإعدادات. افتح: الإعدادات ← التطبيقات ← هنو ← الأذونات");
    }

    private static String ip() {
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                for (InetAddress a : Collections.list(n.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private TextView label(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(face);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private Button button(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTypeface(face);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setTextColor(Color.rgb(4, 32, 28));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.rgb(43, 179, 163));
        g.setCornerRadius(dp(28));
        b.setBackground(g);
        b.setPadding(dp(32), dp(10), dp(32), dp(10));
        b.setOnFocusChangeListener((v, f) -> { v.setScaleX(f ? 1.08f : 1f); v.setScaleY(f ? 1.08f : 1f); });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(14); lp.bottomMargin = dp(14);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
