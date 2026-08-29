(function () {
  var APP_BASE = "https://iracing-analytics.vercel.app";
  var PENDING_URL = APP_BASE + "/api/setup/garage61-import/pending?days=15";
  var IMPORT_URL = APP_BASE + "/api/setup/garage61-import";
  var EVENT_LOAD_WAIT_MS = 4500;
  var GAP_BETWEEN_EVENTS_MS = 400;

  var existing = document.getElementById("iracing-import-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = "iracing-import-overlay";
  overlay.style.cssText = "position:fixed;top:16px;right:16px;z-index:999999;width:340px;background:#1c2228;color:#fff;font:13px/1.5 -apple-system,Segoe UI,sans-serif;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;";
  overlay.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">iRacing Analytics — importar setups</div>' +
    '<div id="iri-status">Iniciando...</div>' +
    '<div id="iri-bar-wrap" style="margin-top:10px;height:6px;background:#3a4450;border-radius:3px;overflow:hidden;"><div id="iri-bar" style="height:100%;width:0%;background:#0877c9;transition:width .2s;"></div></div>' +
    '<div id="iri-log" style="margin-top:10px;max-height:200px;overflow:auto;font-size:11px;color:#aeb8c1;"></div>' +
    '<div style="margin-top:10px;text-align:right;"><button id="iri-close" style="background:#2a323b;color:#fff;border:1px solid #3a4450;border-radius:4px;padding:5px 10px;cursor:pointer;">Fechar</button></div>';
  document.body.appendChild(overlay);
  document.getElementById("iri-close").onclick = function () { overlay.remove(); };

  var statusEl = document.getElementById("iri-status");
  var barEl = document.getElementById("iri-bar");
  var logEl = document.getElementById("iri-log");
  function setStatus(text) { statusEl.textContent = text; }
  function setProgress(pct) { barEl.style.width = Math.max(0, Math.min(100, pct)) + "%"; }
  function log(text) { var line = document.createElement("div"); line.textContent = text; logEl.appendChild(line); logEl.scrollTop = logEl.scrollHeight; }
  function complete(message, imported, skipped) {
    setStatus(message); setProgress(100);
    try { if (window.opener) window.opener.postMessage({ source: "iracing-analytics-import", integration: "garage61", imported: imported || 0, skipped: skipped || 0, message: message }, APP_BASE); } catch (e) {}
    try { window.postMessage({ source: "iracing-analytics-import", integration: "garage61", imported: imported || 0, skipped: skipped || 0, message: message }, window.location.origin); } catch (e) {}
    if (window.opener) setTimeout(function () { window.close(); }, 900);
  }

  var key = window.localStorage.getItem("iri_key");
  if (!key) {
    key = window.prompt("Cole sua chave de importação (GARAGE61_IMPORT_SECRET) — só precisa fazer isso uma vez:", "");
    if (!key) { setStatus("Cancelado: chave não informada."); return; }
    window.localStorage.setItem("iri_key", key);
  }

  setStatus("Buscando lista de corridas recentes...");
  fetch(PENDING_URL, { headers: { "x-import-key": key, Accept: "application/json" } })
    .then(function (res) {
      if (res.status === 401) { window.localStorage.removeItem("iri_key"); throw new Error("Chave de importação inválida. Rode o bookmarklet de novo para informar outra."); }
      return res.json();
    })
    .then(function (data) {
      if (data.status !== "ok") throw new Error(data.message || "Erro ao buscar corridas pendentes");
      var events = data.events || [];
      log(events.length + " evento(s) nos últimos " + data.days + " dias.");
      if (!events.length) { complete("Garage61 lido: nenhum setup novo para importar.", 0, 0); return; }
      visitAll(events);
    })
    .catch(function (err) {
      setStatus("Erro: " + err.message);
    });

  var collected = [];
  var visited = []; // every event actually visited this run, whether or not a setup was captured --
  // reported back so the backend can skip a checked-but-empty event for a while instead of
  // revisiting it (and Garage61's own several API calls per event page) on every single run.

  // Confirmed live (29/08/2026) against GET /api/internal/events/{id}: this is the actual response
  // the event page fetches, and "setup" is buried several levels deep --
  // event.sessions[].run_groups[].runs[].setup -- not a top-level field on the fetched JSON at all,
  // which is what the old flat captureIfSetup() checked. That's why setups silently stopped
  // capturing after Garage61 changed this response shape: the check never matched, so nothing was
  // ever wrong-looking in the UI, it just quietly found zero setups every run. Walking the whole
  // response recursively instead of assuming one fixed path survives the next shape change too.
  var capturedRunIds = {};
  function captureIfSetup(node, eventId, fallbackCar, fallbackTrack, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    try {
      if (node.setup && typeof node.setup === "object" && node.setup.parameters && node.setup.name) {
        var setup = node.setup;
        var runId = node.id || setup.id;
        if (!runId || !capturedRunIds[runId]) {
          if (runId) capturedRunIds[runId] = true;
          var car = typeof setup.car === "number" ? setup.car : (typeof node.car_id === "number" ? node.car_id : fallbackCar);
          var track = typeof setup.track === "number" ? setup.track : fallbackTrack;
          collected.push({
            car: car,
            track: track,
            name: setup.name,
            seasonId: undefined,
            runId: runId,
            event: eventId,
            setupFixed: !!node.setup_fixed,
            setupCommercial: !node.setup_fixed,
            parameters: setup.parameters,
          });
          log("Capturado: " + setup.name);
        }
      }
    } catch (e) { /* malformed node, keep walking siblings */ }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) captureIfSetup(node[i], eventId, fallbackCar, fallbackTrack, depth + 1);
      return;
    }
    for (var key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) captureIfSetup(node[key], eventId, fallbackCar, fallbackTrack, depth + 1);
    }
  }

  function patchWindow(win, eventId) {
    if (!win || win.__iriPatched) return;
    try {
      var originalFetch = win.fetch;
      if (!originalFetch) return;
      win.__iriPatched = true;
      win.fetch = function () {
        var args = arguments;
        return originalFetch.apply(win, args).then(function (response) {
          try {
            response.clone().json().then(function (json) {
              var fallbackCar = json && typeof json.car_id === "number" ? json.car_id : undefined;
              var fallbackTrack = json && typeof json.track_id === "number" ? json.track_id : undefined;
              captureIfSetup(json, eventId, fallbackCar, fallbackTrack, 0);
            }).catch(function () {});
          } catch (e) { /* not JSON, ignore */ }
          return response;
        });
      };
    } catch (e) { /* cross-origin or inaccessible window, ignore */ }
  }

  function visitAll(events) {
    var index = 0;
    function next() {
      if (index >= events.length) return finish();
      var event = events[index];
      index += 1;
      setProgress((index / events.length) * 85);
      setStatus(index + " / " + events.length + " corridas visitadas");
      visited.push({ eventId: event.eventId, car: event.car, track: event.track });

      var iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;right:0;";
      document.body.appendChild(iframe);
      try { patchWindow(iframe.contentWindow, event.eventId); } catch (e) {}
      var patchTimer = setInterval(function () { try { patchWindow(iframe.contentWindow, event.eventId); } catch (e) {} }, 150);

      iframe.src = "https://garage61.net/app/event/" + event.eventId;

      setTimeout(function () {
        clearInterval(patchTimer);
        iframe.remove();
        setTimeout(next, GAP_BETWEEN_EVENTS_MS);
      }, EVENT_LOAD_WAIT_MS);
    }
    next();
  }

  function finish() {
    var byKey = {};
    collected.forEach(function (item) {
      if (item.car === undefined || item.track === undefined) return;
      byKey[item.car + "::" + item.track + "::" + item.name] = item;
    });
    var unique = Object.keys(byKey).map(function (k) { return byKey[k]; });

    if (!unique.length && !visited.length) {
      complete("Garage61 lido: nenhum setup novo para importar.", 0, 0);
      return;
    }

    setStatus(unique.length ? "Enviando " + unique.length + " setup(s) para o iRacing Analytics..." : "Registrando " + visited.length + " evento(s) sem setup capturável...");
    fetch(IMPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-import-key": key },
      body: JSON.stringify({ items: unique, checkedEvents: visited }),
    }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        setProgress(100);
        if (!result.ok) { setStatus("Erro ao enviar: " + result.data.message); return; }
        complete("Garage61 lido: " + result.data.imported + " setup(s) novo(s) importado(s), " + result.data.skipped + " já existentes. " + (unique.length < visited.length ? (visited.length - unique.length) + " evento(s) sem setup ficam de fora por 7 dias." : ""), result.data.imported, result.data.skipped);
        (result.data.errors || []).forEach(function (err) { log(err); });
      })
      .catch(function (err) { setStatus("Erro de rede ao enviar: " + err.message); });
  }
})();
