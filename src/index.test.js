import { describe, it, expect, beforeEach } from "vitest";
import {
  buildFromError,
  buildFromMessage,
  buildFromPerformance,
} from "./payload.js";

describe("buildFromError", () => {
  it("builds a valid error payload", () => {
    const err = new Error("test error");
    const payload = buildFromError(err);

    expect(payload.level).toBe("error");
    expect(payload.exception.type).toBe("Error");
    expect(payload.exception.message).toBe("test error");
    expect(payload.platform).toBe("browser");
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("falls back to 'Error' when error.name is missing", () => {
    const payload = buildFromError({ message: "oops", stack: null });
    expect(payload.exception.type).toBe("Error");
  });

  it("parses named function stack frames (Chrome format)", () => {
    const err = new Error("boom");
    err.stack = [
      "Error: boom",
      "  at myFunction (http://localhost/app.js:10:5)",
      "  at anotherFn (http://localhost/app.js:20:3)",
    ].join("\n");

    const { stacktrace } = buildFromError(err).exception;
    expect(stacktrace[0]).toEqual({
      function: "myFunction",
      file: "http://localhost/app.js",
      line: 10,
      column: 5,
    });
  });

  it("parses anonymous/arrow function stack frames (Chrome)", () => {
    const err = new Error("boom");
    err.stack = ["Error: boom", "  at http://localhost/app.js:10:5"].join("\n");

    const { stacktrace } = buildFromError(err).exception;
    expect(stacktrace[0]).toEqual({
      function: null,
      file: "http://localhost/app.js",
      line: 10,
      column: 5,
    });
  });

  it("parses Safari/Firefox stack format (named function)", () => {
    const err = new Error("boom");
    err.stack = [
      "Error: boom",
      "myFunction@http://localhost/app.js:10:5",
      "anotherFn@http://localhost/app.js:20:3",
    ].join("\n");

    const { stacktrace } = buildFromError(err).exception;
    expect(stacktrace[0]).toEqual({
      function: "myFunction",
      file: "http://localhost/app.js",
      line: 10,
      column: 5,
    });
  });

  it("parses Safari/Firefox stack format (anonymous — leading @)", () => {
    const err = new Error("boom");
    err.stack = ["Error: boom", "@http://localhost/app.js:10:5"].join("\n");

    const { stacktrace } = buildFromError(err).exception;
    expect(stacktrace[0]).toEqual({
      function: null,
      file: "http://localhost/app.js",
      line: 10,
      column: 5,
    });
  });

  it("filters out DevPulse SDK frames from the stacktrace", () => {
    const err = new Error("boom");
    err.stack = [
      "Error: boom",
      "  at capture (http://localhost/devpulse.umd.js:1:100)",
      "  at userCode (http://localhost/app.js:5:10)",
    ].join("\n");

    const { stacktrace } = buildFromError(err).exception;
    // SDK frame should be stripped; only user frame remains
    expect(stacktrace).toHaveLength(1);
    expect(stacktrace[0].file).toContain("app.js");
  });

  it("returns empty stacktrace when stack is missing", () => {
    const err = new Error("no stack");
    err.stack = null;
    const payload = buildFromError(err);
    expect(payload.exception.stacktrace).toEqual([]);
  });
});

describe("buildFromMessage", () => {
  it("builds a valid message payload", () => {
    const payload = buildFromMessage("hello", "warning");
    expect(payload.level).toBe("warning");
    expect(payload.message).toBe("hello");
    expect(payload.platform).toBe("browser");
  });

  it("defaults level to info", () => {
    const payload = buildFromMessage("test");
    expect(payload.level).toBe("info");
  });
});

describe("buildFromPerformance", () => {
  it("rounds ms timing values to whole numbers", () => {
    const payload = buildFromPerformance("LCP", 1234.56);
    expect(payload.context.performance.value).toBe(1235);
    expect(payload.context.performance.unit).toBe("ms");
    expect(payload.message).toBe("Performance: LCP = 1235ms");
  });

  it("preserves 4 decimal places for unitless scores (CLS)", () => {
    const payload = buildFromPerformance("CLS", 0.1234, { unit: "" });
    expect(payload.context.performance.unit).toBe("");
    expect(payload.context.performance.value).toBe(0.1234);
    expect(payload.message).toBe("Performance: CLS = 0.1234");
  });

  it("includes context and request", () => {
    const payload = buildFromPerformance("TTFB", 200);
    expect(payload.context).toHaveProperty("url");
    expect(payload.request).toHaveProperty("url");
  });

  it("request includes method and referrer fields", () => {
    const payload = buildFromMessage("test");
    expect(payload.request).toHaveProperty("method");
    expect(payload.request).toHaveProperty("referrer");
  });
});
