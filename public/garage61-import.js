(function () {
  var IMPORT_URL = "https://iracing-analytics.vercel.app/api/setup/garage61-import";
  var API_BASE = "https://garage61.net/api/v1";

  var existing = document.getElementById("iracing-import-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = "iracing-import-overlay";
  overlay.style.cssText = "position:fixed;top:16px;right:16px;z-index:999999;width:340px;background:#1c2228;color:#fff;font:13px/1.5 -apple-system,Segoe UI,sans-serif;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;";
  overlay.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">iRacing Analytics — importar setups</div>' +
    '<div id="iri-status">Iniciando...</div>' +
    '<div id="iri-bar-wrap" style="margin-top:10px;height:6px;background:#3a4450;border-radius:3px;overflow:hidden;"><div id="iri-bar" style="height:100%;width:0%;background:#0877c9;transition:width .2s;"></div></div>' +
    '<div id="iri-log" style="margin-top:10px;max-height:160px;overflow:auto;font-size:11px;color:#aeb8c1;"></div>' +
    '<div style="margin-top:10px;text-align:right;"><button id="iri-close" style="background:#2a323b;color:#fff;border:1px solid #3a4450;border-radius:4px;padding:5px 10px;cursor:pointer;">Fechar</button></div>';
  document.body.appendChild(overlay);
  document.getElementById("iri-close").onclick = function () { overlay.remove(); };

  var statusEl = document.getElementById("iri-status");
  var barEl = document.getElementById("iri-bar");
  var logEl = document.getElementById("iri-log");
  function setStatus(text) { statusEl.textContent = text; }
  function setProgress(pct) { barEl.style.width = Math.max(0, Math.min(100, pct)) + "%"; }
  function log(text) { var line = document.createElement("div"); line.textContent = text; logEl.appendChild(line); logEl.scrollTop = logEl.scrollHeight; }

  function getJson(path, params) {
    var url = new URL(API_BASE + path);
    if (params) Object.keys(params).forEach(function (key) { if (params[key] !== undefined) url.searchParams.set(key, params[key]); });
    return fetch(url.toString(), { credentials: "include", headers: { Accept: "application/json" } }).then(function (res) {
      if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
      return res.json();
    });
  }

  var seasonCache = null;
  function currentSeason() {
    if (seasonCache) return Promise.resolve(seasonCache);
    return getJson("/me/statistics").then(function () { return null; }).catch(function () { return null; });
  }

  setStatus("Buscando suas voltas com setup visível...");

  var allLaps = [];
  function fetchAllLaps(offset) {
    return getJson("/laps", { drivers: "me", group: "none", unclean: "true", lapTypes: "1,2,3,4", limit: 200, offset: offset }).then(function (data) {
      var items = data.items || [];
      allLaps = allLaps.concat(items);
      setStatus("Carregando voltas... " + allLaps.length + " encontradas");
      if (items.length === 200) return fetchAllLaps(offset + 200);
      return allLaps;
    });
  }

  fetchAllLaps(0).then(function () {
    var candidates = allLaps.filter(function (lap) { return lap.canViewSetup; });
    // Keep one representative lap per (event + run), since setup is per-run not per-lap.
    var byRun = {};
    candidates.forEach(function (lap) {
      var key = lap.event + "::" + lap.run;
      if (!byRun[key]) byRun[key] = lap;
    });
    var runs = Object.keys(byRun).map(function (key) { return byRun[key]; });
    setStatus("0 / " + runs.length + " setups verificados");
    log(runs.length + " sessões com setup visível encontradas.");

    var collected = [];
    var index = 0;

    function next() {
      if (index >= runs.length) return finish();
      var lap = runs[index];
      index += 1;
      setProgress((index / runs.length) * 90);
      setStatus(index + " / " + runs.length + " setups verificados");
      getJson("/laps/" + lap.id).then(function (detail) {
        if (detail && detail.setup && detail.setup.parameters) {
          collected.push({
            car: detail.car ? detail.car.id : lap.car.id,
            track: detail.track ? detail.track.id : lap.track.id,
            name: detail.setup.name,
            seasonId: detail.season ? detail.season.id : (lap.season ? lap.season.id : undefined),
            runId: lap.id,
            event: lap.event,
            setupFixed: !!detail.setupFixed,
            setupCommercial: !!detail.setupCommercial,
            parameters: detail.setup.parameters,
          });
        }
      }).catch(function (err) {
        log("Erro em " + lap.id + ": " + err.message);
      }).then(next);
    }

    next();

    function finish() {
      // de-dupe by car+track+name, keep most recent occurrence
      var byKey = {};
      collected.forEach(function (item) { byKey[item.car + "::" + item.track + "::" + item.name] = item; });
      var unique = Object.keys(byKey).map(function (key) { return byKey[key]; });

      if (!unique.length) {
        setStatus("Nenhum setup com parâmetros decodificados encontrado.");
        setProgress(100);
        log("Isso pode significar que o navegador não recebeu o campo 'setup' nesta chamada. Avise o desenvolvedor para ajustar o endpoint.");
        return;
      }

      setStatus("Enviando " + unique.length + " setup(s) para o iRacing Analytics...");
      var key = window.prompt("Cole sua chave de importação (GARAGE61_IMPORT_SECRET):", window.localStorage.getItem("iri_key") || "");
      if (!key) { setStatus("Cancelado: chave não informada."); return; }
      window.localStorage.setItem("iri_key", key);

      fetch(IMPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-import-key": key },
        body: JSON.stringify({ items: unique }),
      }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          setProgress(100);
          if (!result.ok) { setStatus("Erro ao enviar: " + result.data.message); return; }
          setStatus("Concluído: " + result.data.imported + " importado(s), " + result.data.skipped + " ignorado(s).");
          (result.data.errors || []).forEach(function (err) { log(err); });
        })
        .catch(function (err) { setStatus("Erro de rede ao enviar: " + err.message); });
    }
  }).catch(function (err) {
    setStatus("Erro: " + err.message);
    log("Verifique se você está logado em garage61.net nesta aba.");
  });
})();
