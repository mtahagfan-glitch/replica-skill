// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL

package com.metallic.chiaki.hanu

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** English line -> Arabic, with a translation memory on the TV so a repeated line costs nothing. */
class Translator(context: Context, private val config: HanuConfig)
{
	data class Entry(val en: String, val ar: String, val reviewed: Boolean)

	private val file = File(context.filesDir, "hanu-memory.json")
	private val memory = LinkedHashMap<String, Entry>()
	private val recent = ArrayDeque<String>()
	var lastMs = 0L; private set

	init { load() }

	val size get() = synchronized(memory) { memory.size }

	/** Returns Arabic (or null to skip the line) and whether it came from memory. */
	fun translate(en: String): Pair<String, Boolean>?
	{
		val norm = normalize(en)
		lookup(norm)?.let { lastMs = 0; remember(en); return it.ar to true }
		val key = config.geminiKey
		if(key.isEmpty()) return null
		val t = System.currentTimeMillis()
		val ar = gemini(en, key) ?: return null
		lastMs = System.currentTimeMillis() - t
		if(ar.isBlank() || ar.startsWith("SKIP", ignoreCase = true)) return null
		synchronized(memory) { memory[norm] = Entry(en, ar, false) }
		remember(en)
		save()
		return ar to false
	}

	fun correct(en: String, ar: String)
	{
		synchronized(memory) { memory[normalize(en)] = Entry(en, ar, true) }
		save()
	}

	fun exportJson(): String = synchronized(memory) {
		JSONObject().also { o -> memory.forEach { (k, e) -> o.put(k, JSONObject().put("en", e.en).put("ar", e.ar).put("reviewed", e.reviewed)) } }.toString()
	}

	fun importJson(text: String)
	{
		val o = JSONObject(text)
		synchronized(memory) {
			for(k in o.keys())
			{
				val e = o.getJSONObject(k)
				memory[k] = Entry(e.optString("en"), e.optString("ar"), e.optBoolean("reviewed"))
			}
		}
		save()
	}

	private fun remember(en: String) { recent.addLast(en); while(recent.size > 4) recent.removeFirst() }

	private fun lookup(norm: String): Entry?
	{
		synchronized(memory) {
			memory[norm]?.let { return it }
			var best: Entry? = null; var score = 0.0
			for((k, e) in memory) { val s = similarity(norm, k); if(s > score) { score = s; best = e } }
			return if(score >= 0.9) best else null
		}
	}

	private fun gemini(en: String, key: String): String?
	{
		val system = """أنت مترجم حوارات ألعاب فيديو. ترجم سطر الترجمة الإنجليزي إلى عربية ${config.dialect}، قصيرة وطبيعية ومناسبة للقراءة السريعة على الشاشة.
${if(config.soften) "خفّف الشتائم والألفاظ البذيئة إلى بدائل مهذبة مع الإبقاء على النبرة." else "حافظ على نبرة الشتائم كما هي."}
التزم بهذا القاموس للأسماء والمصطلحات:
${config.glossary}
قد يحتوي السطر على أخطاء قراءة OCR: استنتج الجملة المقصودة وترجمها. إذا كان السطر ضجيجًا بلا معنى، أعد كلمة SKIP فقط.
أعد الترجمة العربية فقط، بدون علامات تنصيص أو شرح."""
		val context = recent.joinToString("\n") { "- $it" }
		val user = (if(context.isNotEmpty()) "الأسطر السابقة للسياق فقط:\n$context\n\n" else "") + "السطر المطلوب:\n$en"
		val body = JSONObject()
			.put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
			.put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", user)))))
			.put("generationConfig", JSONObject().put("temperature", 0.3).put("maxOutputTokens", 200))
		return try
		{
			val c = (URL("https://generativelanguage.googleapis.com/v1beta/models/${URLEncoder.encode(config.model, "UTF-8")}:generateContent")
				.openConnection() as HttpURLConnection).apply {
				requestMethod = "POST"; doOutput = true; connectTimeout = 5000; readTimeout = 8000
				setRequestProperty("Content-Type", "application/json")
				setRequestProperty("x-goog-api-key", key)
			}
			c.outputStream.use { it.write(body.toString().toByteArray()) }
			if(c.responseCode != 200) { lastError = "Gemini ${c.responseCode}"; return null }
			val parts = JSONObject(c.inputStream.bufferedReader().readText())
				.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts") ?: return null
			lastError = null
			(0 until parts.length()).joinToString("") { parts.getJSONObject(it).optString("text") }.trim()
		}
		catch(e: Exception) { lastError = e.javaClass.simpleName; null }
	}

	@Volatile var lastError: String? = null; private set

	private fun load()
	{
		try { if(file.exists()) importJsonNoSave(file.readText()) } catch(_: Exception) {}
	}

	private fun importJsonNoSave(text: String)
	{
		val o = JSONObject(text)
		for(k in o.keys()) { val e = o.getJSONObject(k); memory[k] = Entry(e.optString("en"), e.optString("ar"), e.optBoolean("reviewed")) }
	}

	private fun save()
	{
		try { val tmp = File(file.path + ".tmp"); tmp.writeText(exportJson()); tmp.renameTo(file) } catch(_: Exception) {}
	}

	companion object
	{
		fun normalize(s: String) = s.lowercase().replace(Regex("[^a-z0-9' ]"), "").replace(Regex("\\s+"), " ").trim()

		fun clean(raw: String): String
		{
			var s = raw.replace(Regex("[|_~`{}\\[\\]<>\\\\—–]"), " ").replace(Regex("\\s+"), " ").trim()
			s = s.replace(Regex("^[\\s.,;:'\"-]+|[\\s,;:'\"-]+$"), "")
			val letters = s.count { it in 'a'..'z' || it in 'A'..'Z' }
			return if(letters >= 3 && letters.toDouble() / max(1, s.length) > 0.5) s else ""
		}

		fun similarity(a: String, b: String): Double
		{
			if(a.isEmpty() || b.isEmpty()) return 0.0
			if(a == b) return 1.0
			val m = a.length; val n = b.length
			if(abs(m - n) > max(m, n) * 0.3) return 0.0
			var prev = IntArray(n + 1) { it }; var cur = IntArray(n + 1)
			for(i in 1..m)
			{
				cur[0] = i
				for(j in 1..n) cur[j] = min(min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + if(a[i - 1] == b[j - 1]) 0 else 1)
				val t = prev; prev = cur; cur = t
			}
			return 1.0 - prev[n].toDouble() / max(m, n)
		}
	}
}
