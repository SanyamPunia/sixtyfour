/**
 * The two checks that run before a socket is trusted with anything.
 *
 * Both are pure, so both are tested without a server. They are here rather than inline in
 * the connection handler because the connection handler is the part that needs a real
 * network to exercise, and a security check that can only be tested that way tends not to
 * be tested at all.
 */

/**
 * A WebSocket handshake gets no preflight.
 *
 * This is the part that surprises people: `fetch` to another origin is stopped by the
 * browser before the request is sent, but a WebSocket upgrade is not. The browser sends it,
 * attaches cookies, and hands the open socket to whoever asked. So a page on any site can
 * open a socket to this server unless the server itself looks at `Origin` and refuses.
 * Nothing upstream does it.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.includes("*")) return true;
  if (origin === undefined || origin === "") {
    // Every browser sends `Origin` on an upgrade. A request without one is a native or
    // scripted client, which is not what the allowlist is protecting, so it is refused
    // unless the deployment has opted out of origin checks entirely.
    return false;
  }
  const normal = normalizeOrigin(origin);
  return allowed.some((entry) => normalizeOrigin(entry) === normal);
}

function normalizeOrigin(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * A sliding window, per connection.
 *
 * A fixed window lets a client send its whole allowance at the end of one window and again
 * at the start of the next, which is twice the limit across the boundary. This keeps the
 * timestamps instead, so the limit holds across any span of `windowMs`.
 *
 * The array is bounded by the limit itself, so a client hammering the socket does not also
 * get to grow an array on the server.
 */
export class RateLimiter {
  private hits: number[] = [];
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(now: number): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && (this.hits[0] as number) <= cutoff) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
