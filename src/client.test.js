/**
 * Tests for DevPulseClient behaviour:
 * - Error deduplication
 * - Session sampling
 * - DSN validation (SSRF guard)
 * - Fetch breadcrumb URL redaction
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DevPulseClient } from "./index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(configOverrides = {}) {
  const client = new DevPulseClient();
  const sends = [];

  // Stub transport so we can inspect outgoing payloads without network calls
  client.init({
    dsn: "https://example.com/api/ingest/abc123def456abc123def456abc12345",
    enabled: true,
    ...configOverrides,
  });

  if (client.transport) {
    client.transport.send = (payload) => { sends.push(payload); };
  }

  return { client, sends };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("error deduplication", () => {
  it("drops an identical error fired within 2 seconds", async () => {
    const { client, sends } = makeClient();
    const err = new Error("duplicate");

    await client.capture(err);
    await client.capture(err);

    expect(sends).toHaveLength(1);
  });

  it("sends an identical error again after the 2-second window", async () => {
    const { client, sends } = makeClient();
    const err = new Error("slow duplicate");

    await client.capture(err);

    // Fast-forward the dedup timestamp
    client._lastError.time = Date.now() - 3000;

    await client.capture(err);

    expect(sends).toHaveLength(2);
  });

  it("sends two errors with different messages as separate events", async () => {
    const { client, sends } = makeClient();

    await client.capture(new Error("error one"));
    await client.capture(new Error("error two"));

    expect(sends).toHaveLength(2);
  });
});

// ── Sampling ─────────────────────────────────────────────────────────────────

describe("session sampling", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("sends nothing when tracesSampleRate is 0", async () => {
    const { client, sends } = makeClient({ tracesSampleRate: 0 });
    await client.capture(new Error("sampled out"));
    expect(sends).toHaveLength(0);
  });

  it("sends everything when tracesSampleRate is 1", async () => {
    const { client, sends } = makeClient({ tracesSampleRate: 1 });
    await client.capture(new Error("definitely in"));
    expect(sends).toHaveLength(1);
  });

  it("is stable across multiple captures in the same session", async () => {
    // Seed sessionStorage so the decision is deterministic
    sessionStorage.setItem("__dp_sampled", "1");
    const { client, sends } = makeClient({ tracesSampleRate: 0.5 });

    await client.capture(new Error("a"));
    await client.capture(new Error("b"));
    await client.capture(new Error("c"));

    // All three should be sent (sampled = true was pre-seeded)
    expect(sends).toHaveLength(3);
  });
});

// ── DSN validation ────────────────────────────────────────────────────────────

describe("DSN SSRF validation", () => {
  it("rejects a DSN that does not match the /api/ingest/<key> pattern", () => {
    const client = new DevPulseClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    client.init({ dsn: "https://example.com/some/other/path" });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid DSN"));
    expect(client.transport).toBeNull();

    warnSpy.mockRestore();
  });

  it("rejects a DSN pointing at a private IP range", () => {
    const client = new DevPulseClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    client.init({ dsn: "https://192.168.1.100/api/ingest/abc123def456abc123def456abc12345" });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid DSN"));
    expect(client.transport).toBeNull();

    warnSpy.mockRestore();
  });

  it("accepts a valid DSN", () => {
    const client = new DevPulseClient();
    client.init({ dsn: "https://devpulse.example.com/api/ingest/abc123def456abc123def456abc12345" });
    expect(client.transport).not.toBeNull();
  });

  it("accepts a localhost DSN (local development)", () => {
    const client = new DevPulseClient();
    client.init({ dsn: "http://localhost/api/ingest/abc123def456abc123def456abc12345" });
    expect(client.transport).not.toBeNull();
  });
});

// ── URL redaction ─────────────────────────────────────────────────────────────

describe("_sanitizeUrl", () => {
  it("strips query string by default", () => {
    const client = new DevPulseClient();
    client.init({
      dsn: "https://example.com/api/ingest/abc123def456abc123def456abc12345",
    });

    const result = client._sanitizeUrl("https://api.example.com/users?token=secret&page=1");
    expect(result).toBe("https://api.example.com/users");
    expect(result).not.toContain("token");
  });

  it("preserves query string when captureQueryStrings is true", () => {
    const client = new DevPulseClient();
    client.init({
      dsn: "https://example.com/api/ingest/abc123def456abc123def456abc12345",
      captureQueryStrings: true,
    });

    const result = client._sanitizeUrl("https://api.example.com/users?page=1");
    expect(result).toContain("page=1");
  });

  it("strips hash fragment", () => {
    const client = new DevPulseClient();
    client.init({
      dsn: "https://example.com/api/ingest/abc123def456abc123def456abc12345",
    });

    const result = client._sanitizeUrl("https://example.com/page#section");
    expect(result).not.toContain("#section");
  });
});

// ── beforeSend hook ───────────────────────────────────────────────────────────

describe("beforeSend hook", () => {
  it("drops the event when beforeSend returns null", async () => {
    const { client, sends } = makeClient({ beforeSend: () => null });
    await client.capture(new Error("dropped"));
    expect(sends).toHaveLength(0);
  });

  it("drops the event when beforeSend returns false", async () => {
    const { client, sends } = makeClient({ beforeSend: () => false });
    await client.capture(new Error("also dropped"));
    expect(sends).toHaveLength(0);
  });

  it("sends the modified payload returned by beforeSend", async () => {
    const { client, sends } = makeClient({
      beforeSend: (event) => ({ ...event, level: "warning" }),
    });
    await client.capture(new Error("modified"));
    expect(sends[0].level).toBe("warning");
  });
});
