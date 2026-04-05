# @sekolahcode/devpulse-browser

Zero-dependency browser SDK for DevPulse — frontend error tracking and Core Web Vitals monitoring.

## Requirements

- A running DevPulse server (v1.0+)
- Any modern browser (ES2017+)

## Installation

### Via npm

```bash
npm install @sekolahcode/devpulse-browser
```

```js
import { DevPulse } from '@sekolahcode/devpulse-browser';

DevPulse.init({
  dsn: 'https://your-devpulse-host/api/ingest/YOUR_API_KEY',
  environment: 'production',
  release: '1.0.0',
});
```

### Via script tag (UMD, auto-init)

```html
<script
  src="https://your-devpulse-host/devpulse.js"
  data-dsn="https://your-devpulse-host/api/ingest/YOUR_API_KEY"
  data-env="production"
  data-release="1.0.0"
></script>
```

After `init()`, uncaught errors and unhandled promise rejections are captured automatically.

## API

### `DevPulse.init(config)`

| Option | Default | Description |
|---|---|---|
| `dsn` | *(required)* | `https://<host>/api/ingest/<api_key>` |
| `environment` | `"production"` | Environment tag attached to every event |
| `release` | `null` | Release/version tag (e.g. `"1.2.3"`) |
| `enabled` | `true` | Enable / disable the SDK globally |
| `trackVitals` | `true` | Auto-track Core Web Vitals |
| `tracesSampleRate` | `1.0` | Fraction of sessions to sample (0.0–1.0) |
| `maxBreadcrumbs` | `20` | Maximum breadcrumbs retained per event |
| `captureQueryStrings` | `false` | Include query strings in XHR/fetch breadcrumb URLs |
| `beforeSend` | `null` | Hook to inspect, modify, or drop events before sending |

### `DevPulse.capture(error, extra?)`

```js
try {
  await riskyOperation();
} catch (err) {
  DevPulse.capture(err, { orderId: 42 });
}
```

### `DevPulse.captureMessage(message, level?)`

```js
DevPulse.captureMessage('Quota approaching', 'warning');
```

### `DevPulse.setUser(user)` / `DevPulse.clearUser()`

```js
DevPulse.setUser({ id: '123', email: 'user@example.com' });
// On logout:
DevPulse.clearUser();
```

### `DevPulse.addBreadcrumb(crumb)`

```js
DevPulse.addBreadcrumb({ category: 'auth', message: 'User logged in', level: 'info' });
```

### `DevPulse.flush(timeout?)` / `DevPulse.close()`

```js
await DevPulse.flush(3000);  // wait for in-flight requests
DevPulse.close();            // disconnect PerformanceObservers
```

### `beforeSend` hook

Return `null` or `false` to drop an event entirely.

```js
DevPulse.init({
  dsn: '...',
  beforeSend(event) {
    if (event.user?.email?.endsWith('@internal.example.com')) return null;
    return event;
  },
});
```

## Breadcrumbs

Automatically tracked:

| Category | Trigger |
|---|---|
| `ui.click` | User clicks — walks up the DOM to the most meaningful element |
| `navigation` | `popstate` and `history.pushState` (SPA routing) |
| `console` | `console.log/info/warn/error` |
| `xhr` | XMLHttpRequest completions |
| `fetch` | `fetch()` completions |

Query strings are stripped from XHR/fetch URLs by default to avoid capturing tokens or PII. Set `captureQueryStrings: true` to preserve them.

## Core Web Vitals

When `trackVitals: true` (default), one vitals event is sent on page hide:

| Metric | Description |
|---|---|
| `lcp` | Largest Contentful Paint (ms) |
| `inp` | Interaction to Next Paint (ms) |
| `cls` | Cumulative Layout Shift (0–1) |
| `ttfb` | Time to First Byte (ms) |
| `page_load` | Total page load time (ms) |

## Development

```bash
npm install
npm run dev      # watch build
npm test         # vitest
npm run lint     # eslint
npm run format   # prettier
npm run build    # production build
```

## License

MIT — see [LICENSE](../../LICENSE)
