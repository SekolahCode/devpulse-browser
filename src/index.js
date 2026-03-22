import {
  buildFromError,
  buildFromMessage,
  buildFromPerformance,
} from "./payload.js";
import { Transport } from "./transport.js";

const BREADCRUMB_LIMIT = 20;

function generateSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

class DevPulseClient {
  constructor() {
    this.transport = null;
    this.config = {};
    this.user = null;
    this._installed = false;
    this._breadcrumbs = [];
    this._observers = [];
    this._sessionId = null;
    this._sampled = null;
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
      // beforeSend(event) → return modified event or null/false to drop it
      beforeSend: config.beforeSend ?? null,
    };

    this.transport = new Transport(this.config.dsn);

    // Session ID persists across page loads within the same browser tab
    this._sessionId = this._getOrCreateSession();
    // Sampling is decided once per session so consistent across all events
    this._sampled = this._getSessionSampled(this.config.tracesSampleRate);

    if (!this.config.enabled) return;

    this._installHandlers();
    if (this.config.trackVitals) this._trackWebVitals();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  capture(error, extra = {}) {
    if (!this.transport || !this.config.enabled || !this._sampled) return;

    let payload = {
      ...buildFromError(error),
      ...extra,
      // Core identity fields always win over anything in extra
      user: this.user,
      environment: this.config.environment,
      release: this.config.release,
      session_id: this._sessionId,
      breadcrumbs: [...this._breadcrumbs],
    };

    if (this.config.beforeSend) {
      payload = this.config.beforeSend(payload);
      if (!payload) return; // null/false → drop the event
    }

    this.transport.send(payload);
  }

  captureMessage(message, level = "info", extra = {}) {
    if (!this.transport || !this.config.enabled || !this._sampled) return;

    let payload = {
      ...buildFromMessage(message, level),
      ...extra,
      user: this.user,
      environment: this.config.environment,
      release: this.config.release,
      session_id: this._sessionId,
      breadcrumbs: [...this._breadcrumbs],
    };

    if (this.config.beforeSend) {
      payload = this.config.beforeSend(payload);
      if (!payload) return;
    }

    this.transport.send(payload);
  }

  setUser(user) {
    this.user = user; // { id, email, name }
  }

  clearUser() {
    this.user = null;
  }

  addBreadcrumb(crumb) {
    this._breadcrumbs.push({ timestamp: new Date().toISOString(), ...crumb });
    if (this._breadcrumbs.length > BREADCRUMB_LIMIT) {
      this._breadcrumbs.shift();
    }
  }

  // ── Error Handlers ────────────────────────────────────────────────────────

  _installHandlers() {
    if (this._installed) return;
    this._installed = true;

    // Uncaught JS errors
    window.addEventListener("error", (event) => {
      this.addBreadcrumb({
        category: "error",
        message: event.message,
        level: "error",
      });
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
      this.addBreadcrumb({
        category: "error",
        message: error.message,
        level: "error",
      });
      this.capture(error, { context: { type: "unhandledrejection" } });
    });

    this._installBreadcrumbs();
  }

  // ── Breadcrumbs ───────────────────────────────────────────────────────────

  _installBreadcrumbs() {
    // Click trail
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        const label =
          t?.getAttribute?.("aria-label") ||
          (t?.id ? `#${t.id}` : null) ||
          t?.tagName?.toLowerCase();
        this.addBreadcrumb({ category: "ui.click", message: label ?? "?" });
      },
      { capture: true, passive: true },
    );

    // SPA navigation trail
    window.addEventListener("popstate", () => {
      this.addBreadcrumb({
        category: "navigation",
        message: window.location.pathname,
        data: { to: window.location.href },
      });
    });

    // Console trail — wrap each level
    for (const level of ["log", "info", "warn", "error"]) {
      const original = console[level].bind(console);
      // eslint-disable-next-line no-console
      console[level] = (...args) => {
        this.addBreadcrumb({
          category: "console",
          level,
          message: args.map(String).join(" ").slice(0, 200),
        });
        original(...args);
      };
    }

    // XHR trail
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__dp_method = method;
      this.__dp_url = url;
      origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("loadend", () => {
        self.addBreadcrumb({
          category: "xhr",
          message: `${this.__dp_method ?? "?"} ${this.__dp_url ?? "?"}`,
          data: { status_code: this.status },
        });
      });
      origSend.apply(this, arguments);
    };
  }

  // ── Core Web Vitals ───────────────────────────────────────────────────────

  _trackWebVitals() {
    if (!("PerformanceObserver" in window)) return;

    // LCP — only report the final value (intermediate entries are superseded)
    let latestLcp = null;
    this._observe("largest-contentful-paint", (entries) => {
      latestLcp = entries[entries.length - 1];
    });

    const sendLcp = () => {
      if (latestLcp) {
        this.transport.send(buildFromPerformance("LCP", latestLcp.startTime));
        latestLcp = null;
      }
    };
    window.addEventListener("pagehide", sendLcp, { once: true });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") sendLcp();
      },
      { once: true },
    );

    // INP — Interaction to Next Paint (2024 Core Web Vital, replaces FID)
    // entry.duration = time from input start to next display frame
    let inpValue = 0;
    this._observe(
      "event",
      (entries) => {
        for (const entry of entries) {
          if (entry.duration > inpValue) inpValue = entry.duration;
        }
      },
      { durationThreshold: 40 },
    );
    window.addEventListener("pagehide", () => {
      if (inpValue > 0) {
        this.transport.send(buildFromPerformance("INP", inpValue));
      }
    });

    // CLS — Cumulative Layout Shift (unitless score 0–1, NOT milliseconds)
    let clsValue = 0;
    this._observe("layout-shift", (entries) => {
      for (const entry of entries) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
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

  _observe(type, callback, observeOptions = {}) {
    try {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries());
      });
      observer.observe({ type, buffered: true, ...observeOptions });
      this._observers.push(observer);
    } catch {
      // Browser doesn't support this metric — silently skip
    }
  }

  // ── Session helpers ───────────────────────────────────────────────────────

  _getOrCreateSession() {
    try {
      const key = "__dp_sid";
      let sid = sessionStorage.getItem(key);
      if (!sid) {
        sid = generateSessionId();
        sessionStorage.setItem(key, sid);
      }
      return sid;
    } catch {
      return generateSessionId(); // sessionStorage blocked (e.g. private mode)
    }
  }

  _getSessionSampled(rate) {
    if (rate >= 1.0) return true;
    if (rate <= 0) return false;
    try {
      const key = "__dp_sampled";
      const stored = sessionStorage.getItem(key);
      if (stored !== null) return stored === "1";
      const sampled = Math.random() < rate;
      sessionStorage.setItem(key, sampled ? "1" : "0");
      return sampled;
    } catch {
      return Math.random() < rate;
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
