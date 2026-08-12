const GC_THRESHOLD = 1000;

export function slidingWindowLimit(key: string, attempts: Map<string, number[]>, windowMs: number, limit: number): boolean {
  const now = Date.now();
  if (attempts.size >= GC_THRESHOLD) {
    for (const [candidate, times] of attempts) {
      if (now - (times[times.length - 1] ?? 0) >= windowMs) attempts.delete(candidate);
    }
  }
  const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > limit;
}
