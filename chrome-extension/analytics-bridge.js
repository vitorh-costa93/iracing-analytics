document.documentElement.dataset.iracingAnalyticsSyncBridge = "ready";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source !== "iracing-analytics" || event.data?.type !== "start-external-sync") return;
  chrome.runtime.sendMessage({ type: "start-external-sync" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "import-complete") return;
  window.postMessage(message.payload, window.location.origin);
});
