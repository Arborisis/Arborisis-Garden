type Hit = { ts: number };

const store = new Map<string, Hit[]>();

export function checkRateLimit(
  ip: string,
  key: string,
  maxAttempts: number,
  windowMs: number
): boolean {
  const storeKey = `${ip}:${key}`;
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (store.get(storeKey) ?? []).filter((h) => h.ts > cutoff);
  hits.push({ ts: now });
  store.set(storeKey, hits);
  return hits.length <= maxAttempts;
}
