import type { Env } from "./types.js";

const DEFAULT_RPM = 20;
const WINDOW_SECONDS = 60;

/**
 * Sliding-window per-IP rate limiter backed by Cloudflare KV.
 *
 * Each KV entry stores a JSON array of timestamps (unix seconds) for the
 * current window. Old entries outside the window are pruned on every check,
 * so the entry naturally expires. A TTL of WINDOW_SECONDS is set on write
 * so KV auto-cleans idle keys.
 *
 * Returns null on success, or an error Response when the limit is exceeded.
 */
export async function checkRateLimit(
  ip: string,
  env: Env
): Promise<Response | null> {
  const kv = env.RATE_LIMITS;

  const limitStr = env.RPM_LIMIT_PER_IP ?? String(DEFAULT_RPM);
  const limit = parseInt(limitStr, 10);
  if (isNaN(limit) || limit <= 0) return null;

  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_SECONDS;

  // Read current timestamps
  let timestamps: number[] = [];
  try {
    const raw = await kv.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        timestamps = (parsed as unknown[]).filter(
          (t): t is number => typeof t === "number"
        );
      }
    }
  } catch {
    // If KV read fails, fail open (allow the request)
    return null;
  }

  // Prune timestamps outside the window
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    const retryAfter = Math.max(1, timestamps[0]! + WINDOW_SECONDS - now);
    return new Response(
      JSON.stringify({
        error: {
          message: `Rate limit exceeded: ${limit} requests per minute. Retry after ${retryAfter}s.`,
          type: "rate_limit_exceeded",
          code: "rate_limit_exceeded",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, retryAfter)),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(timestamps[0]! + WINDOW_SECONDS),
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Record this request
  timestamps.push(now);
  try {
    await kv.put(key, JSON.stringify(timestamps), { expirationTtl: WINDOW_SECONDS + 5 });
  } catch {
    // If KV write fails, still allow the request
  }

  return null;
}
