export class Transport {
  constructor(dsn, options = {}) {
    // DSN format: https://<host>/api/ingest/<api_key>
    // Extract the key and build the endpoint URL so the key is sent as a header
    // rather than embedded in the URL path (prevents leakage in server logs).
    const parsed = Transport._parseDsn(dsn);
    this.endpoint = parsed.endpoint;
    this.apiKey   = parsed.apiKey;
    this.timeout  = options.timeout ?? 5000;
    this._pending = new Set();
  }

  static _parseDsn(dsn) {
    try {
      const url = new URL(dsn);
      const parts = url.pathname.split("/");
      const apiKey = parts[parts.length - 1];
      url.pathname = parts.slice(0, -1).join("/");
      return { endpoint: url.toString(), apiKey };
    } catch {
      return { endpoint: dsn, apiKey: "" };
    }
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

    const p = fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
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
