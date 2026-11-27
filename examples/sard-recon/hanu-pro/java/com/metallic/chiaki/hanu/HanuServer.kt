// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL

package com.metallic.chiaki.hanu

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * The TV's settings page for the phone: open http://TV-IP:8787 on the iPhone (same Wi-Fi).
 * Every API call carries the 6-digit code shown on the TV.
 */
object HanuServer
{
	@Volatile private var started = false
	private lateinit var app: Context
	lateinit var config: HanuConfig; private set
	lateinit var translator: Translator; private set
	@Volatile var lastStats: SubtitleReader.Stats? = null
	private val recentLines = ArrayDeque<JSONObject>()

	@Synchronized fun ensureStarted(context: Context)
	{
		if(started) return
		app = context.applicationContext
		config = HanuConfig(app)
		translator = Translator(app, config)
		started = true
		Thread({ serve() }, "hanu-server").apply { isDaemon = true; start() }
	}

	fun url(): String = "http://${HanuConfig.localIp() ?: "?"}:${HanuConfig.PORT}"

	fun recordLine(en: String, ar: String, fromMemory: Boolean)
	{
		synchronized(recentLines) {
			recentLines.addFirst(JSONObject().put("en", en).put("ar", ar).put("mem", fromMemory))
			while(recentLines.size > 30) recentLines.removeLast()
		}
	}

	private fun serve()
	{
		while(true)
		{
			try
			{
				ServerSocket().use { s ->
					s.reuseAddress = true
					s.bind(InetSocketAddress(HanuConfig.PORT))
					while(true) { val c = s.accept(); Thread { handle(c) }.apply { isDaemon = true; start() } }
				}
			}
			catch(_: Exception) { Thread.sleep(1500) }
		}
	}

	private fun handle(c: Socket)
	{
		try
		{
			c.use { sock ->
				sock.soTimeout = 15000
				val input = BufferedInputStream(sock.getInputStream())
				val request = readLine(input) ?: return
				var length = 0
				while(true)
				{
					val h = readLine(input) ?: break
					if(h.isEmpty()) break
					val i = h.indexOf(':')
					if(i > 0 && h.substring(0, i).trim().equals("content-length", true)) length = h.substring(i + 1).trim().toIntOrNull() ?: 0
				}
				val parts = request.split(" ")
				val method = parts.getOrElse(0) { "" }
				val target = parts.getOrElse(1) { "/" }
				val path = target.substringBefore('?')
				val query = target.substringAfter('?', "").split('&').filter { it.contains('=') }
					.associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
				val body = if(length in 1..(256 * 1024))
				{
					val b = ByteArray(length); var off = 0
					while(off < length) { val n = input.read(b, off, length - off); if(n < 0) break; off += n }
					String(b, 0, off, Charsets.UTF_8)
				} else ""
				val out = sock.getOutputStream()

				if(method == "OPTIONS") { reply(out, 204, "text/plain", ""); return }
				if(method == "GET" && (path == "/" || path == "/index.html"))
				{
					val html = app.assets.open("hanu/phone.html").use { it.readBytes() }
					reply(out, 200, "text/html; charset=utf-8", html); return
				}
				val json = if(body.isNotEmpty()) try { JSONObject(body) } catch(_: Exception) { JSONObject() } else JSONObject()
				val code = query["code"] ?: json.optString("code")
				if(code != config.pairCode) { reply(out, 403, "application/json", """{"ok":false,"error":"code"}"""); return }

				when
				{
					method == "GET" && path == "/api/state" ->
					{
						val o = config.toJson()
						o.put("ok", true).put("loginUrl", PsnAccount.LOGIN_URL).put("memory", translator.size)
						lastStats?.let { s -> o.put("stats", JSONObject().put("ocrMs", s.ocrMs).put("trMs", s.trMs).put("e2eMs", s.e2eMs).put("lines", s.lines).put("error", s.error ?: "")) }
						synchronized(recentLines) { o.put("lines", JSONArray(recentLines.toList())) }
						reply(out, 200, "application/json", o.toString())
					}
					method == "POST" && path == "/api/config" ->
					{
						config.apply(json)
						reply(out, 200, "application/json", """{"ok":true}""")
					}
					method == "POST" && path == "/api/psn" ->
					{
						val result = try
						{
							val id = PsnAccount.fromRedirect(json.optString("url"))
							config.accountId = id
							JSONObject().put("ok", true).put("accountId", id)
						}
						catch(e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName) }
						reply(out, 200, "application/json", result.toString())
					}
					method == "POST" && path == "/api/correct" ->
					{
						translator.correct(json.optString("en"), json.optString("ar"))
						reply(out, 200, "application/json", """{"ok":true}""")
					}
					method == "GET" && path == "/api/memory" -> reply(out, 200, "application/json", translator.exportJson())
					method == "POST" && path == "/api/memory" ->
					{
						translator.importJson(json.optJSONObject("memory")?.toString() ?: "{}")
						reply(out, 200, "application/json", """{"ok":true}""")
					}
					else -> reply(out, 404, "application/json", """{"ok":false}""")
				}
			}
		}
		catch(_: Exception) {}
	}

	private fun readLine(input: InputStream): String?
	{
		val b = ByteArrayOutputStream(); var ch: Int
		while(true)
		{
			ch = input.read()
			if(ch == -1 || ch == '\n'.code) break
			if(ch != '\r'.code) b.write(ch)
			if(b.size() > 8192) break
		}
		if(ch == -1 && b.size() == 0) return null
		return b.toString("UTF-8")
	}

	private fun reply(out: OutputStream, status: Int, type: String, body: String) = reply(out, status, type, body.toByteArray(Charsets.UTF_8))

	private fun reply(out: OutputStream, status: Int, type: String, body: ByteArray)
	{
		val head = "HTTP/1.1 $status ${if(status == 200) "OK" else "Status"}\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
			"Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\n" +
			"Access-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
		out.write(head.toByteArray(Charsets.US_ASCII)); out.write(body); out.flush()
	}
}
