export function buildFromError(error, options = {}) {
  return {
    level: "error",
    exception: {
      type: error.name ?? "Error",
      message: error.message ?? String(error),
      stacktrace: parseStack(error.stack),
    },
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

// unit defaults to "ms" for timing metrics; pass { unit: "" } for unitless
// scores like CLS which are in the 0–1 range, not milliseconds.
export function buildFromPerformance(name, value, options = {}) {
  const unit = options.unit ?? "ms";
  const displayValue =
    unit === "ms" ? Math.round(value) : +Number(value).toFixed(4);
  return {
    level: "info",
    message: `Performance: ${name} = ${displayValue}${unit}`,
    context: {
      ...buildContext(),
      performance: { name, value: displayValue, unit },
    },
    request: buildRequest(),
    platform: "browser",
    timestamp: new Date().toISOString(),
  };
}

const CHROME_FULL = /at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/;
const CHROME_ANON = /^at\s+(.*?):(\d+):(\d+)$/;
const SAFARI = /^(.*?)@(.*?):(\d+):(\d+)$/;

function parseStackLine(trimmed) {
  // Chrome/Edge/Node: "at functionName (file.js:10:5)"
  let m = trimmed.match(CHROME_FULL);
  if (m) {
    return {
      function: m[1] ?? null,
      file: m[2] ?? null,
      line: parseInt(m[3]) || null,
      column: parseInt(m[4]) || null,
    };
  }

  // Chrome anonymous/arrow: "at file.js:10:5"
  m = trimmed.match(CHROME_ANON);
  if (m) {
    return {
      function: null,
      file: m[1] ?? null,
      line: parseInt(m[2]) || null,
      column: parseInt(m[3]) || null,
    };
  }

  // Safari/Firefox: "functionName@file.js:10:5" or "@file.js:10:5"
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
  // Strip frames from the SDK bundle itself so they don't pollute traces
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

function buildContext() {
  if (typeof window === "undefined") return {};
  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
  };
}

function buildRequest() {
  if (typeof window === "undefined") return null;
  return {
    url: window.location.href,
    method: "GET",
    referrer: document.referrer || null,
  };
}
