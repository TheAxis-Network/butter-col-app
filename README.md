# butter-col-app

An example app for [butter-col](https://github.com/TheAxis-Network/butter-col), the service-worker web proxy by Axis Network. It's a small browser plus a test bench for the butter-col protocol, written in plain HTML, CSS and JavaScript. There's no framework, no TypeScript and no build step.

It's served by butter-col's own OpenResty server (`butter-col server start --site public`). It drives the proxy only through what that server publishes: `ButterController` from `/butter/controller.mjs`, the formatter from `/butter/formatter.mjs`, and the documented HTTP endpoints.

## What's in it

| Tab | What it shows |
| --- | --- |
| **Browse** | A proxied site in an `<iframe>`, with back, forward, reload, pop-out, and an address bar that follows the page (including single-page apps). Below the toolbar is the live `/butter/go/…` proxy URL. |
| **Test bench** | 19 end-to-end checks, run from the browser (see below). |
| **Formatter** | One URL encoded with all four codecs (`none`, `plain`, `xor`, `base64`) and decoded again, plus a live playground for the HTML, CSS and JavaScript rewriters. |
| **Wire probe** | Sends one raw request to `/butter/fetch` and shows the unwrapped `X-Butter-Status`, `X-Butter-Headers`, `X-Butter-Error` and body. It has presets for redirects, POST bodies, document cookies and every guard error. |
| **About** | How butter-col works, and the security caveats. |

The header shows the service worker's version, the active codec, and a transport picker (`setTransport` / `resetTransport`).

### The test bench

| Area | Checks |
| --- | --- |
| Environment | secure context, `/butter/health`, `/butter/config.js` |
| Service worker | active and answering `butter:version` over a `MessageChannel`; active transport loaded |
| Formatter | 16 codec round trips; `href`, `srcset`, `url()` and `location` rewriting |
| `/butter/fetch` | status and header wrapping, `Cache-Control: no-store`, redirects wrapped instead of followed |
| SSRF guard | `BLOCKED_ADDRESS` (169.254.169.254), `BLOCKED_HOST` (localhost), `BLOCKED_PORT` (:25), `INVALID_URL`, `INVALID_HEADERS` |
| Cookie jar | `POST /butter/cookie`, then read back through `X-Butter-Document-Cookies` (and cleaned up) |
| Proxying | `fetch()` of a proxy URL through the service worker; a hidden proxied `<iframe>` whose runtime reports `location.href` as the real target; the worker's `X-Butter-Error-Code` error responses |
| WebSockets | an echo round trip through the `/butter/ws` tunnel |

Tests tagged *network* also need that public site to be reachable (example.com, github.com, echo.websocket.org).

## Run it

You need Node.js 20+ and OpenResty 1.21+.

```sh
npm install
npm start                      # http://localhost:8080/
npm start -- --port 8090       # if 8080 is taken
npm stop
```

**OpenResty on Windows:** unzip the official `openresty-<version>-win64.zip` into `.tools/` in this folder or any parent folder, and the CLI finds it. On Linux or macOS, install the `openresty` package or set `OPENRESTY`.

The first start downloads Mozilla's CA bundle into `.butter/`. Service workers need `https://` or `localhost`.

> **Windows tip:** Windows lets two nginx processes bind the same port. If another butter-col server (for example the butter-col repo's own `npm start`) is already on 8080, requests can reach it instead of this app, and `/js/main.js` returns 404. Stop that server, or use `--port`.

## Layout

```
butter-col-app/
├── butter.config.lua    server config: codec, transports, guard
├── package.json         depends on @axis-network/butter-col
└── public/              the site (served with --site public)
    ├── index.html
    ├── style.css        light and dark, follows the OS theme
    ├── butter-col.png   logo, from the butter-col package
    └── js/
        ├── main.js           ButterController setup, status, transport picker, tabs
        ├── browse.js         the in-page browser
        ├── tests.js          the test bench
        ├── formatter-lab.js  codecs and rewriters
        ├── probe.js          raw /butter/fetch requests
        └── wire.js           protocol helpers: butterFetch, storeCookie, askWorker, tunnelUrl
```

## Configuration

`butter.config.lua` is deep-merged over the package defaults. To try another codec, change `codec` and run `npm run reload`. Changing it breaks proxy URLs saved under the old codec.

To offer the Bare transport as well:

```sh
npm install @axis-network/bare-transport
npx butter-col transport add @axis-network/bare-transport
```

Then uncomment the `bare` entry in `butter.config.lua` and point it at a Bare v3 server. The transport picker in the header lists it automatically.

## Caveats

butter-col is early and unaudited. Like every same-origin proxy, all proxied sites share this origin, and CORS and SameSite aren't emulated yet. Don't log in to anything important through it, and don't expose the server to other people without putting authentication in front of it. Read butter-col's [known issues](https://github.com/TheAxis-Network/butter-col/blob/main/docs/known-issues.html) first.

butter-col-app is licensed under the GNU Affero General Public License v3.0; see [LICENSE](LICENSE). butter-col itself, including the logo in `public/butter-col.png`, is MIT © Axis Network.
