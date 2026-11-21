# @qr-device-flow/element

`<qr-device-login>`: a Web Component that shows a login QR code, follows the challenge, and reports the result. It works in any framework, and it is built on `@qr-device-flow/web`.

```html
<script type="module" src="/node_modules/@qr-device-flow/element/dist/index.js"></script>

<qr-device-login endpoint="/device" transport="sse" qr-size="220" auto-regenerate></qr-device-login>

<script>
  const login = document.querySelector("qr-device-login");
  login.addEventListener("qr-approved", (e) => {
    // e.detail.session.accessToken — send it to your backend or store it as you normally do
  });
  login.addEventListener("qr-error", (e) => console.error(e.detail.message));
</script>
```

Or with a bundler: `import "@qr-device-flow/element";`

## Attributes and properties

| Attribute | Property | Default | Notes |
|---|---|---|---|
| `endpoint` | `endpoint` | — (required) | Base URL of the device-flow server, e.g. `/device` |
| `transport` | `transport` | `sse` | `sse`, `polling` or `websocket` (the server must expose it) |
| `qr-size` | `qrSize` | `220` | Pixels |
| `auto-regenerate` | `autoRegenerate` | off | Start a new login automatically when the code expires |

Changing an attribute restarts the login. Removing the element from the DOM stops it.

## Events

All events bubble and are composed.

| Event | `detail` | When |
|---|---|---|
| `qr-state` | `{ status }` | Every status change: `pending`, `scanned`, `approved`, `denied`, `expired`, `approved-consumed` |
| `qr-approved` | `{ session }` | The login succeeded. The session is only in the event, never in the DOM |
| `qr-error` | `{ message }` | Network or protocol failure. A denial is a `qr-state`, not an error |

## Styling

Use CSS custom properties on the element: `--qr-accent`, `--qr-text`, `--qr-muted`, `--qr-card`, `--qr-radius`, `--qr-ok`, `--qr-warn`, `--qr-error`. Dark mode follows `prefers-color-scheme`.

Parts: `::part(card)`, `::part(qr)`, `::part(code)`, `::part(status)`, `::part(error)`, `::part(retry)`.

## Framework notes

Covered by end-to-end tests in `examples/express-vanilla` (approval, denial, events):

| Framework | Status | Example |
|---|---|---|
| Plain HTML | tested | `public/element.html` |
| React 19 | tested | `src/react-demo.ts` (events attached with `addEventListener`) |
| Vue 3 | tested | `src/vue-demo.ts` (`onQrApproved` listens to `qr-approved`) |
| Next.js 16 (App Router) | tested | `examples/nextjs-element` (client component, element imported in an effect) |
| Svelte, Angular | not tested | Should work through plain DOM events; not verified |

- **SSR (Next.js, Nuxt, etc.):** the module touches `HTMLElement` when it loads, so import it on the client only. In Next.js, import it inside `useEffect`, as the example does. The server renders the tag, and the element upgrades in the browser.
- **React < 19:** custom element props are passed as attributes, so attach callbacks with `addEventListener`.
- **TypeScript:** importing the module adds `<qr-device-login>` to `HTMLElementTagNameMap`.

## Tests

- Unit tests (`packages/element/test`, Vitest + jsdom): registration, attributes and properties, the login flow, auto-regenerate, errors, lifecycle and the SSE transport.
- End-to-end tests (`examples/express-vanilla/e2e`, Playwright): the real server, for the plain HTML, React, Vue and Next.js pages.
