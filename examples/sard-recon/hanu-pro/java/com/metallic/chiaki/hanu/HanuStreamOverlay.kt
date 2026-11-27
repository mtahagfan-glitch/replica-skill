// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL

package com.metallic.chiaki.hanu

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView

/**
 * Puts the Arabic line over the stream, in the place of the English subtitle, plus a small status line.
 * Version 1 shows the Remote Play picture on the TV (inside the app); version 2 will draw over HDMI.
 */
class HanuStreamOverlay(
	context: Context,
	private val root: FrameLayout,
	private val streamView: TextureView,
	private val videoWidth: Int,
	private val videoHeight: Int): SubtitleReader.Listener
{
	private val config: HanuConfig
	private val reader: SubtitleReader
	private val subtitle = TextView(context)
	private val hud = TextView(context)
	private val face: Typeface = try { Typeface.createFromAsset(context.assets, "hanu/Tajawal-Bold.ttf") } catch(_: Exception) { Typeface.DEFAULT_BOLD }

	init
	{
		HanuServer.ensureStarted(context)
		config = HanuServer.config
		reader = SubtitleReader(streamView, videoWidth, videoHeight, config, HanuServer.translator, this)

		subtitle.apply {
			gravity = Gravity.CENTER
			textDirection = View.TEXT_DIRECTION_RTL
			typeface = face
			setTextColor(Color.WHITE)
			setShadowLayer(6f, 0f, 0f, Color.BLACK)
			visibility = View.INVISIBLE
		}
		hud.apply {
			typeface = face
			setTextColor(Color.argb(220, 238, 243, 247))
			setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
			setPadding(24, 10, 24, 10)
			background = GradientDrawable().apply { setColor(Color.argb(150, 0, 0, 0)); cornerRadius = 24f }
		}
		root.addView(subtitle, FrameLayout.LayoutParams(10, 10))
		root.addView(hud, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
			gravity = Gravity.TOP or Gravity.START; topMargin = 24; leftMargin = 24
		})
		showHud(null)
		root.postDelayed({ hud.animate().alpha(0.25f).setDuration(600).start() }, 20000)
	}

	fun start() = reader.start()
	fun stop() = reader.stop()

	override fun onLine(ar: String, en: String, fromMemory: Boolean)
	{
		HanuServer.recordLine(en, ar, fromMemory)
		layoutSubtitle()
		subtitle.text = if(config.showEnglish) "$ar\n$en" else ar
		subtitle.visibility = View.VISIBLE
	}

	override fun onClear() { subtitle.visibility = View.INVISIBLE }

	override fun onStats(stats: SubtitleReader.Stats)
	{
		HanuServer.lastStats = stats
		showHud(stats)
	}

	private fun showHud(s: SubtitleReader.Stats?)
	{
		val setup = "إعدادات هنو من جوالك: ${HanuServer.url()}  الرمز: ${config.pairCode}"
		val line = when
		{
			s == null -> setup
			s.error == "no-key" -> "$setup\nضع مفتاح Gemini من الجوال"
			s.error != null -> "$setup\nخطأ: ${s.error}"
			else -> "$setup\nقراءة ${s.ocrMs}ms · ترجمة ${s.trMs}ms · إلى العربي ${s.e2eMs}ms · ${s.lines} سطر"
		}
		hud.text = line
		if(s?.error != null) hud.alpha = 1f
	}

	/** The stream view sits centred at the video's aspect ratio; the region is a fraction of it. */
	private fun layoutSubtitle()
	{
		val loc = IntArray(2); val rootLoc = IntArray(2)
		streamView.getLocationInWindow(loc); root.getLocationInWindow(rootLoc)
		val vx = loc[0] - rootLoc[0]; val vy = loc[1] - rootLoc[1]
		val vw = streamView.width; val vh = streamView.height
		val r = config.region
		val h = (r[3] * vh).toInt().coerceAtLeast(24)
		val lp = FrameLayout.LayoutParams((r[2] * vw).toInt().coerceAtLeast(40), h)
		lp.leftMargin = vx + (r[0] * vw).toInt()
		lp.topMargin = vy + (r[1] * vh).toInt()
		subtitle.layoutParams = lp
		val px = (h * 0.42f * config.textScale).coerceAtLeast(18f)
		subtitle.setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
		subtitle.background = GradientDrawable().apply { setColor(Color.argb(235, 0, 0, 0)); cornerRadius = px * 0.35f }
		subtitle.setPadding((px * 0.5f).toInt(), 0, (px * 0.5f).toInt(), 0)
	}
}
