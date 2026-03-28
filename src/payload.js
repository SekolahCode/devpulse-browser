export function buildFromError(error, options = {}) {
  const chain = buildErrorChain(error);
  return {
    level: "error",
    exception: chain[0],
    // Include nested causes when present (e.g. new Error('x', { cause: e }))
    ...(chain.length > 1 ? { exception_chain: chain.slice(1) } : {}),
    context: buildContext(),
    request: buildRequest(),
    user: options.user ?? null,
    platform: "browser",
    timestamp: new Date().toISOString(),
  };
}

export function buildFromMessage(message, level = "info", options = {}) {
  return {
    level,
    message,
    context: buildContext(),
    request: buildRequest(),
    user: options.user ?? null,
    platform: "browser",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a single combined vitals event for one page load.
 * All metrics are nested under context.vitals so the message stays
 * constant ("Performance vitals") and all events group into one issue.
 *
 * @param {object} vitals — e.g. { lcp: 156, ttfb: 59, page_load: 820, inp: 120, cls: 0.01 }
 */
export function buildFromVitals(vitals) {
  return {
    level: "info",
    message: "Performance vitals",
    context: {
      ...buildContext(),
      vitals,
    },
    request: buildRequest(),
    platform: "browser",
    timestamp: new Date().toISOString(),
  };
}

// ── Stack parsing ─────────────────────────────────────────────────────────

const CHROME_FULL = /at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/;
const CHROME_ANON = /^at\s+(.*?):(\d+):(\d+)$/;
const SAFARI = /^(.*?)@(.*?):(\d+):(\d+)$/;

function parseStackLine(trimmed) {
  let m = trimmed.match(CHROME_FULL);
  if (m) {
    return {
      function: m[1] ?? null,
      file: m[2] ?? null,
      line: parseInt(m[3]) || null,
      column: parseInt(m[4]) || null,
    };
  }

  m = trimmed.match(CHROME_ANON);
  if (m) {
    return {
      function: null,
      file: m[1] ?? null,
      line: parseInt(m[2]) || null,
      column: parseInt(m[3]) || null,
    };
  }

  m = trimmed.match(SAFARI);
  if (m) {
    return {
      function: m[1] || null,
      file: m[2] ?? null,
      line: parseInt(m[3]) || null,
      column: parseInt(m[4]) || null,
    };
  }

  return { raw: trimmed };
}

function isDevPulseFrame(file) {
  return /devpulse\.(umd|es|min)\.js/.test(file ?? "");
}

function parseStack(stack) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1)
    .map((line) => parseStackLine(line.trim()))
    .filter((f) => (f.file || f.raw) && !isDevPulseFrame(f.file));
}

/**
 * Recursively unwrap Error.cause chains into a flat array.
 * Stops at non-Error causes or circular references.
 */
function buildErrorChain(error, seen = new Set()) {
  if (!error || seen.has(error)) return [];
  seen.add(error);
  const entry = {
    type: error.name ?? "Error",
    message: error.message ?? String(error),
    stacktrace: parseStack(error.stack),
  };
  const rest =
    error.cause instanceof Error ? buildErrorChain(error.cause, seen) : [];
  return [entry, ...rest];
}

// ── Context builders ──────────────────────────────────────────────────────

function buildContext() {
  if (typeof window === "undefined") return {};
  const ctx = {
    url: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
  };
  // Network Information API (Chrome/Android)
  const conn = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;
  if (conn) {
    ctx.connection = {
      effectiveType: conn.effectiveType ?? null,
      downlink: conn.downlink ?? null,
      rtt: conn.rtt ?? null,
    };
  }
  return ctx;
}

function buildRequest() {
  if (typeof window === "undefined") return null;
  return {
    url: window.location.href,
    method: "GET",
    referrer: document.referrer || null,
  };
}
