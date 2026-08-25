(function () {
  var APP_BASE = "https://iracing-analytics.vercel.app";
  var INGEST_URL = APP_BASE + "/api/sync/irstats/ingest";
  var DRIVER_ID = "958741";
  var REQUEST_GAP_MS = 3000;
  var BATCH_SIZE = 15;
  var FULL_SCAN = window.localStorage.getItem("iis_full_scan") === "true";
  var state = window.__iisState = {
    status: "starting",
    page: 0,
    found: 0,
    imported: 0,
    failed: 0,
    skipped: 0,
    total: null,
    fullScan: FULL_SCAN,
    updatedAt: new Date().toISOString()
  };

  var existing = document.getElementById("irstats-import-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = "irstats-import-overlay";
  overlay.style.cssText = "position:fixed;top:16px;right:16px;z-index:999999;width:340px;background:#1c2228;color:#fff;font:13px/1.5 -apple-system,Segoe UI,sans-serif;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;";
  overlay.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">iRacing Analytics — importar corridas</div>' +
    '<div id="iis-status">Iniciando...</div>' +
    '<div id="iis-bar-wrap" style="margin-top:10px;height:6px;background:#3a4450;border-radius:3px;overflow:hidden;"><div id="iis-bar" style="height:100%;width:0%;background:#0877c9;transition:width .2s;"></div></div>' +
    '<div id="iis-log" style="margin-top:10px;max-height:200px;overflow:auto;font-size:11px;color:#aeb8c1;"></div>' +
    '<div style="margin-top:10px;text-align:right;"><button id="iis-close" style="background:#2a323b;color:#fff;border:1px solid #3a4450;border-radius:4px;padding:5px 10px;cursor:pointer;">Fechar</button></div>';
  document.body.appendChild(overlay);
  document.getElementById("iis-close").onclick = function () { overlay.remove(); };

  var statusEl = document.getElementById("iis-status");
  var barEl = document.getElementById("iis-bar");
  var logEl = document.getElementById("iis-log");
  function updateState(patch) {
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  }
  function setStatus(text) {
    statusEl.textContent = text;
    updateState({ status: text });
  }
  function setProgress(pct) {
    var bounded = Math.max(0, Math.min(100, pct));
    barEl.style.width = bounded + "%";
    updateState({ progress: bounded });
  }
  function log(text) { var line = document.createElement("div"); line.textContent = text; logEl.appendChild(line); logEl.scrollTop = logEl.scrollHeight; }

  var key = window.localStorage.getItem("iis_key");
  if (!key) {
    key = window.prompt("Cole sua chave de importação (IRSTATS_IMPORT_SECRET) — só precisa fazer isso uma vez:", "");
    if (!key) { setStatus("Cancelado: chave não informada."); return; }
    window.localStorage.setItem("iis_key", key);
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  // Cloudflare sometimes serves a soft rate-limit/interstitial page with HTTP 200 (not 429) once
  // requests come in sustained volume — status alone can't detect it, so callers pass a
  // `isValidBody` check (e.g. "does this look like a real race page") to retry on that too.
  async function fetchWithRetry(url, opts, maxRetries, isValidBody) {
    maxRetries = maxRetries || 5;
    var lastReason = "resposta inesperada";
    for (var attempt = 1; attempt <= maxRetries + 1; attempt++) {
      var res = await fetch(url, opts);
      if (res.status === 429) {
        lastReason = "HTTP 429";
        if (attempt > maxRetries) return { text: null, reason: lastReason };
        await sleep(REQUEST_GAP_MS * attempt);
        continue;
      }
      if (!res.ok) return { text: null, reason: "HTTP " + res.status };
      var text = await res.text();
      if (!isValidBody || isValidBody(text)) return { text: text, reason: null };
      lastReason = "conteúdo inesperado (bloqueio temporário?)";
      if (attempt > maxRetries) return { text: null, reason: lastReason };
      await sleep(REQUEST_GAP_MS * attempt);
    }
    return { text: null, reason: lastReason };
  }

  function extractRaceIds(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var links = doc.querySelectorAll('a[href^="/race/"]');
    var ids = [];
    links.forEach(function (a) {
      var match = a.getAttribute("href").match(/^\/race\/(\d+)$/);
      if (match) ids.push(Number(match[1]));
    });
    return ids;
  }

  async function run() {
    setStatus("Verificando corridas já importadas...");
    var knownRes = await fetch(INGEST_URL, { headers: { "x-import-key": key, Accept: "application/json" } });
    if (knownRes.status === 401) { window.localStorage.removeItem("iis_key"); throw new Error("Chave de importação inválida. Rode de novo para informar outra."); }
    var knownData = await knownRes.json();
    if (knownData.status !== "ok") throw new Error(knownData.message || "Erro ao buscar corridas conhecidas");
    var known = new Set(knownData.knownIds || []);
    updateState({ skipped: known.size });
    log(known.size + " corrida(s) já no banco.");

    // After the full backfill, regular runs should only walk the newest pages until they hit an
    // already-complete page. Set localStorage.iis_full_scan = "true" before running if a later
    // audit ever needs to search for old gaps again.
    var newRaceIds = [];
    var page = 0;
    while (true) {
      updateState({ page: page });
      setStatus("Lendo página " + page + " da lista de corridas...");
      await sleep(REQUEST_GAP_MS);
      var listResult = await fetchWithRetry(
        "/driver/" + DRIVER_ID + "/races?page=" + page,
        { credentials: "same-origin" },
        5,
        function (text) { return text.indexOf("<table") !== -1; }
      );
      if (listResult.text === null) { log("Página " + page + ": " + listResult.reason + ", parando."); break; }
      var listHtml = listResult.text;
      var ids = extractRaceIds(listHtml);
      if (!ids.length) { log("Página " + page + " sem corridas, fim da lista."); break; }

      var newOnPage = 0;
      for (var i = 0; i < ids.length; i++) {
        if (!known.has(ids[i])) { newRaceIds.push(ids[i]); newOnPage++; }
      }
      updateState({ found: newRaceIds.length });
      log("Página " + page + ": " + newOnPage + " nova(s) de " + ids.length + ".");
      if (!FULL_SCAN && newOnPage === 0) { log("Página já completa; import incremental encerrado."); break; }

      page += 1;
      if (page > 30) { log("Limite de páginas atingido (30), parando."); break; }
    }

    if (!newRaceIds.length) {
      setStatus("Nenhuma corrida nova para importar.");
      setProgress(100);
      return;
    }

    log(newRaceIds.length + " corrida(s) nova(s) encontrada(s). Buscando detalhes...");
    updateState({ total: newRaceIds.length });

    var batch = [];
    var totalImported = 0;
    var totalFailed = 0;

    async function flushBatch() {
      if (!batch.length) return;
      setStatus("Enviando lote de " + batch.length + " corrida(s)...");
      var res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-import-key": key },
        body: JSON.stringify({ races: batch }),
      });
      var data = await res.json();
      if (!res.ok || data.status !== "ok") {
        log("Erro ao enviar lote: " + (data.message || res.status));
      } else {
        totalImported += data.imported;
        totalFailed += data.failed;
        updateState({ imported: totalImported, failed: totalFailed });
        (data.results || []).forEach(function (r) {
          if (r.status === "error") log("Corrida " + r.raceId + ": " + r.message);
        });
      }
      batch = [];
    }

    for (var j = 0; j < newRaceIds.length; j++) {
      var raceId = newRaceIds[j];
      setStatus((j + 1) + " / " + newRaceIds.length + " corridas — buscando #" + raceId);
      setProgress(((j + 1) / newRaceIds.length) * 100);
      await sleep(REQUEST_GAP_MS);
      var detailResult = await fetchWithRetry(
        "/race/" + raceId,
        { credentials: "same-origin" },
        5,
        function (text) { return text.indexOf('class="lb-title') !== -1; }
      );
      if (detailResult.text === null) { log("Corrida " + raceId + ": " + detailResult.reason + ", pulando."); continue; }
      var detailHtml = detailResult.text;
      batch.push({ raceId: raceId, html: detailHtml });
      if (batch.length >= BATCH_SIZE) await flushBatch();
    }
    await flushBatch();

    setStatus("Concluído: " + totalImported + " importada(s), " + totalFailed + " com erro.");
    setProgress(100);
  }

  run().catch(function (err) {
    setStatus("Erro: " + err.message);
    log(String(err.stack || err));
  });
})();
