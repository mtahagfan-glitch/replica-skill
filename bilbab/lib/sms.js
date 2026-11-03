// SMS adapter. SMS_PROVIDER = console (default) | taqnyat | unifonic.
// Keys come from your own account with the provider (see .env.example).
// Saudi senders must be registered with CST before a provider will send under your name.

export async function sendSms(phone, body) {
  const provider = process.env.SMS_PROVIDER || 'console';
  if (provider === 'console') {
    console.log(`[sms] -> ${phone}: ${body}`);
    return { ok: true, provider };
  }
  if (provider === 'taqnyat') {
    const r = await fetch('https://api.taqnyat.sa/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TAQNYAT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [phone], body, sender: process.env.SMS_SENDER }),
    });
    return { ok: r.ok, provider, status: r.status };
  }
  if (provider === 'unifonic') {
    const form = new URLSearchParams({ AppSid: process.env.UNIFONIC_APPSID || '', SenderID: process.env.SMS_SENDER || '', Body: body, Recipient: phone });
    const r = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', { method: 'POST', body: form });
    return { ok: r.ok, provider, status: r.status };
  }
  throw new Error(`unknown SMS_PROVIDER ${provider}`);
}
