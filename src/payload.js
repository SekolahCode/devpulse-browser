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

function parseStack(stack) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const trimmed = line.trim();

      // "  at functionName (file.js:10:5)"
      const full = trimmed.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/);
      if (full) {
        return {
          function: full[1] ?? null,
          file: full[2] ?? null,
          line: parseInt(full[3]) || null,
          column: parseInt(full[4]) || null,
        };
      }

      // "  at file.js:10:5" (anonymous or arrow functions)
      const short = trimmed.match(/at\s+(.*?):(\d+):(\d+)/);
      if (short) {
        return {
          function: null,
          file: short[1] ?? null,
          line: parseInt(short[2]) || null,
          column: parseInt(short[3]) || null,
        };
      }

      return { raw: trimmed };
    })
    .filter((f) => f.file || f.raw);
}

function buildContext() {
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
  return {
    url: window.location.href,
  };
}
