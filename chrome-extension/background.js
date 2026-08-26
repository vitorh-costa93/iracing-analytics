const APP_ORIGIN = "https://iracing-analytics.vercel.app";
const pendingImports = new Map();

function syncUrl(url) {
  const target = new URL(url);
  target.searchParams.set("iracingAnalyticsSync", "1");
  return target.toString();
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "start-external-sync") {
    chrome.tabs.create({ url: syncUrl("https://garage61.net/app"), active: false }, (tab) => {
      if (tab.id) pendingImports.set(tab.id, { integration: "garage61", script: "garage61-import.js" });
    });
    chrome.tabs.create({ url: syncUrl("https://irstats.com/driver/958741"), active: false }, (tab) => {
      if (tab.id) pendingImports.set(tab.id, { integration: "irstats", script: "irstats-import.js" });
    });
    return;
  }

  if (message?.type === "import-complete" && sender.tab?.id) {
    chrome.tabs.query({ url: `${APP_ORIGIN}/*` }, (tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "import-complete", payload: message.payload });
    });
    chrome.tabs.remove(sender.tab.id);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const pending = pendingImports.get(tabId);
  if (!pending) return;
  pendingImports.delete(tabId);

  // This runs an extension-packaged importer in the target page's main world. Unlike a remote
  // <script> tag, it is not blocked by iRStats or Garage61 Content Security Policies.
  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: [pending.script] })
    .catch((error) => {
      const payload = { source: "iracing-analytics-import", integration: pending.integration, message: `${pending.integration}: não foi possível iniciar o importador (${error.message}).` };
      chrome.tabs.query({ url: `${APP_ORIGIN}/*` }, (tabs) => {
        for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "import-complete", payload });
      });
    });
});
