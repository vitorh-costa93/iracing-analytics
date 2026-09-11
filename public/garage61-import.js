(function () {
  var APP_BASE = "https://iracing-analytics.vercel.app";
  var PENDING_URL = APP_BASE + "/api/setup/garage61-import/pending?days=15";
  var IMPORT_URL = APP_BASE + "/api/setup/garage61-import";
  var LAPS_PENDING_URL = APP_BASE + "/api/sync/garage61-laps/pending";
  var LAPS_IMPORT_URL = APP_BASE + "/api/sync/garage61-laps";
  var GAP_BETWEEN_EVENTS_MS = 400;
  // 11/09/2026: "extremamente lento... tá demorando horrores" -- sync/incremental's real bottleneck
  // was discovering sessions/laps/sectors via Garage61's public, rate-limited /api/v1/laps endpoint.
  // This SAME bookmarklet (already used for setups) now also walks Garage61's own INTERNAL api
  // (garage61.net/api/internal/...) for that data instead -- the exact calls their own web app makes
  // when you browse it, not subject to the public developer API's rate limit. "Sempre incremental":
  // OVERVIEW_LIMIT bounds how many recent car/track combos are even considered, and every one of them
  // is further filtered against the server's own cutoff (LAPS_PENDING_URL) before any event is visited.
  var OVERVIEW_LIMIT = 60;

  var existing = document.getElementById("iracing-import-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = "iracing-import-overlay";
  overlay.style.cssText = "position:fixed;top:16px;right:16px;z-index:999999;width:340px;background:#1c2228;color:#fff;font:13px/1.5 -apple-system,Segoe UI,sans-serif;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;";
  overlay.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">iRacing Analytics — importar setups + voltas</div>' +
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

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var collected = []; // setups
  var visited = []; // every event actually visited this run, whether or not a setup was captured
  var sessionsOut = []; // driving_sessions rows to upsert
  var lapsOut = []; // laps rows to upsert
  var sectorsOut = []; // lap_sectors rows to upsert
  var sessionByKey = {}; // "${eventId}:${sessionIdx}:${carId}:${trackId}" -> aggregate accumulator

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
    for (var key2 in node) {
      if (Object.prototype.hasOwnProperty.call(node, key2)) captureIfSetup(node[key2], eventId, fallbackCar, fallbackTrack, depth + 1);
    }
  }

  // 11/09/2026: the SAME event response already fetched above for setup capture also carries every
  // lap this driver did in that event, one level up from where captureIfSetup looks -- no extra
  // network calls needed. lapEndTime mirrors sync/incremental's own (a session's real end is the end
  // of its LAST lap, not its first lap's start, otherwise a 1-lap early-DNF always looks 0 minutes long).
  function lapEndTime(lap) {
    if (!lap.start_time) return lap.start_time;
    if (!(lap.lap_time > 0)) return lap.start_time;
    return new Date(new Date(lap.start_time).getTime() + Number(lap.lap_time) * 1000).toISOString();
  }
  function captureSessionsAndLaps(event) {
    var eventId = event.id;
    var eventType = typeof event.event_type === "number" ? event.event_type : null;
    (event.sessions || []).forEach(function (session, sessionIdx) {
      var sessionId = String(sessionIdx);
      var runGroups = session.run_groups || [];
      runGroups.forEach(function (runGroup) {
        (runGroup.runs || []).forEach(function (run) {
          (run.laps || []).forEach(function (lap) {
            if (typeof lap.car_id !== "number" || typeof lap.track_id !== "number" || !lap.start_time) return;
            var key3 = eventId + ":" + sessionId + ":" + lap.car_id + ":" + lap.track_id;
            var endedAt = lapEndTime(lap);
            var agg = sessionByKey[key3];
            if (!agg) {
              agg = sessionByKey[key3] = {
                eventId: eventId, sessionId: sessionId, carId: lap.car_id, trackId: lap.track_id,
                seasonId: lap.season !== undefined && lap.season !== null ? String(lap.season) : null,
                sessionType: typeof lap.session_type === "number" ? lap.session_type : (typeof session.session_type === "number" ? session.session_type : null),
                eventType: eventType, startedAt: lap.start_time, endedAt: endedAt, lapCount: 0,
              };
              sessionsOut.push(agg);
            }
            agg.lapCount += 1;
            if (lap.start_time < agg.startedAt) agg.startedAt = lap.start_time;
            if (endedAt > agg.endedAt) agg.endedAt = endedAt;

            lapsOut.push({
              id: lap.id, carId: lap.car_id, trackId: lap.track_id,
              lapNumber: typeof lap.lap_number === "number" ? lap.lap_number : null,
              lapTime: typeof lap.lap_time === "number" ? lap.lap_time : null,
              clean: lap.clean === true ? true : (lap.clean === false ? false : null),
              joker: lap.joker === true ? true : (lap.joker === false ? false : null),
              discontinuity: lap.discontinuity === true ? true : (lap.discontinuity === false ? false : null),
              missing: lap.missing === true ? true : (lap.missing === false ? false : null),
              incomplete: lap.incomplete === true ? true : (lap.incomplete === false ? false : null),
              offTrack: lap.offtrack === true ? true : (lap.offtrack === false ? false : null),
              pitLane: lap.pitlane === true ? true : (lap.pitlane === false ? false : null),
              pitIn: lap.pit_in === true ? true : (lap.pit_in === false ? false : null),
              pitOut: lap.pit_out === true ? true : (lap.pit_out === false ? false : null),
              driverRating: typeof lap.driver_rating === "number" ? lap.driver_rating : null,
              fuelLevel: typeof lap.fuel_level === "number" ? lap.fuel_level : null,
              fuelUsed: typeof lap.fuel_used === "number" ? lap.fuel_used : null,
              fuelAdded: typeof lap.fuel_added === "number" ? lap.fuel_added : null,
              weightPenalty: typeof lap.weight_penalty === "number" ? lap.weight_penalty : null,
              powerAdjust: typeof lap.power_adjust === "number" ? lap.power_adjust : null,
              tireCompound: typeof lap.tire_compound === "number" ? lap.tire_compound : null,
              canViewTelemetry: !!lap.can_view_telemetry,
              canViewSetup: !!run.can_view_setup,
              payload: lap,
            });
            (lap.sectors || []).forEach(function (sector, sectorIdx) {
              sectorsOut.push({ lapId: lap.id, sectorNumber: sectorIdx + 1, sectorTime: typeof sector.sector_time === "number" ? sector.sector_time : null, incomplete: !!sector.incomplete });
            });
          });
        });
      });
    });
  }

  // No hidden iframe anymore. This bookmarklet already runs as a script ON a garage61.net page, so a
  // plain same-origin fetch to the exact API call the event page itself makes carries the session
  // cookie automatically -- no need to load Garage61's whole SPA (a few dozen JS/chunk/asset requests
  // per event) inside an invisible iframe just to trigger that one call. That iframe approach kept
  // timing out on a real weak-signal mobile connection (confirmed live, 29/08/2026) no matter how long
  // the wait was raised, because the bottleneck was the SPA's own boot cost, not this one request.
  // Confirmed this exact endpoint returns the same JSON shape captureIfSetup already knows how to walk.
  async function visitEvent(eventId, fallbackCar, fallbackTrack) {
    try {
      var res = await fetch("https://garage61.net/api/internal/events/" + eventId, { credentials: "same-origin" });
      if (!res.ok) { log("Evento " + eventId + ": HTTP " + res.status + ", pulando."); return; }
      var json = await res.json();
      var eventFallbackCar = json && typeof json.car_id === "number" ? json.car_id : fallbackCar;
      var eventFallbackTrack = json && typeof json.track_id === "number" ? json.track_id : fallbackTrack;
      captureIfSetup(json, eventId, eventFallbackCar, eventFallbackTrack, 0);
      captureSessionsAndLaps(json);
    } catch (e) { log("Evento " + eventId + ": erro de rede, pulando."); }
  }

  async function visitAllSetupEvents(events) {
    for (var index = 0; index < events.length; index++) {
      var event = events[index];
      setProgress(((index + 1) / events.length) * 40);
      setStatus("Setups: " + (index + 1) + " / " + events.length + " — evento #" + event.eventId);
      visited.push({ eventId: event.eventId, car: event.car, track: event.track });
      await visitEvent(event.eventId, event.car, event.track);
      await sleep(GAP_BETWEEN_EVENTS_MS);
    }
  }

  // 11/09/2026: discovers recent car/track activity and per-pair event lists via Garage61's own
  // internal api (the same calls garage61.net's OWN dashboard makes) instead of paginating the public,
  // rate-limited /api/v1/laps -- see this file's top comment. "Sempre incremental": everything here is
  // filtered against `cutoffIso` (from LAPS_PENDING_URL, the same window sync/incremental itself uses)
  // before a single event page is fetched, and events already captured above (visited setup events)
  // are skipped to avoid refetching the same page twice in one run.
  async function discoverAndVisitLapsEvents(cutoffIso, alreadyVisitedIds) {
    var configRes = await fetch("https://garage61.net/api/internal/config", { credentials: "same-origin" });
    var config = await configRes.json();
    var slug = config && config.user && config.user.slug;
    if (!slug) { log("Não achei o usuário logado no Garage61 -- pulando voltas/sessões."); return; }

    var overviewRes = await fetch("https://garage61.net/api/internal/overview/events?limit=" + OVERVIEW_LIMIT, { credentials: "same-origin" });
    var overview = await overviewRes.json();
    var pairs = (overview.items || []).filter(function (item) {
      return item.last_at >= cutoffIso && item.car && item.track;
    });
    log(pairs.length + " combinação(ões) de carro/pista com atividade recente.");

    var eventIds = {};
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      setStatus("Voltas: buscando eventos " + (i + 1) + "/" + pairs.length + " — " + pair.car.name);
      setProgress(40 + ((i + 1) / Math.max(1, pairs.length)) * 20);
      try {
        var evRes = await fetch("https://garage61.net/api/internal/events?user=" + encodeURIComponent(slug) + "&car=" + pair.car.id + "&track=" + pair.track.id, { credentials: "same-origin" });
        var evJson = await evRes.json();
        (evJson.items || []).forEach(function (ev) {
          if (ev.started_at >= cutoffIso && !alreadyVisitedIds[ev.id]) eventIds[ev.id] = { car: ev.car_id, track: ev.track_id };
        });
      } catch (e) { log("Falha ao listar eventos de " + pair.car.name + "/" + pair.track.name + "."); }
      await sleep(150);
    }

    var ids = Object.keys(eventIds);
    log(ids.length + " evento(s) novo(s) de sessões/voltas para sincronizar.");
    for (var j = 0; j < ids.length; j++) {
      setStatus("Voltas: " + (j + 1) + " / " + ids.length + " — evento #" + ids[j]);
      setProgress(60 + ((j + 1) / Math.max(1, ids.length)) * 30);
      await visitEvent(ids[j], eventIds[ids[j]].car, eventIds[ids[j]].track);
      await sleep(GAP_BETWEEN_EVENTS_MS);
    }
  }

  function finishSetups() {
    var byKey = {};
    collected.forEach(function (item) {
      if (item.car === undefined || item.track === undefined) return;
      byKey[item.car + "::" + item.track + "::" + item.name] = item;
    });
    var unique = Object.keys(byKey).map(function (k) { return byKey[k]; });
    if (!unique.length && !visited.length) return Promise.resolve({ imported: 0, updated: 0, skipped: 0 });
    return fetch(IMPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-import-key": key },
      body: JSON.stringify({ items: unique, checkedEvents: visited }),
    }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { log("Erro ao enviar setups: " + result.data.message); return { imported: 0, updated: 0, skipped: 0 }; }
        (result.data.errors || []).forEach(function (err) { log(err); });
        return result.data;
      })
      .catch(function (err) { log("Erro de rede ao enviar setups: " + err.message); return { imported: 0, updated: 0, skipped: 0 }; });
  }

  function finishLaps() {
    if (!sessionsOut.length && !lapsOut.length) return Promise.resolve({ sessionsUpserted: 0, lapsUpserted: 0, sectorsUpserted: 0 });
    return fetch(LAPS_IMPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-import-key": key },
      body: JSON.stringify({ sessions: sessionsOut, laps: lapsOut, sectors: sectorsOut }),
    }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { log("Erro ao enviar voltas: " + result.data.message); return { sessionsUpserted: 0, lapsUpserted: 0, sectorsUpserted: 0 }; }
        return result.data;
      })
      .catch(function (err) { log("Erro de rede ao enviar voltas: " + err.message); return { sessionsUpserted: 0, lapsUpserted: 0, sectorsUpserted: 0 }; });
  }

  async function run() {
    setStatus("Buscando lista de corridas recentes (setups)...");
    var setupEvents = [];
    try {
      var pendingRes = await fetch(PENDING_URL, { headers: { "x-import-key": key, Accept: "application/json" } });
      if (pendingRes.status === 401) { window.localStorage.removeItem("iri_key"); throw new Error("Chave de importação inválida. Rode o bookmarklet de novo para informar outra."); }
      var pendingData = await pendingRes.json();
      if (pendingData.status !== "ok") throw new Error(pendingData.message || "Erro ao buscar corridas pendentes");
      setupEvents = pendingData.events || [];
      log(setupEvents.length + " evento(s) pendente(s) de setup nos últimos " + pendingData.days + " dias.");
    } catch (err) {
      setStatus("Erro: " + err.message);
      return;
    }

    if (setupEvents.length) await visitAllSetupEvents(setupEvents);

    setStatus("Voltas: verificando até onde já sincronizamos...");
    try {
      var cutoffRes = await fetch(LAPS_PENDING_URL, { headers: { "x-import-key": key, Accept: "application/json" } });
      var cutoffData = await cutoffRes.json();
      if (cutoffData.status === "ok") {
        var alreadyVisited = {};
        visited.forEach(function (v) { alreadyVisited[v.eventId] = true; });
        await discoverAndVisitLapsEvents(cutoffData.cutoff, alreadyVisited);
      } else {
        log("Não consegui obter o corte incremental de voltas: " + cutoffData.message);
      }
    } catch (e) {
      log("Falha ao sincronizar voltas/sessões: " + e.message);
    }

    setStatus("Enviando dados para o iRacing Analytics...");
    var setupResult = await finishSetups();
    var lapsResult = await finishLaps();
    setProgress(100);
    var parts = [];
    if (setupResult.imported || setupResult.updated || setupResult.skipped) parts.push(setupResult.imported + " setup(s) novo(s), " + (setupResult.updated || 0) + " atualizado(s)");
    parts.push((lapsResult.sessionsUpserted || 0) + " sessão(ões), " + (lapsResult.lapsUpserted || 0) + " volta(s), " + (lapsResult.sectorsUpserted || 0) + " setor(es)");
    complete("Garage61 lido: " + parts.join("; ") + ".", (setupResult.imported || 0) + (lapsResult.lapsUpserted || 0), setupResult.skipped || 0);
  }

  run();
})();
