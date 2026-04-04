export interface DevPulseConfig {
  /** Ingest endpoint URL including API key. Required. */
  dsn: string;
  /** Environment tag sent with every event. Default: "production" */
  environment?: string;
  /** Release/version string. Default: null */
  release?: string | null;
  /** Master on/off switch. Default: true */
  enabled?: boolean;
  /** Auto-track Core Web Vitals (LCP, INP, CLS, TTFB, PageLoad). Default: true */
  trackVitals?: boolean;
  /** Fraction of sessions to capture (0.0–1.0). Default: 1.0 */
  tracesSampleRate?: number;
  /** Maximum breadcrumbs kept in memory per session. Default: 20 */
  maxBreadcrumbs?: number;
  /**
   * Called before every event is sent. Return the (optionally modified) event
   * to send it, or return null/false to drop it. May be async.
   */
  beforeSend?: (
    event: DevPulseEvent,
  ) => DevPulseEvent | null | false | Promise<DevPulseEvent | null | false>;
  /**
   * Set to true to include query strings in fetch/XHR breadcrumb URLs.
   * Disabled by default to avoid capturing tokens or PII in query params.
   * Default: false
   */
  captureQueryStrings?: boolean;
}

export interface DevPulseUser {
  id?: string | number;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface DevPulseBreadcrumb {
  /** Dot-namespaced category, e.g. "ui.click", "xhr", "fetch", "console", "navigation" */
  category?: string;
  message?: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
  /** ISO 8601 — added automatically by addBreadcrumb() */
  timestamp?: string;
}

export interface StackFrame {
  function?: string | null;
  file?: string | null;
  line?: number | null;
  column?: number | null;
  /** Raw unparsed frame string (fallback when format is unrecognised) */
  raw?: string;
}

export interface DevPulseException {
  type: string;
  message: string;
  stacktrace: StackFrame[];
}

export interface WebVitals {
  /** Largest Contentful Paint in ms */
  lcp?: number;
  /** Time to First Byte in ms */
  ttfb?: number;
  /** Total page load time in ms */
  page_load?: number;
  /** Interaction to Next Paint in ms */
  inp?: number;
  /** Cumulative Layout Shift score (0–1, unitless) */
  cls?: number;
}

export interface DevPulseEvent {
  level: "error" | "warning" | "info";
  /** Present on error events */
  exception?: DevPulseException;
  /** Chained causes from Error.cause */
  exception_chain?: DevPulseException[];
  /** Present on message events */
  message?: string;
  context?: Record<string, unknown>;
  request?: { url: string; method: string; referrer: string | null } | null;
  user?: DevPulseUser | null;
  platform: string;
  timestamp: string;
  environment?: string;
  release?: string | null;
  session_id?: string;
  breadcrumbs?: DevPulseBreadcrumb[];
  [key: string]: unknown;
}

export declare class DevPulseClient {
  /** Initialise the SDK. Must be called before any other method. */
  init(config: DevPulseConfig): void;

  /**
   * Capture an Error (or any thrown value) and send it to DevPulse.
   * Deduplicates identical errors fired within 2 seconds.
   */
  capture(error: unknown, extra?: Record<string, unknown>): Promise<void>;

  /** Send a plain-text message at the given severity level. */
  captureMessage(
    message: string,
    level?: "error" | "warning" | "info",
    extra?: Record<string, unknown>,
  ): Promise<void>;

  /** Attach user identity to all subsequent events. */
  setUser(user: DevPulseUser | null): void;

  /** Remove previously set user identity. */
  clearUser(): void;

  /** Manually append a breadcrumb to the current trail. */
  addBreadcrumb(crumb: Omit<DevPulseBreadcrumb, "timestamp">): void;

  /**
   * Wait for all in-flight HTTP requests to settle.
   * @param timeout - Max ms to wait. Default: 5000
   */
  flush(timeout?: number): Promise<void>;

  /** Disconnect all PerformanceObservers. Call before unmounting in tests. */
  close(): void;
}

export declare const DevPulse: DevPulseClient;
export default DevPulse;
