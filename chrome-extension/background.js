const APP_ORIGIN = "https://iracing-analytics.vercel.app";

function syncUrl(url) {
  const target = new URL(url);
  target.searchParams.set("iracingAnalyticsSync", "1");
  return target.toString();
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "start-external-sync") {
    chrome.tabs.create({ url: syncUrl("https://garage61.net/app"), active: false });
    chrome.tabs.create({ url: syncUrl("https://irstats.com/driver/958741"), active: false });
    return;
  }

  if (message?.type === "import-complete" && sender.tab?.id) {
    chrome.tabs.query({ url: `${APP_ORIGIN}/*` }, (tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "import-complete", payload: message.payload });
    });
    chrome.tabs.remove(sender.tab.id);
  }
});
