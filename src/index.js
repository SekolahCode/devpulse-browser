import {
  buildFromError,
  buildFromMessage,
  buildFromPerformance,
} from "./payload.js";
import { Transport } from "./transport.js";

class DevPulseClient {
  constructor() {
    this.transport = null;
    this.config = {};
    this.user = null;
    this._installed = false;
  }

  init(config = {}) {
    if (!config.dsn) {
      console.warn("[DevPulse] DSN is required");
      return;
    }

    this.config = {
      dsn: config.dsn,
      environment: config.environment ?? "production",
      release: config.release ?? null,
      enabled: config.enabled ?? true,
      trackVitals: config.trackVitals ?? true,
      tracesSampleRate: config.tracesSampleRate ?? 1.0,
    };

    this.transport = new Transport(this.config.dsn);

    if (!this.config.enabled) return;

    this._installHandlers();
    if (this.config.trackVitals) this._trackWebVitals();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  capture(error, extra = {}) {
    if (!this.transport || !this.config.enabled) return;
    if (Math.random() > this.config.tracesSampleRate) return;
    this.transport.send({
      ...buildFromError(error),
      ...extra,
      // Core identity fields always win over anything in extra
      user: this.user,
      environment: this.config.environment,
      release: this.config.release,
    });
  }

  captureMessage(message, level = "info") {
    if (!this.transport || !this.config.enabled) return;
    if (Math.random() > this.config.tracesSampleRate) return;
    this.transport.send({
      ...buildFromMessage(message, level),
      user: this.user,
      environment: this.config.environment,
      release: this.config.release,
    });
  }

  setUser(user) {
    this.user = user; // { id, email, name }
  }

  clearUser() {
    this.user = null;
  }

  // ── Error Handlers ────────────────────────────────────────────────────────
  _installHandlers() {
    if (this._installed) return;
    this._installed = true;

    // Uncaught JS errors
    window.addEventListener("error", (event) => {
      this.capture(event.error ?? new Error(event.message), {
        context: {
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        },
      });
    });

    // Unhandled Promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason));
      this.capture(error, { context: { type: "unhandledrejection" } });
    });
  }

  // ── Core Web Vitals ───────────────────────────────────────────────────────
  _trackWebVitals() {
    if (!("PerformanceObserver" in window)) return;

    // LCP — Largest Contentful Paint
    this._observe("largest-contentful-paint", (entries) => {
      const lcp = entries[entries.length - 1];
      this.transport.send(buildFromPerformance("LCP", lcp.startTime));
    });

    // FID — First Input Delay
    this._observe("first-input", (entries) => {
      const fid = entries[0];
      this.transport.send(
        buildFromPerformance("FID", fid.processingStart - fid.startTime),
      );
    });

    // CLS — Cumulative Layout Shift (unitless score 0–1, NOT milliseconds)
    let clsValue = 0;
    this._observe("layout-shift", (entries) => {
      entries.forEach((entry) => {
        if (!entry.hadRecentInput) clsValue += entry.value;
      });
    });

    window.addEventListener("pagehide", () => {
      if (clsValue > 0) {
        this.transport.send(buildFromPerformance("CLS", clsValue, { unit: "" }));
      }
    });

    // TTFB — Time to First Byte
    window.addEventListener("load", () => {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        this.transport.send(buildFromPerformance("TTFB", nav.responseStart));
        this.transport.send(buildFromPerformance("PageLoad", nav.loadEventEnd));
      }
    });
  }

  _observe(type, callback) {
    try {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries());
      });
      observer.observe({ type, buffered: true });
    } catch (e) {
      // Browser doesn't support this metric — silently skip
    }
  }
}

// Export singleton
export const DevPulse = new DevPulseClient();
export default DevPulse;

// Auto-init from script tag data attributes
// <script src="devpulse.umd.js" data-dsn="..." data-env="production"></script>
if (typeof document !== "undefined") {
  const script = document.currentScript;
  if (script?.dataset?.dsn) {
    DevPulse.init({
      dsn: script.dataset.dsn,
      environment: script.dataset.env ?? "production",
      release: script.dataset.release ?? null,
    });
  }
}
