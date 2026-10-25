// butter-col-app entry point: start butter-col with ButterController, then
// hand it to each tab. ButterController and the formatter are served by the
// butter-col server itself, so there is nothing to build or bundle.
import { ButterController } from "/butter/controller.mjs";
import * as formatter from "/butter/formatter.mjs";
import { setupBrowse } from "./browse.js";
import { setupTests } from "./tests.js";
import { setupFormatter } from "./formatter-lab.js";
import { setupProbe } from "./probe.js";
import { askWorker, errorText } from "./wire.js";

const $ = (selector) => document.querySelector(selector);

// ---- status pill ------------------------------------------------------------

const status = $("#status");
const statusText = $("#status-text");

function setStatus(text, state) {
  statusText.textContent = text;
  status.dataset.state = state;
}

function explain(err) {
  const message = errorText(err);
  if (/no service workers/i.test(message)) {
    return "Service workers are off in this browser (private windows often disable them).";
  }
  if (/HTTPS/i.test(message)) return "butter-col needs https:// or localhost.";
  if (/config\.js/.test(message)) return "Can't reach /butter/config.js. Is this page served by `npm start`?";
  return message;
}

// ---- butter-col ----------------------------------------------------------------

const butter = new ButterController();

// Every tab waits on this; it resolves to the ready controller.
const ready = butter.init().then(async () => {
  let version = butter.config.version;
  try {
    version = (await askWorker(butter.registration.active, { type: "butter:version" })).version;
  } catch {
    // older worker: fall back to the config's version
  }
  setStatus(`Ready · butter-col ${version} · codec ${butter.config.codec}`, "ready");
  await refreshTransport();
  return butter;
});

ready.catch((err) => {
  setStatus(explain(err), "error");
  console.error("[butter-col-app]", err);
});

// ---- transport picker -----------------------------------------------------------

const transportSelect = $("#transport");
const transportReset = $("#transport-reset");

async function refreshTransport() {
  const { active, available } = await butter.getTransport();
  transportSelect.replaceChildren(
    ...available.map((t) => {
      const option = new Option(t.loaded ? t.name : `${t.name} (didn't load)`, t.name, false, t.name === active.name);
      option.disabled = !t.loaded;
      return option;
    }),
  );
  transportSelect.disabled = available.length < 2;
  transportReset.disabled = active.name === butter.config.defaultTransport;
  return active;
}

transportSelect.addEventListener("change", async () => {
  try {
    const active = await butter.setTransport(transportSelect.value);
    setStatus(`Switched to the "${active.name}" transport. Open pages switch when they reload.`, "ready");
  } catch (err) {
    setStatus(errorText(err), "error");
  }
  refreshTransport().catch(() => {});
});

transportReset.addEventListener("click", async () => {
  try {
    const active = await butter.resetTransport();
    setStatus(`Back to the default transport, "${active.name}".`, "ready");
  } catch (err) {
    setStatus(errorText(err), "error");
  }
  refreshTransport().catch(() => {});
});

// ---- tabs ---------------------------------------------------------------------------

const TAB_KEY = "butter-col-app:tab";
const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab, focus = false) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
  }
  if (focus) tab.focus();
  try {
    localStorage.setItem(TAB_KEY, tab.id);
  } catch {
    // storage unavailable: the tab just isn't remembered
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    selectTab(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], true);
  });
}

let savedTab = null;
try {
  savedTab = document.getElementById(localStorage.getItem(TAB_KEY));
} catch {
  // ignore
}
selectTab(tabs.includes(savedTab) ? savedTab : tabs[0]);

// ---- the tabs themselves -------------------------------------------------------------

const app = { butter, ready, formatter, refreshTransport };
setupBrowse(app);
setupTests(app);
setupFormatter(app);
setupProbe(app);
