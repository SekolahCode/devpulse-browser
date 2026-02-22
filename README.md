# @sekolahcode/devpulse-browser

Zero-dependency browser SDK for DevPulse — frontend error tracking and Core Web Vitals monitoring.

## Requirements

- A running DevPulse server
- Any modern browser (ES2017+)

## Installation

### Via script tag (UMD)

```html
<script src="http://localhost:8000/devpulse.js"></script>
<script>
  DevPulse.init({
    dsn: 'http://localhost:8000/api/ingest/YOUR_API_KEY',
    environment: 'production',
    release: '1.0.0',
  });
</script>
```

### Via npm

```bash
npm install @sekolahcode/devpulse-browser
```

```js
import { DevPulse } from '@sekolahcode/devpulse-browser';

DevPulse.init({
  dsn: 'http://localhost:8000/api/ingest/YOUR_API_KEY',
  environment: 'production',
  release: '1.0.0',
});
```

## API

### `DevPulse.init(config)`

| Option              | Default        | Description                                        |
|---------------------|----------------|----------------------------------------------------|
| `dsn`               | *(required)*   | Ingest endpoint URL including your API key         |
| `environment`       | `"production"` | Environment tag attached to every event            |
| `release`           | `null`         | Release/version tag (e.g. `"1.2.3"`)              |
| `enabled`           | `true`         | Enable / disable the SDK globally                  |
| `trackVitals`       | `true`         | Auto-track Core Web Vitals                         |
| `tracesSampleRate`  | `1.0`          | Fraction of events to send (0.0–1.0)               |

After `init()`, uncaught JS errors and unhandled promise rejections are captured automatically.

### `DevPulse.capture(error, extra?)`

Manually capture an `Error` object with optional extra context.

```js
try {
  riskyOperation();
} catch (err) {
  DevPulse.capture(err, { userId: 42 });
}
```

### `DevPulse.captureMessage(message, level?)`

Capture a plain string message. `level` defaults to `"info"`.

```js
DevPulse.captureMessage('Quota limit approaching', 'warning');
```

### `DevPulse.setUser(user)`

Attach user identity to all subsequent events.

```js
DevPulse.setUser({ id: '123', email: 'user@example.com', name: 'Alice' });
```

Call `DevPulse.clearUser()` on logout.

### Core Web Vitals

When `trackVitals: true` (default), the SDK automatically tracks LCP, FID, CLS, FCP, and TTFB using the browser's `PerformanceObserver` API.

## Build

```bash
npm install
npm run build   # outputs dist/devpulse.es.js and dist/devpulse.umd.js
npm test        # run Vitest unit tests
```

## License

MIT — see [LICENSE](../../LICENSE)
