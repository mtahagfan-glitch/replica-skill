// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
// Hanu: personal Arabic subtitles over console games, built on chiaki-ng.

package com.metallic.chiaki.hanu

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale
import kotlin.random.Random

/** Everything the phone page can change, kept on the TV. */
class HanuConfig(context: Context)
{
	private val p: SharedPreferences = context.getSharedPreferences("hanu", Context.MODE_PRIVATE)

	val pairCode: String
		get() = p.getString("pair_code", null) ?: String.format(Locale.ROOT, "%06d", Random.nextInt(1000000)).also {
			p.edit().putString("pair_code", it).apply()
		}

	var geminiKey: String
		get() = p.getString("gemini_key", "") ?: ""
		set(v) = p.edit().putString("gemini_key", v.trim()).apply()
	var model: String
		get() = p.getString("model", DEFAULT_MODEL) ?: DEFAULT_MODEL
		set(v) = p.edit().putString("model", v.trim().ifEmpty { DEFAULT_MODEL }).apply()
	var dialect: String
		get() = p.getString("dialect", "سعودية بيضاء مفهومة") ?: "سعودية بيضاء مفهومة"
		set(v) = p.edit().putString("dialect", v).apply()
	var soften: Boolean
		get() = p.getBoolean("soften", true)
		set(v) = p.edit().putBoolean("soften", v).apply()
	var glossary: String
		get() = p.getString("glossary", GTA_GLOSSARY) ?: GTA_GLOSSARY
		set(v) = p.edit().putString("glossary", v).apply()
	var accountId: String
		get() = p.getString("account_id", "") ?: ""
		set(v) = p.edit().putString("account_id", v.trim()).apply()
	var enabled: Boolean
		get() = p.getBoolean("enabled", true)
		set(v) = p.edit().putBoolean("enabled", v).apply()
	var showEnglish: Boolean
		get() = p.getBoolean("show_en", false)
		set(v) = p.edit().putBoolean("show_en", v).apply()
	var textScale: Float
		get() = p.getFloat("scale", 1f)
		set(v) = p.edit().putFloat("scale", v.coerceIn(0.5f, 2f)).apply()
	/** Subtitle region as fractions of the picture (GTA V: bottom centre). */
	var region: FloatArray
		get() = floatArrayOf(p.getFloat("rx", .14f), p.getFloat("ry", .79f), p.getFloat("rw", .72f), p.getFloat("rh", .13f))
		set(v) = p.edit().putFloat("rx", v[0].coerceIn(0f, .95f)).putFloat("ry", v[1].coerceIn(0f, .97f))
			.putFloat("rw", v[2].coerceIn(.05f, 1f)).putFloat("rh", v[3].coerceIn(.03f, 1f)).apply()

	fun toJson(): JSONObject = JSONObject().apply {
		put("hasKey", geminiKey.isNotEmpty())
		put("model", model); put("dialect", dialect); put("soften", soften); put("glossary", glossary)
		put("accountId", accountId); put("enabled", enabled); put("showEn", showEnglish); put("scale", textScale.toDouble())
		val r = region
		put("region", JSONObject().put("x", r[0].toDouble()).put("y", r[1].toDouble()).put("w", r[2].toDouble()).put("h", r[3].toDouble()))
	}

	fun apply(o: JSONObject)
	{
		if(o.has("geminiKey") && o.optString("geminiKey").isNotBlank()) geminiKey = o.optString("geminiKey")
		if(o.has("model")) model = o.optString("model")
		if(o.has("dialect")) dialect = o.optString("dialect")
		if(o.has("soften")) soften = o.optBoolean("soften")
		if(o.has("glossary")) glossary = o.optString("glossary")
		if(o.has("enabled")) enabled = o.optBoolean("enabled")
		if(o.has("showEn")) showEnglish = o.optBoolean("showEn")
		if(o.has("scale")) textScale = o.optDouble("scale", 1.0).toFloat()
		o.optJSONObject("region")?.let {
			region = floatArrayOf(it.optDouble("x", .14).toFloat(), it.optDouble("y", .79).toFloat(), it.optDouble("w", .72).toFloat(), it.optDouble("h", .13).toFloat())
		}
	}

	companion object
	{
		const val DEFAULT_MODEL = "gemini-3.5-flash-lite"
		const val PORT = 8787
		val GTA_GLOSSARY = """
			Franklin = فرانكلين
			Michael = مايكل
			Trevor = تريفر
			Lamar = لامار
			Lester = ليستر
			Chop = تشوب
			Los Santos = لوس سانتوس
			Vinewood = فاينوود
			Grove Street = شارع غروف
			Sandy Shores = ساندي شورز
			Blaine County = مقاطعة بلين
			heist = عملية سطو
			LSPD = شرطة لوس سانتوس
		""".trimIndent()

		fun localIp(): String?
		{
			try
			{
				for(n in Collections.list(NetworkInterface.getNetworkInterfaces()))
				{
					if(!n.isUp || n.isLoopback) continue
					for(a in Collections.list(n.inetAddresses))
						if(a is Inet4Address && a.isSiteLocalAddress) return a.hostAddress
				}
			}
			catch(_: Exception) {}
			return null
		}
	}
}
