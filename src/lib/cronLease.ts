import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { cronLeases } from './db/schema';

type Lease = { acquired: true; owner: string } | { acquired: false };

const localLeases = new Map<string, { owner: string; expiresAt: number }>();

export function tryAcquireLocalCronLease(key: string, ttlMs: number, now = Date.now()): Lease {
  const existing = localLeases.get(key);
  if (existing && existing.expiresAt > now) return { acquired: false };

  const owner = randomUUID();
  localLeases.set(key, { owner, expiresAt: now + ttlMs });
  return { acquired: true, owner };
}

export function releaseLocalCronLease(key: string, owner?: string) {
  const existing = localLeases.get(key);
  if (!existing) return;
  if (owner && existing.owner !== owner) return;
  localLeases.delete(key);
}

async function tryAcquireDbCronLease(key: string, ttlMs: number, now = Date.now()): Promise<Lease> {
  const owner = randomUUID();
  const current = new Date(now);
  const expiresAt = new Date(now + ttlMs);

  const updated = await getDb()
    .update(cronLeases)
    .set({ owner, expiresAt, updatedAt: current })
    .where(and(eq(cronLeases.key, key), lt(cronLeases.expiresAt, current)))
    .returning({ key: cronLeases.key });
  if (updated.length > 0) return { acquired: true, owner };

  const inserted = await getDb()
    .insert(cronLeases)
    .values({ key, owner, expiresAt, updatedAt: current })
    .onConflictDoNothing()
    .returning({ key: cronLeases.key });

  return inserted.length > 0 ? { acquired: true, owner } : { acquired: false };
}

async function releaseDbCronLease(key: string, owner: string) {
  await getDb()
    .delete(cronLeases)
    .where(and(eq(cronLeases.key, key), eq(cronLeases.owner, owner)));
}

export async function runWithCronLease<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const lease = hasDatabaseUrl()
    ? await tryAcquireDbCronLease(key, ttlMs)
    : tryAcquireLocalCronLease(key, ttlMs);

  if (!lease.acquired) return { acquired: false };

  try {
    return { acquired: true, value: await fn() };
  } finally {
    if (hasDatabaseUrl()) {
      await releaseDbCronLease(key, lease.owner).catch(() => {});
    } else {
      releaseLocalCronLease(key, lease.owner);
    }
  }
}
