// Browse tab: a proxied page in an <iframe>, with an address bar that
// follows it. The frame is same-origin with this page (it's a /butter/go/
// URL), so its location can be read and decoded back to the real address.

const $ = (selector) => document.querySelector(selector);

export function setupBrowse({ butter, ready }) {
  const form = $("#browse-form");
  const input = $("#browse-input");
  const frame = $("#browse-frame");
  const empty = $("#browse-empty");
  const proxied = $("#browse-proxied");
  const progress = $("#browse-progress");

  let current = "";   // target URL shown in the frame
  let watcher = 0;

  function setLoading(loading) {
    progress.dataset.state = loading ? "loading" : "done";
  }

  function showAddress(url) {
    current = url;
    if (document.activeElement !== input) input.value = url;
    proxied.textContent = butter.encodeUrl(url);
  }

  /** The proxied page's real URL, or null while it isn't readable. */
  function frameUrl() {
    try {
      const href = frame.contentWindow.location.href;
      if (!href || href === "about:blank") return null;
      const target = butter.decodeUrl(href);
      return target === href ? null : target;
    } catch {
      return null;
    }
  }

  async function open(value) {
    value = String(value || "").trim();
    if (!value) return;
    try {
      await ready;
    } catch {
      return; // the header already says why
    }
    const url = butter.resolveInput(value);
    empty.hidden = true;
    showAddress(url);
    setLoading(true);
    frame.src = butter.encodeUrl(url);
    // Single-page apps change their URL without loading: keep the bar in step.
    if (!watcher) {
      watcher = setInterval(() => {
        const now = frameUrl();
        if (now && now !== current) showAddress(now);
      }, 500);
    }
  }

  frame.addEventListener("load", () => {
    setLoading(false);
    const url = frameUrl();
    if (!url) return;
    showAddress(url);
    try {
      const title = frame.contentDocument.title;
      document.title = title ? `${title} · butter-col-app` : "butter-col-app";
      frame.contentWindow.addEventListener("pagehide", () => setLoading(true), { once: true });
    } catch {
      // not readable
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.blur();
    open(input.value);
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = current;
      input.blur();
    }
  });

  const actions = {
    back: () => frame.contentWindow && frame.contentWindow.history.back(),
    forward: () => frame.contentWindow && frame.contentWindow.history.forward(),
    reload: () => {
      if (!current) return;
      setLoading(true);
      try {
        frame.contentWindow.location.reload();
      } catch {
        frame.src = butter.encodeUrl(current);
      }
    },
    popout: () => {
      if (current) window.open(butter.encodeUrl(current), "_blank", "noopener");
    },
  };

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-browse]");
    if (action) actions[action.dataset.browse]();
    const site = event.target.closest("[data-open]");
    if (site) open(site.dataset.open);
  });
}
