export class Transport {
  constructor(dsn, options = {}) {
    this.dsn = dsn;
    this.timeout = options.timeout ?? 5000;
    this._pending = new Set();
  }

  send(payload) {
    this._attempt(JSON.stringify(payload), 0);
    return true;
  }

  /**
   * Wait for all in-flight requests to settle.
   * Resolves early if all requests finish before `timeout` ms.
   */
  flush(timeout = 5000) {
    if (this._pending.size === 0) return Promise.resolve();
    return Promise.race([
      Promise.allSettled([...this._pending]),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
  }

  _attempt(body, attempt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const p = fetch(this.dsn, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
      signal: controller.signal,
    })
      .then((res) => {
        if (attempt === 0) {
          if (res.status === 429) {
            const retryAfter =
              parseInt(res.headers.get("Retry-After") ?? "60", 10) * 1000;
            setTimeout(() => this._attempt(body, 1), retryAfter);
          } else if (res.status >= 500) {
            setTimeout(() => this._attempt(body, 1), 1000);
          }
        }
      })
      .catch(() => {
        if (attempt === 0) {
          setTimeout(() => this._attempt(body, 1), 1000);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        this._pending.delete(p);
      });

    this._pending.add(p);
  }
}
