(function () {
  if (new URLSearchParams(window.location.search).get("iracingAnalyticsSync") !== "1") return;
  if (document.getElementById("iracing-analytics-irstats-import")) return;

  const script = document.createElement("script");
  script.id = "iracing-analytics-irstats-import";
  script.src = "https://iracing-analytics.vercel.app/irstats-import.js?v=3";
  script.async = true;
  document.documentElement.appendChild(script);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "iracing-analytics-import" || event.data?.integration !== "irstats") return;
    chrome.runtime.sendMessage({ type: "import-complete", payload: event.data });
  });
})();
