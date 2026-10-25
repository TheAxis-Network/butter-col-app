// Helpers that speak butter-col's protocols directly: the built-in
// transport's /butter/fetch wire format, and the service worker's
// postMessage API. The rest of the app goes through ButterController.

/** JSON with every non-ASCII character \uXXXX-escaped, as X-Butter-Headers requires. */
export function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Parse a butter-col error object from the X-Butter-Error header (or a JSON body). */
function readError(response, bodyText) {
  const header = response.headers.get("X-Butter-Error");
  try {
    if (header) return JSON.parse(header);
    if (bodyText) return JSON.parse(bodyText).error || null;
  } catch {
    // not a butter-col error
  }
  return null;
}

/**
 * Send one request through /butter/fetch, unwrap the X-Butter-* response
 * headers and return everything a caller might want to look at.
 *
 *   url          target, sent as X-Butter-URL (normalised with URL.href when it parses)
 *   headers      object for X-Butter-Headers, or rawHeaders for the exact header text
 *   wantCookies  ask for X-Butter-Document-Cookies
 */
export async function butterFetch(config, { url, method = "GET", headers, rawHeaders, body, wantCookies = false }) {
  let target = String(url).trim();
  try {
    target = new URL(target).href;
  } catch {
    // send it as typed and let the server say what's wrong with it
  }

  const outgoing = new Headers();
  outgoing.set("X-Butter-URL", target);
  if (rawHeaders !== undefined) outgoing.set("X-Butter-Headers", rawHeaders);
  else if (headers && Object.keys(headers).length) outgoing.set("X-Butter-Headers", asciiJson(headers));
  if (wantCookies) outgoing.set("X-Butter-Want-Cookies", "1");

  const started = performance.now();
  const response = await fetch(config.transport.fetch, {
    method,
    headers: outgoing,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    credentials: "same-origin",
    cache: "no-store",
  });

  const isError = response.headers.has("X-Butter-Error") || !response.headers.has("X-Butter-Status");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ms = Math.round(performance.now() - started);

  let upstreamHeaders = [];
  try {
    upstreamHeaders = JSON.parse(response.headers.get("X-Butter-Headers") || "[]");
  } catch {
    // leave empty; the caller sees the raw header in `response`
  }

  const text = new TextDecoder().decode(bytes);
  return {
    target,
    response,
    ms,
    outerStatus: response.status,
    status: Number(response.headers.get("X-Butter-Status")) || null,
    statusText: response.headers.get("X-Butter-Status-Text") || "",
    headers: upstreamHeaders,
    header: (name) => (upstreamHeaders.find(([n]) => n.toLowerCase() === name.toLowerCase()) || [])[1] ?? null,
    documentCookies: response.headers.get("X-Butter-Document-Cookies"),
    error: isError ? readError(response, text) : null,
    bytes,
    text,
  };
}

/** Store a cookie the way page JavaScript does (document.cookie = …), via POST /butter/cookie. */
export async function storeCookie(config, url, cookie) {
  const response = await fetch(config.transport.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, cookie }),
    credentials: "same-origin",
  });
  return response.status;
}

/** Send a message to the active service worker and wait for its { ok, result } reply. */
export function askWorker(worker, message, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("The service worker did not answer.")), timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data && event.data.ok) resolve(event.data.result);
      else reject(new Error((event.data && event.data.error) || "The service worker refused the request."));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** WebSocket URL for the /butter/ws tunnel to `target`. */
export function tunnelUrl(config, target, origin) {
  const ws = new URL(config.transport.ws, location.href);
  ws.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws.searchParams.set("url", target);
  if (origin) ws.searchParams.set("origin", origin);
  return ws.href;
}

export function errorText(err) {
  return String((err && err.message) || err);
}
