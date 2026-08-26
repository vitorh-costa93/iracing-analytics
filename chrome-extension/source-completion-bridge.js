(function () {
  if (new URLSearchParams(window.location.search).get("iracingAnalyticsSync") !== "1") return;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "iracing-analytics-import") return;
    chrome.runtime.sendMessage({ type: "import-complete", payload: event.data });
  });
})();
