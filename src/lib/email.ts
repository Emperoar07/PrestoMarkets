// Off-app email delivery via Resend. Returns false (no-op) when RESEND_API_KEY is not set, so
// the app runs fully without email until a provider is provisioned. Swap the provider here
// without touching callers.
// Escape user-supplied text before interpolating into the default HTML body. Notification
// content can include arbitrary user input (e.g. comment bodies), so this prevents HTML/script
// injection into emails.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM || 'Presto Markets <notifications@presto-markets.app>';
  if (!apiKey || !input.to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<p>${escapeHtml(input.text).replace(/\n/g, '<br/>')}</p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
