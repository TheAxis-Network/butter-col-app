// Test bench: end-to-end checks of a butter-col deployment, run from the
// browser. Each test returns a short detail string, or throws to fail.
import { askWorker, butterFetch, errorText, storeCookie, tunnelUrl } from "./wire.js";

const $ = (selector) => document.querySelector(selector);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Expect /butter/fetch to refuse the target with a given error code and status. */
async function expectRefusal(config, request, code, status) {
  const result = await butterFetch(config, request);
  assert(result.error, `expected ${code}, but the request went through (upstream ${result.status})`);
  assert(result.error.code === code, `expected ${code}, got ${result.error.code}: ${result.error.message}`);
  assert(result.outerStatus === status, `expected HTTP ${status}, got ${result.outerStatus}`);
  return `${result.outerStatus} ${code}: ${result.error.message}`;
}

function controlled() {
  assert(navigator.serviceWorker.controller, "this page isn't controlled by the service worker yet; reload it (not a hard reload) and run again");
}

const CODEC_SAMPLES = [
  "https://example.com/",
  "https://example.com/a/b?x=1&y=two#frag",
  "https://bücher.example/ü?q=ä ö",
  "http://example.com:8080/p;x?a=%2F",
];

const tests = [
  {
    name: "Secure context with service workers",
    run: () => {
      assert(window.isSecureContext, "not a secure context; use https:// or localhost");
      assert("serviceWorker" in navigator, "this browser has no service workers");
      return `${location.origin} is a secure context`;
    },
  },
  {
    name: "GET /butter/health",
    run: async () => {
      const response = await fetch("/butter/health", { cache: "no-store" });
      assert(response.ok, `HTTP ${response.status}`);
      const body = await response.json();
      assert(body.ok === true && body.name === "butter-col", `unexpected body ${JSON.stringify(body)}`);
      return `${body.name} ${body.version}`;
    },
  },
  {
    name: "/butter/config.js is valid",
    run: async ({ butter }) => {
      const c = butter.config;
      assert(c.prefix.startsWith(c.base), `prefix ${c.prefix} is not under base ${c.base}`);
      assert(["none", "plain", "xor", "base64"].includes(c.codec), `unknown codec ${c.codec}`);
      assert(c.transports.some((t) => t.name === c.defaultTransport), `default transport ${c.defaultTransport} is not offered`);
      assert(c.transport && c.transport.fetch && c.transport.ws, "missing transport endpoints");
      return `prefix ${c.prefix} · codec ${c.codec} · transports ${c.transports.map((t) => t.name).join(", ")}`;
    },
  },
  {
    name: "Service worker is active and answers butter:version",
    run: async ({ butter }) => {
      const worker = butter.registration && butter.registration.active;
      assert(worker, "no active service worker");
      const { version } = await askWorker(worker, { type: "butter:version" });
      return `version ${version} · scope ${butter.registration.scope} · controls this page: ${navigator.serviceWorker.controller ? "yes" : "not yet"}`;
    },
  },
  {
    name: "Active transport is loaded",
    run: async ({ butter }) => {
      const { active, available } = await butter.getTransport();
      const entry = available.find((t) => t.name === active.name);
      assert(entry && entry.loaded, `"${active.name}" didn't load from ${active.url}`);
      const failed = available.filter((t) => !t.loaded).map((t) => t.name);
      return `active: ${active.name}` + (failed.length ? ` · failed to load: ${failed.join(", ")}` : ` · ${available.length} loaded`);
    },
  },
  {
    name: "All four codecs round-trip",
    run: ({ butter, formatter }) => {
      let count = 0;
      for (const codec of Object.keys(formatter.codecs)) {
        const f = formatter.createFormatter({ origin: location.origin, prefix: butter.config.prefix, codec });
        for (const sample of CODEC_SAMPLES) {
          const expected = new URL(sample).href;
          const proxied = f.rewriteUrl(sample, location.href);
          assert(proxied.startsWith(location.origin + butter.config.prefix), `${codec}: ${proxied} is not a proxy URL`);
          assert(f.unrewriteUrl(proxied) === expected, `${codec}: ${expected} came back as ${f.unrewriteUrl(proxied)}`);
          count++;
        }
      }
      return `${count} round trips across ${Object.keys(formatter.codecs).join(", ")}`;
    },
  },
  {
    name: "Rewriters: HTML, CSS and JavaScript",
    run: ({ butter, formatter }) => {
      const f = formatter.createFormatter({ origin: location.origin, prefix: butter.config.prefix, codec: butter.config.codec });
      const base = "https://example.com/dir/page";
      const proxyRoot = location.origin + butter.config.prefix;
      const html = f.html('<a href="/x">x</a><img srcset="a.png 1x, b.png 2x">', { base });
      assert(html.includes(`href="${f.rewriteUrl("/x", base)}"`), `HTML href not rewritten: ${html}`);
      assert((html.match(new RegExp(proxyRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length === 3, `srcset not rewritten: ${html}`);
      const css = f.css("body { background: url(bg.png) }", base);
      assert(css.includes(f.rewriteUrl("bg.png", base)), `CSS url() not rewritten: ${css}`);
      const js = f.js("if (location.hostname) location.href = '/home'; const o = { location: 1 };");
      assert(js.includes("__butter$location.hostname") && js.includes("{ location: 1 }"), `JS rewrite unexpected: ${js}`);
      return "href, srcset, url() and location rewritten; object keys left alone";
    },
  },
  {
    name: "/butter/fetch wraps the upstream response",
    tag: "network: example.com",
    run: async ({ butter }) => {
      const r = await butterFetch(butter.config, { url: "https://example.com/", headers: { accept: "text/html" } });
      assert(!r.error, r.error && `${r.error.code}: ${r.error.message}`);
      assert(r.outerStatus === 200 && r.status === 200, `outer ${r.outerStatus}, X-Butter-Status ${r.status}`);
      assert(Array.isArray(r.headers) && r.headers.every((h) => Array.isArray(h) && h.length === 2), "X-Butter-Headers is not a list of pairs");
      assert(/no-store/.test(r.response.headers.get("Cache-Control") || ""), "transport response is cacheable");
      assert(/Example Domain/.test(r.text), "body doesn't look like example.com");
      return `X-Butter-Status ${r.status} ${r.statusText} · ${r.headers.length} upstream headers · ${r.bytes.length} bytes · ${r.ms} ms`;
    },
  },
  {
    name: "Redirects are wrapped, not followed",
    tag: "network: github.com",
    run: async ({ butter }) => {
      const r = await butterFetch(butter.config, { url: "http://github.com/" });
      assert(!r.error, r.error && `${r.error.code}: ${r.error.message}`);
      assert(r.outerStatus === 200, `outer status ${r.outerStatus}`);
      assert(r.status >= 300 && r.status < 400, `expected a 3xx upstream, got ${r.status}`);
      assert(r.header("location"), "no Location header in X-Butter-Headers");
      return `outer 200 · X-Butter-Status ${r.status} · Location ${r.header("location")}`;
    },
  },
  {
    name: "Guard blocks private addresses",
    run: ({ butter }) => expectRefusal(butter.config, { url: "http://169.254.169.254/latest/meta-data/" }, "BLOCKED_ADDRESS", 403),
  },
  {
    name: "Guard blocks localhost",
    run: ({ butter }) => expectRefusal(butter.config, { url: `http://localhost:${location.port || 80}/butter/health` }, "BLOCKED_HOST", 403),
  },
  {
    name: "Guard blocks bad ports",
    run: ({ butter }) => expectRefusal(butter.config, { url: "http://example.com:25/" }, "BLOCKED_PORT", 403),
  },
  {
    name: "Non-HTTP targets are refused",
    run: ({ butter }) => expectRefusal(butter.config, { url: "ftp://example.com/file.txt" }, "INVALID_URL", 400),
  },
  {
    name: "Malformed X-Butter-Headers is refused",
    run: ({ butter }) => expectRefusal(butter.config, { url: "https://example.com/", rawHeaders: "[1, 2, 3]" }, "INVALID_HEADERS", 400),
  },
  {
    name: "Session cookie jar keeps document.cookie writes",
    tag: "network: example.com",
    run: async ({ butter }) => {
      const value = Math.random().toString(36).slice(2, 10);
      const url = "https://example.com/";
      const stored = await storeCookie(butter.config, url, `butter_app_test=${value}; Path=/`);
      assert(stored === 204, `POST /butter/cookie answered ${stored}`);
      try {
        const r = await butterFetch(butter.config, { url, method: "HEAD", wantCookies: true });
        assert(!r.error, r.error && `${r.error.code}: ${r.error.message}`);
        assert((r.documentCookies || "").includes(`butter_app_test=${value}`), `X-Butter-Document-Cookies was "${r.documentCookies || ""}"`);
        return `stored butter_app_test=${value}, read back via X-Butter-Document-Cookies`;
      } finally {
        await storeCookie(butter.config, url, "butter_app_test=; Max-Age=0; Path=/").catch(() => {});
      }
    },
  },
  {
    name: "Service worker proxies a fetch() of a proxy URL",
    tag: "network: example.com",
    run: async ({ butter }) => {
      controlled();
      const proxied = butter.encodeUrl("https://example.com/");
      const response = await fetch(proxied, { cache: "no-store" });
      const failure = response.headers.get("X-Butter-Error-Code");
      assert(!failure, `the service worker answered with ${failure}`);
      assert(response.ok, `HTTP ${response.status}`);
      assert((await response.text()).includes("Example Domain"), "that isn't example.com");
      return `${proxied} → HTTP ${response.status} through the active transport`;
    },
  },
  {
    name: "Proxied document runs the butter-col runtime",
    tag: "network: example.com",
    run: async ({ butter }) => {
      controlled();
      const frame = document.createElement("iframe");
      frame.hidden = true;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("the page didn't load within 15 s")), 15000);
          frame.onload = () => {
            clearTimeout(timer);
            resolve();
          };
          frame.src = butter.encodeUrl("https://example.com/");
          document.body.append(frame);
        });
        const win = frame.contentWindow;
        assert(win.document.title === "Example Domain", `loaded "${win.document.title}" instead of example.com`);
        assert(butter.decodeUrl(win.location.href) === "https://example.com/", `frame is at ${win.location.href}`);
        // The rewriter turns `location` into __butter$location, which the runtime
        // defines; it reports the target URL, not the proxy URL.
        const fake = win.__butter$location;
        assert(fake, "the runtime isn't running in the frame");
        assert(fake.href === "https://example.com/" && fake.origin === "https://example.com", `the page thinks it is at ${fake.href}`);
        return `frame at ${win.location.pathname.slice(0, 40)}… believes location.href is ${fake.href}`;
      } finally {
        frame.remove();
      }
    },
  },
  {
    name: "Service worker reports transport errors",
    run: async ({ butter }) => {
      controlled();
      const response = await fetch(butter.encodeUrl("http://169.254.169.254/"), { cache: "no-store" });
      const code = response.headers.get("X-Butter-Error-Code");
      assert(code === "BLOCKED_ADDRESS", `expected X-Butter-Error-Code BLOCKED_ADDRESS, got ${code || "none"} (HTTP ${response.status})`);
      return `HTTP ${response.status} error page with X-Butter-Error-Code ${code}`;
    },
  },
  {
    name: "WebSocket tunnel echoes through /butter/ws",
    tag: "network: echo.websocket.org",
    run: ({ butter }) =>
      new Promise((resolve, reject) => {
        const token = "butter-" + Math.random().toString(36).slice(2, 10);
        const url = tunnelUrl(butter.config, "wss://echo.websocket.org/", "https://echo.websocket.org");
        const started = performance.now();
        const socket = new WebSocket(url);
        const finish = (fn, value) => {
          clearTimeout(timer);
          socket.close();
          fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error("no echo within 10 s")), 10000);
        socket.onopen = () => socket.send(token);
        socket.onmessage = (event) => {
          if (event.data === token) finish(resolve, `sent and received "${token}" in ${Math.round(performance.now() - started)} ms`);
        };
        socket.onerror = () => finish(reject, new Error("the tunnel failed to open (see the server's error log)"));
      }),
  },
];

export function setupTests(app) {
  const list = $("#tests-list");
  const runButton = $("#tests-run");
  const summary = $("#tests-summary");

  const rows = tests.map((test) => {
    const li = document.createElement("li");
    li.dataset.state = "idle";
    li.innerHTML = '<span class="mark" aria-hidden="true">·</span><span class="name"></span><span class="time"></span><span class="detail"></span>';
    li.querySelector(".name").textContent = test.name;
    if (test.tag) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = test.tag;
      li.querySelector(".name").append(tag);
    }
    list.append(li);
    return li;
  });

  function setRow(li, state, detail = "", ms = null) {
    li.dataset.state = state;
    li.querySelector(".mark").textContent = { idle: "·", running: "…", pass: "✓", fail: "✗" }[state];
    li.querySelector(".detail").textContent = detail;
    li.querySelector(".time").textContent = ms === null ? "" : `${ms} ms`;
  }

  runButton.addEventListener("click", async () => {
    runButton.disabled = true;
    summary.hidden = true;
    rows.forEach((li) => setRow(li, "idle"));

    let butter;
    try {
      butter = await app.ready;
    } catch (err) {
      setRow(rows[0], "fail", errorText(err));
      summary.textContent = "butter-col didn't start, so nothing else can run.";
      summary.dataset.kind = "fail";
      summary.hidden = false;
      runButton.disabled = false;
      return;
    }

    let passed = 0;
    for (let i = 0; i < tests.length; i++) {
      setRow(rows[i], "running", "running…");
      const started = performance.now();
      try {
        const detail = await tests[i].run({ butter, formatter: app.formatter });
        setRow(rows[i], "pass", detail || "", Math.round(performance.now() - started));
        passed++;
      } catch (err) {
        setRow(rows[i], "fail", errorText(err), Math.round(performance.now() - started));
      }
    }

    const failed = tests.length - passed;
    summary.textContent = failed ? `${passed} of ${tests.length} passed, ${failed} failed.` : `All ${tests.length} tests passed.`;
    summary.dataset.kind = failed ? "fail" : "ok";
    summary.hidden = false;
    runButton.disabled = false;
  });
}
