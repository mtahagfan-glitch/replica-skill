// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL

package com.metallic.chiaki.hanu

import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The PSN Account ID Remote Play registration needs, from the address Sony shows after you sign in.
 * Same flow as chiaki-ng's scripts/psn-account-id.py: code -> token -> user_id -> 8 bytes little-endian, base64.
 * The phone does the sign-in in its own browser; the TV only sees the one-time code.
 */
object PsnAccount
{
	private const val CLIENT_ID = "ba495a24-818c-472b-b12d-ff231c1b5745"
	private const val CLIENT_SECRET = "mvaiZkRsAsI1IBkY"
	private const val REDIRECT = "https://remoteplay.dl.playstation.net/remoteplay/redirect"
	private const val TOKEN_URL = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token"

	const val LOGIN_URL = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?service_entity=urn:service-entity:psn" +
		"&response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT&scope=psn:clientapp&request_locale=en_US&ui=pr" +
		"&service_logo=ps&layout_type=popup&smcid=remoteplay&prompt=always&PlatformPrivacyWs1=minimal&"

	/** Returns the base64 Account ID, or throws with a readable message. */
	fun fromRedirect(redirectUrl: String): String
	{
		val code = Uri.parse(redirectUrl.trim()).getQueryParameter("code")
			?: throw IllegalArgumentException("الرابط لا يحتوي على code. انسخ الرابط كاملًا بعد تسجيل الدخول.")
		val basic = "Basic " + Base64.encodeToString("$CLIENT_ID:$CLIENT_SECRET".toByteArray(), Base64.NO_WRAP)

		val tokenConn = (URL(TOKEN_URL).openConnection() as HttpURLConnection).apply {
			requestMethod = "POST"; doOutput = true; connectTimeout = 10000; readTimeout = 10000
			setRequestProperty("Authorization", basic)
			setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
		}
		val body = "grant_type=authorization_code&code=${URLEncoder.encode(code, "UTF-8")}&redirect_uri=$REDIRECT&"
		tokenConn.outputStream.use { it.write(body.toByteArray()) }
		if(tokenConn.responseCode != 200) throw IllegalStateException("رفض Sony الرمز (${tokenConn.responseCode}). سجّل الدخول مرة ثانية وانسخ الرابط فورًا.")
		val token = JSONObject(tokenConn.inputStream.bufferedReader().readText()).getString("access_token")

		val infoConn = (URL("$TOKEN_URL/" + URLEncoder.encode(token, "UTF-8")).openConnection() as HttpURLConnection).apply {
			connectTimeout = 10000; readTimeout = 10000
			setRequestProperty("Authorization", basic)
		}
		if(infoConn.responseCode != 200) throw IllegalStateException("تعذّر جلب معلومات الحساب (${infoConn.responseCode}).")
		val userId = JSONObject(infoConn.inputStream.bufferedReader().readText()).getString("user_id").toBigInteger().toLong()
		val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(userId).array()
		return Base64.encodeToString(bytes, Base64.NO_WRAP)
	}
}
