export class Transport {
  constructor(dsn, options = {}) {
    this.dsn = dsn;
    this.timeout = options.timeout ?? 5000;
  }

  send(payload) {
    const body = JSON.stringify(payload);

    // Use fetch with keepalive (survives page navigation) and credentials omitted
    // — the ingest endpoint authenticates via the API key in the URL, not cookies.
    // sendBeacon is avoided because it always sends credentials, which breaks
    // CORS preflight when the server responds with a specific origin.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    fetch(this.dsn, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return true;
  }
}
