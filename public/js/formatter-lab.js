// Formatter tab: the four URL codecs side by side, and a live playground for
// the HTML / CSS / JavaScript rewriters from /butter/formatter.mjs.

const $ = (selector) => document.querySelector(selector);

const SAMPLES = {
  html: `<!doctype html>
<base href="/blog/">
<link rel="stylesheet" href="style.css">
<img src="photo.jpg" srcset="photo.jpg 1x, photo@2x.jpg 2x" alt="">
<a href="https://other.example/page#top">elsewhere</a>
<form action="/search"><input name="q"></form>
<script integrity="sha384-abc" src="//cdn.example/app.js"></script>
<script>if (location.pathname === "/") location.href = "/home";</script>
<iframe sandbox src="/embed"></iframe>`,
  css: `@import "theme.css";
body {
  background: url(/img/bg.png) no-repeat;
  font-family: "Butter";
}
@font-face { src: url('fonts/butter.woff2') format("woff2"); }
.icon { mask: url(#svg-mask); }`,
  js: `// location and eval are rewritten; strings, comments and keys are not
const here = location.href;
const { location: where } = window;
window.location.assign("/next");
const payload = { location: "kept as a key" };
eval("location.reload()");
console.log("location in a string stays", /location/.test(here));
new URL("./data.json", import.meta.url);`,
};

export function setupFormatter({ ready, formatter }) {
  const codecInput = $("#codec-input");
  const codecRows = $("#codec-rows");
  const codecActive = $("#codec-active");
  const kindSelect = $("#rewrite-kind");
  const baseInput = $("#rewrite-base");
  const input = $("#rewrite-input");
  const output = $("#rewrite-output");

  const formatters = {};
  let active = null;

  function renderCodecs() {
    let target;
    try {
      target = new URL(codecInput.value).href;
    } catch {
      codecRows.innerHTML = '<tr><td colspan="3" class="bad">Type an absolute URL, e.g. https://example.com/</td></tr>';
      return;
    }
    codecRows.replaceChildren(
      ...Object.entries(formatters).map(([codec, f]) => {
        const proxied = f.rewriteUrl(target, location.href);
        const back = f.unrewriteUrl(proxied);
        const tr = document.createElement("tr");
        if (f === active) tr.dataset.active = "";
        const name = document.createElement("td");
        name.textContent = codec;
        const url = document.createElement("td");
        url.textContent = proxied;
        const check = document.createElement("td");
        check.className = back === target ? "ok" : "bad";
        check.textContent = back === target ? "✓ decodes back" : `✗ ${back}`;
        tr.append(name, url, check);
        return tr;
      }),
    );
  }

  function renderRewrite() {
    let base;
    try {
      base = new URL(baseInput.value).href;
    } catch {
      output.value = "The base URL must be absolute, e.g. https://example.com/";
      return;
    }
    try {
      const kind = kindSelect.value;
      if (kind === "html") output.value = active.html(input.value, { base });
      else if (kind === "css") output.value = active.css(input.value, base);
      else output.value = active.js(input.value);
    } catch (err) {
      output.value = `The rewriter threw: ${err && err.message}`;
    }
  }

  ready.then((butter) => {
    const { prefix, codec } = butter.config;
    codecActive.textContent = codec;
    for (const name of Object.keys(formatter.codecs)) {
      formatters[name] = formatter.createFormatter({ origin: location.origin, prefix, codec: name });
    }
    active = formatters[codec];
    input.value = SAMPLES[kindSelect.value];
    renderCodecs();
    renderRewrite();
  }, () => {
    codecRows.innerHTML = '<tr><td colspan="3" class="bad">butter-col didn\'t start (see the header).</td></tr>';
  });

  codecInput.addEventListener("input", () => active && renderCodecs());
  kindSelect.addEventListener("change", () => {
    input.value = SAMPLES[kindSelect.value];
    if (active) renderRewrite();
  });
  input.addEventListener("input", () => active && renderRewrite());
  baseInput.addEventListener("input", () => active && renderRewrite());
}
