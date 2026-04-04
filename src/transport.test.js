import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Transport } from "./transport.js";

describe("Transport", () => {
  let transport;
  let fetchMock;

  beforeEach(() => {
    // DSN includes the API key as the last path segment; Transport extracts it
    // and POSTs to /api/ingest with X-API-Key header instead.
    transport = new Transport("https://example.com/api/ingest/testapikey");
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Request shape ──────────────────────────────────────────────────────────

  it("POSTs to the ingest endpoint (DSN minus the API key segment)", () => {
    transport.send({ level: "error" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/api/ingest");
  });

  it("sends the API key as X-API-Key header, not in the URL", () => {
    transport.send({ level: "error" });

    const [url, { headers }] = fetchMock.mock.calls[0];
    expect(url).not.toContain("testapikey");
    expect(headers["X-API-Key"]).toBe("testapikey");
  });

  it("sends with keepalive: true and credentials: omit", () => {
    transport.send({ level: "error" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.keepalive).toBe(true);
    expect(options.credentials).toBe("omit");
  });

  it("sets Content-Type: application/json", () => {
    transport.send({ level: "error" });

    const [, { headers }] = fetchMock.mock.calls[0];
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("serializes payload as JSON", () => {
    const payload = { level: "error", message: "boom", user: { id: "u1" } };
    transport.send(payload);

    const [, { body }] = fetchMock.mock.calls[0];
    expect(body).toBe(JSON.stringify(payload));
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it("attaches an AbortSignal to every request", () => {
    transport.send({ level: "error" });

    const [, { signal }] = fetchMock.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("returns true synchronously", () => {
    expect(transport.send({ level: "error" })).toBe(true);
  });

  // ── Timeout ────────────────────────────────────────────────────────────────

  describe("request timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("aborts after the default 5000ms", () => {
      fetchMock.mockReturnValue(new Promise(() => {})); // hangs forever
      transport.send({ level: "error" });

      const [, { signal }] = fetchMock.mock.calls[0];
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(4999);
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
    });

    it("respects a custom timeout option", () => {
      const fast = new Transport("https://example.com/api/ingest/testapikey", { timeout: 1000 });
      fetchMock.mockReturnValue(new Promise(() => {}));
      fast.send({ level: "error" });

      const [, { signal }] = fetchMock.mock.calls[0];
      vi.advanceTimersByTime(999);
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
    });
  });

  it("clears the timer when fetch resolves before timeout", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers() });

    transport.send({ level: "error" });
    // Three flushes: .then(), .catch(), .finally()
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(clearSpy).toHaveBeenCalled();
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it("does not throw when fetch rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(() => transport.send({ level: "error" })).not.toThrow();
    // flush microtasks — should not produce an unhandled rejection
    await Promise.resolve();
  });

  it("does not throw when fetch rejects with an abort error", async () => {
    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    expect(() => transport.send({ level: "error" })).not.toThrow();
    await Promise.resolve();
  });

  // ── Retry logic ────────────────────────────────────────────────────────────

  describe("retry behaviour", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries once after 1s on a 5xx response", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers() })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

      transport.send({ level: "error" });
      await Promise.resolve(); // flush .then()

      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on a 4xx response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, headers: new Headers() });

      transport.send({ level: "error" });
      await Promise.resolve();

      vi.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries after Retry-After seconds on a 429 response", async () => {
      const headers = new Headers({ "Retry-After": "2" });
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, headers })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

      transport.send({ level: "error" });
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Should NOT retry before Retry-After elapses
      vi.advanceTimersByTime(1999);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Should retry after 2000ms (Retry-After: 2)
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("falls back to 60s delay when 429 has no Retry-After header", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

      transport.send({ level: "error" });
      await Promise.resolve();

      vi.advanceTimersByTime(59999);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
