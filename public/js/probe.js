// Wire probe tab: build one raw /butter/fetch request and show exactly what
// the built-in transport's server sends back.
import { butterFetch, errorText } from "./wire.js";

const $ = (selector) => document.querySelector(selector);

const PRESETS = [
  { label: "example.com", method: "GET", url: "https://example.com/", headers: '{"accept":"text/html"}' },
  { label: "Redirect (301)", method: "GET", url: "http://github.com/", headers: "{}" },
  { label: "POST with a body", method: "POST", url: "https://httpbin.org/post", headers: '{"content-type":"application/json"}', body: '{"hello":"butter"}' },
  { label: "HEAD + document cookies", method: "HEAD", url: "https://example.com/", headers: "{}", cookies: true },
  { label: "Guard: cloud metadata", method: "GET", url: "http://169.254.169.254/latest/meta-data/", headers: "{}" },
  { label: "Guard: localhost", method: "GET", url: "http://localhost/", headers: "{}" },
  { label: "Guard: SMTP port", method: "GET", url: "http://example.com:25/", headers: "{}" },
  { label: "Invalid URL", method: "GET", url: "ftp://example.com/", headers: "{}" },
  { label: "Unresolvable host", method: "GET", url: "https://does-not-exist.invalid/", headers: "{}" },
];

const TEXTY = /^(text\/|application\/(json|javascript|xml|xhtml\+xml|ld\+json|manifest\+json)|image\/svg\+xml)/i;
const BODY_PREVIEW = 8000;

export function setupProbe({ ready }) {
  const form = $("#probe-form");
  const method = $("#probe-method");
  const url = $("#probe-url");
  const headers = $("#probe-headers");
  const body = $("#probe-body");
  const bodyField = $("#probe-body-field");
  const cookies = $("#probe-cookies");
  const result = $("#probe-result");
  const facts = $("#probe-facts");
  const headersOut = $("#probe-headers-out");
  const bodyOut = $("#probe-body-out");
  const bodySize = $("#probe-body-size");
  const send = form.querySelector('button[type="submit"]');

  const syncBodyField = () => {
    bodyField.hidden = method.value === "GET" || method.value === "HEAD";
  };
  method.addEventListener("change", syncBodyField);

  const presets = $("#probe-presets");
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = preset.label;
    button.addEventListener("click", () => {
      method.value = preset.method;
      url.value = preset.url;
      headers.value = preset.headers;
      if (preset.body) body.value = preset.body;
      cookies.checked = Boolean(preset.cookies);
      syncBodyField();
      form.requestSubmit();
    });
    presets.append(button);
  }

  function fact(name, value, className) {
    const dt = document.createElement("dt");
    dt.textContent = name;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (className) dd.className = className;
    facts.append(dt, dd);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let butter;
    try {
      butter = await ready;
    } catch {
      return;
    }

    // Send the headers exactly as typed, so malformed JSON reaches the server
    // and comes back as INVALID_HEADERS instead of being caught here.
    const rawHeaders = headers.value.trim();
    send.disabled = true;
    facts.replaceChildren();
    headersOut.replaceChildren();
    bodyOut.textContent = "";
    bodySize.textContent = "";
    result.hidden = false;

    try {
      const r = await butterFetch(butter.config, {
        url: url.value,
        method: method.value,
        rawHeaders: rawHeaders && rawHeaders !== "{}" ? rawHeaders : undefined,
        body: body.value,
        wantCookies: cookies.checked,
      });

      fact("request", `${method.value} ${butter.config.transport.fetch}  ·  X-Butter-URL: ${r.target}`);
      fact("HTTP status", `${r.outerStatus} ${r.response.statusText}`.trim());
      if (r.error) {
        fact("X-Butter-Error", `${r.error.code}: ${r.error.message}`, "bad");
      } else {
        fact("X-Butter-Status", `${r.status} ${r.statusText}`, r.status < 400 ? "ok" : "bad");
      }
      fact("Cache-Control", r.response.headers.get("Cache-Control") || "—");
      if (cookies.checked) fact("X-Butter-Document-Cookies", r.documentCookies || "(none)");
      fact("time", `${r.ms} ms`);

      headersOut.replaceChildren(
        ...r.headers.map(([name, value]) => {
          const tr = document.createElement("tr");
          const n = document.createElement("td");
          n.textContent = name;
          const v = document.createElement("td");
          v.textContent = value;
          tr.append(n, v);
          return tr;
        }),
      );
      if (!r.headers.length) headersOut.innerHTML = '<tr><td colspan="2">(none)</td></tr>';

      const type = r.header("content-type") || r.response.headers.get("Content-Type") || "";
      bodySize.textContent = `(${r.bytes.length} bytes${type ? ", " + type.split(";")[0] : ""})`;
      if (!r.bytes.length) bodyOut.textContent = "(empty)";
      else if (!r.error && type && !TEXTY.test(type)) bodyOut.textContent = "(binary body not shown)";
      else bodyOut.textContent = r.text.length > BODY_PREVIEW ? r.text.slice(0, BODY_PREVIEW) + "\n… (truncated)" : r.text;
    } catch (err) {
      fact("failed", errorText(err), "bad");
    } finally {
      send.disabled = false;
    }
  });
}
