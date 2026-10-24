type Window = { count: number; resetAt: number };
const state = globalThis as typeof globalThis & { accessForAllRateLimits?: Map<string, Window> };
const windows = (state.accessForAllRateLimits ??= new Map<string, Window>());

export function allowRequest(key: string, limit: number, durationMs: number) {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + durationMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function clientRateKey(request: Request, category: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${category}:${forwarded || "local"}`;
}
