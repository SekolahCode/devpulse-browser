import {
  buildFromError,
  buildFromMessage,
  buildFromVitals,
} from "./payload.js";
import { Transport } from "./transport.js";

function generateSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
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
    this._lastError = null; // { hash, time } — for deduplication
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
      maxBreadcrumbs: config.maxBreadcrumbs ?? 20,
      // beforeSend(event) → return modified event, null/false to drop, or a Promise of those
      beforeSend: config.beforeSend ?? null,
    };

    this.transport = new Transport(this.config.dsn);

    this._sessionId = this._getOrCreateSession();
    this._sampled = this._getSessionSampled(this.config.tracesSampleRate);

    if (!this.config.enabled) return;

    this._installHandlers();
    if (this.config.trackVitals) this._trackWebVitals();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async capture(error, extra = {}) {
    if (!this.transport || !this.config.enabled || !this._sampled) return;

    // Deduplicate: drop the same error if it fires again within 2 s
    const hash = `${error?.name}:${error?.message}:${String(error?.stack ?? "").split("\n")[1] ?? ""}`;
    const now = Date.now();
    if (this._lastError && this._lastError.hash === hash && now - this._lastError.time < 2000) {
      return;
    }
    this._lastError = { hash, time: now };

    let payload = {
      ...buildFromError(error),
      ...extra,
      user: this.user,
      environment: this.config.environment,
      release: this.config.release,
      session_id: this._sessionId,
      breadcrumbs: [...this._breadcrumbs],
    };

    if (this.config.beforeSend) {
      payload = await this.config.beforeSend(payload);
      if (!payload) return;
    }

    this.transport.send(payload);
  }

  async captureMessage(message, level = "info", extra = {}) {
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
      payload = await this.config.beforeSend(payload);
      if (!payload) return;
    }

    this.transport.send(payload);
  }

  setUser(user) {
    this.user = user;
  }

  clearUser() {
    this.user = null;
  }

  addBreadcrumb(crumb) {
    this._breadcrumbs.push({ timestamp: new Date().toISOString(), ...crumb });
    const max = this.config.maxBreadcrumbs ?? 20;
    if (this._breadcrumbs.length > max) {
      this._breadcrumbs.shift();
    }
  }

  /** Wait for all in-flight requests to settle (or timeout). */
  flush(timeout = 5000) {
    if (!this.transport) return Promise.resolve();
    return this.transport.flush(timeout);
  }

  /** Disconnect all PerformanceObservers and unmark installed. */
  close() {
    for (const observer of this._observers) {
      try { observer.disconnect(); } catch {}
    }
    this._observers = [];
    this._installed = false;
  }

  // ── Error Handlers ────────────────────────────────────────────────────────

  _installHandlers() {
    if (this._installed) return;
    this._installed = true;

    window.addEventListener("error", (event) => {
      this.addBreadcrumb({ category: "error", message: event.message, level: "error" });
      this.capture(event.error ?? new Error(event.message), {
        context: { filename: event.filename, line: event.lineno, column: event.colno },
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const error =
        event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      this.addBreadcrumb({ category: "error", message: error.message, level: "error" });
      this.capture(error, { context: { type: "unhandledrejection" } });
    });

    this._installBreadcrumbs();
  }

  // ── Breadcrumbs ───────────────────────────────────────────────────────────

  _installBreadcrumbs() {
    const self = this;

    // Click trail — walk up DOM to the most meaningful element
    document.addEventListener(
      "click",
      (e) => {
        const t =
          e.target?.closest?.("button, a, input, select, textarea, [role], [aria-label], [id]") ??
          e.target;
        const label =
          t?.getAttribute?.("aria-label") ||
          (t?.id ? `#${t.id}` : null) ||
          t?.textContent?.trim()?.slice(0, 40) ||
          t?.tagName?.toLowerCase();
        self.addBreadcrumb({ category: "ui.click", message: label ?? "?" });
      },
      { capture: true, passive: true },
    );

    // SPA navigation — popstate (back/forward) + pushState (router.push)
    window.addEventListener("popstate", () => {
      self.addBreadcrumb({
        category: "navigation",
        message: window.location.pathname,
        data: { to: window.location.href },
      });
    });

    const origPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
      origPushState(...args);
      self.addBreadcrumb({
        category: "navigation",
        message: window.location.pathname,
        data: { to: window.location.href },
      });
    };

    // Console trail
    for (const level of ["log", "info", "warn", "error"]) {
      const original = console[level].bind(console);
      // eslint-disable-next-line no-console
      console[level] = (...args) => {
        self.addBreadcrumb({
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
          level: this.status >= 400 ? "warning" : "info",
        });
      });
      origSend.apply(this, arguments);
    };

    // Fetch trail — skip DevPulse's own ingest requests to avoid loops
    const dsn = self.config.dsn;
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url ?? "";
      const method = (init?.method ?? "GET").toUpperCase();

      // Don't breadcrumb our own transport calls
      if (url && dsn && url.startsWith(dsn)) {
        return origFetch(input, init);
      }

      try {
        const res = await origFetch(input, init);
        self.addBreadcrumb({
          category: "fetch",
          message: `${method} ${url}`,
          data: { status_code: res.status },
          level: res.status >= 400 ? "warning" : "info",
        });
        return res;
      } catch (err) {
        self.addBreadcrumb({
          category: "fetch",
          message: `${method} ${url}`,
          data: { status_code: 0 },
          level: "error",
        });
        throw err;
      }
    };
  }

  // ── Core Web Vitals ───────────────────────────────────────────────────────

  _trackWebVitals() {
    if (!("PerformanceObserver" in window)) return;

    // Accumulate all metrics; send ONE combined event per page load.
    // Keeping the message constant ("Performance vitals") means all page loads
    // group into a single issue instead of flooding the list.
    const vitals = {};
    let sent = false;

    const sendVitals = () => {
      if (sent || Object.keys(vitals).length === 0) return;
      sent = true;
      const payload = {
        ...buildFromVitals(vitals),
        environment: this.config.environment,
        release: this.config.release,
        session_id: this._sessionId,
      };
      this.transport.send(payload);
    };

    // LCP — only the final value before page hides
    let latestLcp = null;
    this._observe("largest-contentful-paint", (entries) => {
      latestLcp = entries[entries.length - 1];
    });

    // INP — worst interaction on the page
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

    // CLS — cumulative score (unitless 0–1)
    let clsValue = 0;
    this._observe("layout-shift", (entries) => {
      for (const entry of entries) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
    });

    // TTFB + PageLoad — read after load event ends so loadEventEnd is non-zero
    window.addEventListener("load", () => {
      // loadEventEnd is 0 when read synchronously inside the load handler;
      // defer by one task so the browser has time to stamp the end time.
      setTimeout(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) {
          vitals.ttfb = Math.round(nav.responseStart);
          const load = Math.round(nav.loadEventEnd);
          if (load > 0) vitals.page_load = load;
        }
      }, 0);
    });

    // Flush all accumulated vitals on page hide / tab switch
    const onHide = () => {
      if (latestLcp) vitals.lcp = Math.round(latestLcp.startTime);
      if (inpValue > 0) vitals.inp = Math.round(inpValue);
      if (clsValue > 0) vitals.cls = +Number(clsValue).toFixed(4);
      sendVitals();
    };

    window.addEventListener("pagehide", onHide, { once: true });
    document.addEventListener(
      "visibilitychange",
      () => { if (document.visibilityState === "hidden") onHide(); },
      { once: true },
    );
  }

  _observe(type, callback, observeOptions = {}) {
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
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
      return generateSessionId();
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

export const DevPulse = new DevPulseClient();
export default DevPulse;

// Auto-init from script tag data attributes
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
