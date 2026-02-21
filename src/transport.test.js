import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Transport } from "./transport.js";

describe("Transport", () => {
  let transport;
  let fetchMock;

  beforeEach(() => {
    transport = new Transport("https://example.com/ingest");
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Request shape ──────────────────────────────────────────────────────────

  it("POSTs to the DSN", () => {
    transport.send({ level: "error" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/ingest");
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
      const fast = new Transport("https://example.com/ingest", { timeout: 1000 });
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
    fetchMock.mockResolvedValue({ ok: true });

    transport.send({ level: "error" });
    // Two flushes: one for .catch(), one for .finally()
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
});
