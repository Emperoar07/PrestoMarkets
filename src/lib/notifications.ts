import { createNotification, getProfile, type NotificationType } from './socialDb';
import { sendEmail } from './email';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://presto-markets.vercel.app').replace(/\/$/, '');

type NotifyInput = {
  address: string;
  type: NotificationType;
  title: string;
  body?: string;
  marketId?: string | null;
  link?: string | null;
};

/**
 * Persist an in-app notification and, if the recipient opted into email, deliver it off-app.
 * Both steps are best-effort: a failure here never blocks the action that triggered it.
 */
export async function notifyUser(input: NotifyInput): Promise<void> {
  const address = input.address.toLowerCase();
  try {
    await createNotification({ ...input, address });
  } catch {
    return; // if it can't be persisted, skip email too
  }

  try {
    const profile = await getProfile(address);
    if (profile?.emailNotifications && profile.email) {
      const link = input.link || (input.marketId ? `${APP_URL}/markets/${input.marketId}` : APP_URL);
      await sendEmail({
        to: profile.email,
        subject: input.title,
        text: `${input.body || input.title}\n\nView on Presto: ${link}`,
      });
    }
  } catch {
    /* email is best-effort */
  }
}

/** Notify a set of addresses (deduped, skips falsy). Used for market-wide events. */
export async function notifyMany(
  addresses: string[],
  make: (address: string) => Omit<NotifyInput, 'address'>,
): Promise<number> {
  const seen = new Set<string>();
  let sent = 0;
  for (const raw of addresses) {
    const address = raw?.toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    await notifyUser({ address, ...make(address) });
    sent += 1;
  }
  return sent;
}
