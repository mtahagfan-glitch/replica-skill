// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL

package com.metallic.chiaki.hanu

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Reads the English subtitle from the Remote Play picture and hands back Arabic.
 * Same loop as Hanu on the Mac: crop the subtitle band, wait for the text to change and settle,
 * read it once (ML Kit, on the TV, offline), translate (memory first), show; hide when the band empties.
 */
class SubtitleReader(
	private val view: TextureView,
	private val videoWidth: Int,
	private val videoHeight: Int,
	private val config: HanuConfig,
	private val translator: Translator,
	private val listener: Listener)
{
	interface Listener
	{
		fun onLine(ar: String, en: String, fromMemory: Boolean)
		fun onClear()
		fun onStats(stats: Stats)
	}

	data class Stats(var grabMs: Long = 0, var ocrMs: Long = 0, var trMs: Long = 0, var e2eMs: Long = 0, var lines: Int = 0, var error: String? = null)

	private val main = Handler(Looper.getMainLooper())
	private val worker = Executors.newSingleThreadExecutor()
	private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
	private val frame: Bitmap = Bitmap.createBitmap(videoWidth, videoHeight, Bitmap.Config.ARGB_8888)
	private val stats = Stats()

	@Volatile private var running = false
	@Volatile private var busy = false
	private var lastSig: IntArray? = null
	private var stable = 0
	private var changedAt = 0L
	private var blankSince = 0L
	private var showing = false
	private var lastNorm = ""

	private val tick = object: Runnable
	{
		override fun run()
		{
			if(!running) return
			grab()
			main.postDelayed(this, 150)
		}
	}

	fun start() { if(!running) { running = true; main.post(tick) } }

	fun stop()
	{
		running = false
		main.removeCallbacks(tick)
		worker.shutdownNow()
		recognizer.close()
	}

	/** Main thread: copy the frame, cut the band, then let the worker think about it. */
	private fun grab()
	{
		if(busy || !view.isAvailable || !config.enabled) return
		val t = System.currentTimeMillis()
		view.getBitmap(frame)
		val r = config.region
		val x = (r[0] * videoWidth).roundToInt().coerceIn(0, videoWidth - 2)
		val y = (r[1] * videoHeight).roundToInt().coerceIn(0, videoHeight - 2)
		val w = (r[2] * videoWidth).roundToInt().coerceIn(1, videoWidth - x)
		val h = (r[3] * videoHeight).roundToInt().coerceIn(1, videoHeight - y)
		val band = Bitmap.createBitmap(frame, x, y, w, h)
		stats.grabMs = System.currentTimeMillis() - t
		busy = true
		worker.execute { try { think(band) } finally { busy = false } }
	}

	/** Worker thread. */
	private fun think(band: Bitmap)
	{
		val now = System.currentTimeMillis()
		val (sig, ink) = signature(band)
		if(ink < 0.002)
		{
			if(blankSince == 0L) blankSince = now
			if(showing && now - blankSince > 500) { showing = false; lastNorm = ""; main.post { listener.onClear() } }
			lastSig = sig; stable = 0
			return
		}
		blankSince = 0
		val diff = sigDiff(sig, lastSig); lastSig = sig
		if(diff > 0.08) { stable = 0; changedAt = now; return }
		stable++
		if(stable != 1) return

		val appeared = if(changedAt > 0) changedAt else now
		val t = System.currentTimeMillis()
		val raw = try { Tasks.await(recognizer.process(InputImage.fromBitmap(band, 0))).text } catch(e: Exception) { stats.error = "OCR"; return }
		stats.ocrMs = System.currentTimeMillis() - t
		val en = Translator.clean(raw.replace('\n', ' '))
		if(en.isEmpty()) return
		val norm = Translator.normalize(en)
		if(norm == lastNorm || Translator.similarity(norm, lastNorm) > 0.9) return
		lastNorm = norm

		val result = translator.translate(en)
		stats.trMs = translator.lastMs
		stats.error = translator.lastError ?: if(config.geminiKey.isEmpty()) "no-key" else null
		if(result == null) { main.post { listener.onStats(stats.copy()) }; return }
		stats.e2eMs = System.currentTimeMillis() - appeared
		stats.lines++
		showing = true
		val s = stats.copy()
		main.post { listener.onLine(result.first, en, result.second); listener.onStats(s) }
	}

	/**
	 * Subtitles are white letters with a dark outline. Count bright pixels that have a dark pixel nearby,
	 * on a 48x6 grid of a downscaled band. Returns the grid and the share of such pixels.
	 */
	private fun signature(band: Bitmap): Pair<IntArray, Double>
	{
		val sw = 480
		val sh = max(8, (band.height * sw.toFloat() / band.width).roundToInt())
		val small = Bitmap.createScaledBitmap(band, sw, sh, true)
		val px = IntArray(sw * sh); small.getPixels(px, 0, sw, 0, 0, sw, sh)
		if(small !== band) small.recycle()
		val lum = IntArray(px.size)
		val bright = BooleanArray(px.size)
		for(i in px.indices)
		{
			val c = px[i]; val r = Color.red(c); val g = Color.green(c); val b = Color.blue(c)
			lum[i] = (299 * r + 587 * g + 114 * b) / 1000
			bright[i] = lum[i] > 200 && maxOf(r, g, b) - minOf(r, g, b) < 50
		}
		val gx = 48; val gy = 6; val grid = IntArray(gx * gy); var on = 0
		for(y in 0 until sh) for(x in 0 until sw)
		{
			val i = y * sw + x
			if(!bright[i]) continue
			var dark = false
			loop@ for(dy in -2..2) for(dx in -2..2)
			{
				val xx = x + dx; val yy = y + dy
				if(xx in 0 until sw && yy in 0 until sh && lum[yy * sw + xx] < 90) { dark = true; break@loop }
			}
			if(dark) { on++; grid[(y * gy / sh) * gx + (x * gx / sw)]++ }
		}
		return grid to on.toDouble() / px.size
	}

	private fun sigDiff(a: IntArray, b: IntArray?): Double
	{
		if(b == null) return 1.0
		var s = 0; var t = 0
		for(i in a.indices) { s += kotlin.math.abs(a[i] - b[i]); t += a[i] + b[i] }
		return if(t == 0) 0.0 else s.toDouble() / t
	}
}
