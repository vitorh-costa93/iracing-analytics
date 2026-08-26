(function () {
  if (new URLSearchParams(window.location.search).get("iracingAnalyticsSync") !== "1") return;
  if (document.getElementById("iracing-analytics-garage61-import")) return;

  const script = document.createElement("script");
  script.id = "iracing-analytics-garage61-import";
  script.src = "https://iracing-analytics.vercel.app/garage61-import.js?v=3";
  script.async = true;
  document.documentElement.appendChild(script);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "iracing-analytics-import" || event.data?.integration !== "garage61") return;
    chrome.runtime.sendMessage({ type: "import-complete", payload: event.data });
  });
})();
