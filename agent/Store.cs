using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RacingAgent;

sealed class State
{
    public DateTimeOffset Activated { get; set; } = DateTimeOffset.UtcNow;
    public HashSet<string> Files { get; set; } = [];
    public string Day { get; set; } = "";
    public int Requests { get; set; }
    public long Bytes { get; set; }
    public int DailyLimit { get; set; } = 60;
    public int Successes { get; set; }
    public DateTimeOffset Next { get; set; }
    public bool AuthPaused { get; set; }
    public bool ExperimentalExport { get; set; }
    public bool ExportMigrated { get; set; }
    public bool PendingResult { get; set; }
    public bool AutoRecord { get; set; } = true;
    public HashSet<long> ResultSubsessions { get; set; } = [];
    public string ExportDay { get; set; } = "";
    public int Exports { get; set; }
    public DateTimeOffset LastScan { get; set; }
    /// <summary>Most recent official-result subsession ids handled by the idle exporter (newest first, max 20).</summary>
    public List<long> LastResultIds { get; set; } = [];
    /// <summary>Fingerprints of "Recent Races" rows already confirmed (server knew the subsession, or its JSON was queued). Rows in this set are never reopened; any other visible row (up to 10) is checked id by id.</summary>
    public HashSet<string> SentRaces { get; set; } = [];
    public bool StartupInit { get; set; }
    /// <summary>One-time reset (field-of-race release): the server now defines "known" (race has its field stored); local LastResultIds no longer suppress re-sends.</summary>
    public bool FieldMigrated { get; set; }
    /// <summary>Historical backfill: finished "year-season" targets (e.g. "2026-3"), and the resume cursor of the one in progress.</summary>
    public HashSet<string> BackfillDone { get; set; } = [];
    public string BackfillKey { get; set; } = "";
    public int BackfillIndex { get; set; }
    public int BackfillTotal { get; set; }
    public Dictionary<string, Attempt> Attempts { get; set; } = [];
    /// <summary>Reference searches per car/track/season, retried daily including previously queued references.</summary>
    public Dictionary<string, DateTimeOffset> References { get; set; } = [];
    public DateTimeOffset LastReferenceScan { get; set; }
    public Dictionary<string, string> ReferencePayloads { get; set; } = [];
    public Dictionary<string, string> ReferenceFingerprints { get; set; } = [];
    public int ReferenceScanCursor { get; set; }
    /// <summary>Keys of ibt_setup payloads already queued (one per distinct setup/car/track/season; newest last, max 500).</summary>
    public List<string> SetupKeys { get; set; } = [];
}
sealed class Attempt { public int Count { get; set; } public DateTimeOffset Next { get; set; } }
sealed class Store
{
    // Excepcional: só durante --backfill-results real (janela de backfill do servidor, 3000 req/dia). Resultados usam p_bytes=0 no servidor.
    public static volatile bool BackfillMode;
    public readonly string Root;
    public State State { get; }
    public string Status { get; private set; } = "Aguardando arquivos";
    readonly HttpClient http;
    readonly Queue<DateTimeOffset> recent = new();
    readonly object persistGate = new();
    readonly Dictionary<string, (long size, DateTime modified)> observed = [];
    public string Endpoint { get; }
    public Store(string root, string endpoint, HttpMessageHandler? handler = null)
    {
        Root = root; Endpoint = endpoint;
        Directory.CreateDirectory(root); AgentLog.Init(root); Directory.CreateDirectory(Path.Combine(root, "queue")); Directory.CreateDirectory(Path.Combine(root, "quarantine"));
        State = File.Exists(Path.Combine(root, "state.json")) ? JsonSerializer.Deserialize<State>(File.ReadAllBytes(Path.Combine(root, "state.json"))) ?? throw new InvalidDataException("state_invalid") : new();
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(40) };
        Save();
    }
    public static void Atomic(string path, byte[] bytes)
    {
        var temp = path + ".tmp";
        using (var f = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { f.Write(bytes); f.Flush(true); }
        File.Move(temp, path, true);
    }
    public void Save()
    {
        try { lock (persistGate) Atomic(Path.Combine(Root, "state.json"), JsonSerializer.SerializeToUtf8Bytes(State)); }
        catch (Exception e) { AgentLog.Error("Save(state.json)", e); throw; }
    }
    public void Token(string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096 || token.Any(char.IsControl)) throw new ArgumentException("Token inválido");
        Atomic(Path.Combine(Root, "credential.bin"), Dpapi.Protect(Encoding.UTF8.GetBytes(token.Trim()), false));
        State.AuthPaused = false; State.Next = default; Save();
    }
    string? Token() => File.Exists(Path.Combine(Root, "credential.bin")) ? Encoding.UTF8.GetString(Dpapi.Protect(File.ReadAllBytes(Path.Combine(Root, "credential.bin")), true)) : null;
    static int Priority(string file) { try { using var s=File.OpenRead(file);var b=new byte[64];var n=s.Read(b,0,b.Length);var head=Encoding.UTF8.GetString(b,0,n);return head.Contains("\"kind\":\"result\"")||head.Contains("\"kind\":\"ibt_result\"")?0:head.Contains("\"kind\":\"reference\"")?1:2;}catch{return 2;} }
    public int Backlog => Directory.GetFiles(Path.Combine(Root, "queue"), "*.json").Length;
    public int Quarantined => Directory.GetFiles(Path.Combine(Root, "quarantine"), "*.json").Length;
    public void Enqueue(byte[] payload)
    {
        using var doc = JsonDocument.Parse(payload);
        var key = doc.RootElement.GetProperty("key").GetString()!;
        if (key.Length != 64 || key.Any(c => !char.IsAsciiHexDigit(c))) throw new InvalidDataException("queue_key");
        if (payload.Length > (doc.RootElement.GetProperty("kind").GetString() switch { "result" => 1024 * 1024, "ibt_result" => SessionResult.MaxPayload, "ibt_setup" => IbtSetup.MaxPayload, _ => 512 * 1024 })) throw new InvalidDataException("payload_size");
        var path = Path.Combine(Root, "queue", key + ".json");
        if (File.Exists(path) || File.Exists(Path.Combine(Root, "quarantine", key + ".json"))) return;
        if (Directory.EnumerateFiles(Path.Combine(Root, "queue")).Concat(Directory.EnumerateFiles(Path.Combine(Root, "quarantine"))).Sum(p => new FileInfo(p).Length) + payload.Length > 100L * 1024 * 1024) throw new IOException("queue_full");
        Atomic(path, payload);
    }
    /// <summary>One estimated result per subsession (live SessionInfo or official .ibt block);
    /// the first captured snapshot wins so the server never sees a conflicting body.</summary>
    public bool EnqueueResult(SessionResult.Snapshot snapshot)
    {
        lock (persistGate)
        {
            if (State.ResultSubsessions.Contains(snapshot.SubsessionId)) return false;
            Enqueue(snapshot.Payload); State.ResultSubsessions.Add(snapshot.SubsessionId); State.PendingResult = false;
        }
        Save(); Status = snapshot.ResultsOfficial ? "Resultado oficial capturado" : "Resultado provisório capturado"; return true;
    }
    /// <summary>Queues the CarSetup of an own .ibt once per distinct setup (deterministic key); readouts such as tyre
    /// wear or fuel do not create a new setup. Never blocks the telemetry of the same file.</summary>
    public bool EnqueueSetup(Stream stream)
    {
        byte[]? payload;
        try { payload = IbtSetup.FromIbt(stream, out _); } catch (Exception e) when (e is InvalidDataException or EndOfStreamException or JsonException) { return false; }
        if (payload is null) return false;
        using (var doc = JsonDocument.Parse(payload))
        {
            var key = doc.RootElement.GetProperty("key").GetString()!;
            lock (persistGate)
            {
                if (State.SetupKeys.Contains(key)) return false;
                Enqueue(payload); State.SetupKeys.Add(key); if (State.SetupKeys.Count > 500) State.SetupKeys.RemoveRange(0, State.SetupKeys.Count - 500);
            }
        }
        Save(); return true;
    }
    /// <summary>Queues an official event_result JSON exported by the idle exporter (no file left in
    /// Downloads). Returns the subsession id, or null when the payload is not an event_result.</summary>
    public long? EnqueueOfficial(byte[] json, HashSet<long>? known = null)
    {
        if (json.Length > 1024 * 1024) return null;
        json = ResultReducer.Reduce(json); // same envelope, only useless keys removed (cuts the daily byte budget)
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("type", out var type) || type.GetString() != "event_result"
            || !doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object
            || !data.TryGetProperty("subsession_id", out var sub) || !sub.TryGetInt64(out var id)) return null;
        if (known?.Contains(id) == true) return id;
        Enqueue(JsonSerializer.SerializeToUtf8Bytes(new { version = 1, kind = "result", key = Ibt.Hash(Canonical(doc.RootElement)), export = doc.RootElement }));
        lock (persistGate) { State.PendingResult = false; }
        Save(); Status = "Resultado oficial exportado"; return id;
    }
    /// <summary>Subsessions whose official result the server already has (bounded GET, ids only).</summary>
    public async Task<HashSet<long>?> KnownResults(CancellationToken cancellation, bool all = false)
    {
        var token = Token(); if (token is null || State.AuthPaused) return null;
        // scope=all: every stored result, not just the recent window (historical backfill).
        using var request = new HttpRequestMessage(HttpMethod.Get, all ? Endpoint + (Endpoint.Contains('?') ? "&" : "?") + "scope=all" : Endpoint); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        try
        {
            using var response = await http.SendAsync(request, cancellation);
            if (response.StatusCode == HttpStatusCode.Unauthorized) { State.AuthPaused = true; Save(); return null; }
            if (!response.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(cancellation));
            return doc.RootElement.GetProperty("known").EnumerateArray().Select(e => e.GetInt64()).ToHashSet();
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException or TaskCanceledException) { return null; }
    }
    /// <summary>Collects one source file. With deleteSource, a manual Downloads event_result JSON is removed once it is
    /// validated as event_result, queued and its hash checkpointed (or its hash was already checkpointed). .ibt and anything
    /// not validated are never deleted.</summary>
    public void Collect(string path, bool backfill = false, bool deleteSource = false)
    {
        var deletable = CollectCore(path, backfill);
        if (!deleteSource || !deletable) return;
        try { File.Delete(path); AgentLog.Write("Downloads: eventresult coletado e removido"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { AgentLog.Error("remover eventresult de Downloads", e); }
    }
    bool CollectCore(string path, bool backfill)
    {
        var deletable = false;
        var info = new FileInfo(path);
        var isIbt = path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase);
        if (!backfill && info.LastWriteTimeUtc < State.Activated.UtcDateTime) return false;
        if (info.LastWriteTimeUtc > DateTime.UtcNow.AddSeconds(-30)) return false;
        if (observed.TryGetValue(path, out var previous) && previous == (info.Length, info.LastWriteTimeUtc)) return false;
        if (info.Length > (isIbt ? Ibt.MaxFile : 1024 * 1024)) { Status = "Arquivo acima do limite; intervenção necessária"; return false; }
        // Exclusive open proves the simulator/exporter released its file. A crash before the
        // checkpoint replays it; deterministic queue keys deduplicate durable payloads.
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
        var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        // Hash checkpoints are only recorded after validation + queueing, so a known JSON hash is a validated event_result.
        // Not marked as observed: if the source cannot be deleted now (locked), the next tick retries.
        if (State.Files.Contains(hash)) { if (isIbt) observed[path] = (info.Length, info.LastWriteTimeUtc); return !isIbt; }
        stream.Position = 0;
        try
        {
            if (path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase))
            {
                var result = SessionResult.FromIbt(stream, out _); stream.Position = 0;
                if (result is not null) EnqueueResult(result);
                EnqueueSetup(stream); stream.Position = 0;
            }
            var targets = new Dictionary<string, (string car, int track, int? year, int? quarter)>();
            if (path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase)) foreach (var payload in Ibt.Read(stream))
            {
                Enqueue(payload);
                using var telemetry = JsonDocument.Parse(payload);
                CollectReferenceTarget(telemetry.RootElement.GetProperty("metadata"), targets);
                if (telemetry.RootElement.GetProperty("metadata").GetProperty("sessionType").GetString() == "Race") State.PendingResult = true;
            }
            else
            {
                using var doc = JsonDocument.Parse(stream);
                if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "event_result" || !doc.RootElement.TryGetProperty("data", out _)) throw new InvalidDataException("result_format");
                var canonical = Canonical(doc.RootElement);
                Enqueue(JsonSerializer.SerializeToUtf8Bytes(new { version = 1, kind = "result", key = Ibt.Hash(canonical), export = doc.RootElement }));
                State.PendingResult = false;
            }
            foreach (var target in targets.Values) QueueReference(target.car, target.track, target.year, target.quarter);
            lock (persistGate) { State.Files.Add(hash); Save(); }
            Status = "Arquivo coletado"; deletable = !isIbt;
            if (isIbt) observed[path] = (info.Length, info.LastWriteTimeUtc);
        }
        catch (InvalidDataException) { observed[path] = (info.Length, info.LastWriteTimeUtc); Status = "Arquivo incompatível; intervenção necessária"; }
        catch (JsonException) { observed[path] = (info.Length, info.LastWriteTimeUtc); Status = "Exportação inválida; intervenção necessária"; }
        return deletable;
    }
    static void CollectReferenceTarget(JsonElement metadata, Dictionary<string, (string car, int track, int? year, int? quarter)> targets)
    {
        if (!metadata.TryGetProperty("carPath", out var car) || car.ValueKind != JsonValueKind.String || !metadata.TryGetProperty("nativeTrackId", out var track) || !track.TryGetInt32(out var trackId)) return;
        int? Optional(string name) => metadata.TryGetProperty(name, out var v) && v.TryGetInt32(out var n) ? n : null;
        var year = Optional("seasonYear"); var quarter = Optional("seasonQuarter");
        targets[$"{car.GetString()}|{trackId}|{year}S{quarter}"] = (car.GetString()!, trackId, year, quarter);
    }
    /// <summary>Reads only recent own IBT headers, including checkpointed files; never queues own telemetry.</summary>
    public string ScanReferences(IEnumerable<string> sources, bool force = false, int limit = 5, string? setupsRoot = null)
    {
        var now = DateTimeOffset.UtcNow;
        if (!force && State.LastReferenceScan > now.AddHours(-1)) return "";
        var targets = new Dictionary<string, (string car, int track, int? year, int? quarter)>(); var errors = 0;
        foreach (var path in sources.Where(p => p.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase))
            .Where(p => File.GetLastWriteTimeUtc(p) >= now.AddDays(-30).UtcDateTime)
            .OrderByDescending(File.GetLastWriteTimeUtc).Take(40))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(path) > now.AddSeconds(-30).UtcDateTime) continue;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
                if (ReferenceFinder.PeekTarget(stream) is { } target)
                    targets.TryAdd($"{target.car}|{target.track}|{target.year}S{target.quarter}", target);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException) { errors++; }
        }
        var queued = 0; var scanned = 0;
        var values=targets.Values.ToArray();var cursor=values.Length==0?0:Math.Abs((long)State.ReferenceScanCursor)%values.Length;
        foreach (var target in values.Skip((int)cursor).Concat(values.Take((int)cursor)).Take(Math.Clamp(limit, 1, 20)))
        { scanned++; if (QueueReference(target.car, target.track, target.year, target.quarter, force, setupsRoot)) queued++; }
        State.ReferenceScanCursor=values.Length==0?0:(int)((cursor+scanned)%values.Length);
        State.LastReferenceScan = now; Save();
        return $"Referências: {scanned} combinações recentes verificadas; {queued} elegíveis na fila; {errors} arquivos indisponíveis. {Status}";
    }
    bool QueueReference(string carPath, int trackId, int? year, int? quarter, bool force = false, string? setupsRoot = null)
    {
        var key = $"{carPath}|{trackId}|{year}S{quarter}"; var now = DateTimeOffset.UtcNow;
        // Old releases parked queued payloads for five years before server acceptance. Migrate those timestamps lazily.
        try
        {
            var fingerprint=ReferenceFinder.Fingerprint(setupsRoot??ReferenceFinder.SetupsRoot,carPath,year,quarter);
            if(!force&&State.ReferenceFingerprints.GetValueOrDefault(key)==fingerprint&&State.References.TryGetValue(key,out var next)&&next>now&&next<=now.AddDays(1))return false;
            string? reason = null;
            var payload = ReferenceFinder.Find(setupsRoot ?? ReferenceFinder.SetupsRoot, carPath, trackId, year, quarter, r => reason = r);
            if (payload is not null)
            {
                using var doc = JsonDocument.Parse(payload); var payloadKey = doc.RootElement.GetProperty("key").GetString()!;
                if (File.Exists(Path.Combine(Root, "quarantine", payloadKey + ".json")))
                { Status = "Referência recusada em quarentena; revisão manual"; return false; }
                Enqueue(payload); State.ReferencePayloads[payloadKey] = key;
            }
            lock (persistGate) { State.References[key] = now.AddDays(1); State.ReferenceFingerprints[key]=fingerprint; Save(); }
            Status = payload is not null ? "Referência elegível na fila" : reason is not null ? $"Referência incompatível: {reason}" : "Sem referência limpa elegível";
            return payload is not null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException)
        { Status = e is InvalidDataException ? $"Referência incompatível: {e.Message}" : "Referência indisponível; fila preservada"; return false; }
    }
    public static byte[] Canonical(JsonElement value)
    {
        using var buffer = new MemoryStream(); using (var writer = new Utf8JsonWriter(buffer)) Write(writer, value); return buffer.ToArray();
        static void Write(Utf8JsonWriter w, JsonElement e)
        {
            if (e.ValueKind == JsonValueKind.Object) { w.WriteStartObject(); foreach (var p in e.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)) { w.WritePropertyName(p.Name); Write(w, p.Value); } w.WriteEndObject(); }
            else if (e.ValueKind == JsonValueKind.Array) { w.WriteStartArray(); foreach (var v in e.EnumerateArray()) Write(w, v); w.WriteEndArray(); }
            else e.WriteTo(w);
        }
    }
    public async Task Send(CancellationToken cancellation)
    {
        var now = DateTimeOffset.UtcNow;
        if (State.Day != now.ToString("yyyy-MM-dd")) { State.Day = now.ToString("yyyy-MM-dd"); State.Bytes = 0; State.Requests = 0; Save(); }
        if (State.AuthPaused) { Status = "Token expirado/revogado; configure novamente"; return; }
        if (State.Next > now) { Status = "Aguardando janela de retry"; return; }
        var token = Token(); if (token is null) { Status = "Configure seu token para enviar"; return; }
        while (recent.TryPeek(out var t) && t < now.AddMinutes(-1)) recent.Dequeue();
        if (recent.Count >= 10 || State.Requests >= (BackfillMode ? 3000 : Math.Clamp(State.DailyLimit, 1, 128))) { Status = "Limite de requests atingido"; return; }
        foreach (var file in Directory.EnumerateFiles(Path.Combine(Root, "queue"), "*.json").OrderBy(Priority).ThenBy(f => new FileInfo(f).CreationTimeUtc))
        {
            var key = Path.GetFileNameWithoutExtension(file);
            var attempt = State.Attempts.GetValueOrDefault(key) ?? new(); if (attempt.Next > now) continue;
            var payload = await File.ReadAllBytesAsync(file, cancellation);
            if (!BackfillMode && State.Bytes + payload.Length > 10L * 1024 * 1024) { Status = "Limite de 10 MiB/dia atingido"; return; }
            State.Requests++; State.Bytes += payload.Length; State.Next = now.AddSeconds(6); Save(); recent.Enqueue(now);
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint) { Content = new ByteArrayContent(payload) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json"); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            try
            {
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
                if (response.IsSuccessStatusCode) { File.Delete(file); State.Attempts.Remove(key); State.ReferencePayloads.Remove(key); State.Successes++; Status = "Envio confirmado"; }
                else if (response.StatusCode == HttpStatusCode.Unauthorized) { State.AuthPaused = true; Status = "Token expirado/revogado; configure novamente"; }
                else if ((int)response.StatusCode is 400 or 422 || (int)response.StatusCode is >= 300 and < 500 && response.StatusCode != HttpStatusCode.TooManyRequests)
                { File.Move(file, Path.Combine(Root, "quarantine", key + ".json"), true); State.Attempts.Remove(key); if (State.ReferencePayloads.Remove(key, out var target)) State.References.Remove(target); Status = "Payload em quarentena; revisão manual"; }
                else if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    var retry = response.Headers.RetryAfter; var delay=retry?.Delta??(retry?.Date-now)??TimeSpan.FromHours(1);
                    var leased=false;try {using var body=JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));leased=body.RootElement.TryGetProperty("status",out var status)&&status.GetString()=="busy";}catch(JsonException){}
                    if(leased){attempt.Next=now+(delay<TimeSpan.FromSeconds(120)?TimeSpan.FromSeconds(120):delay);State.Attempts[key]=attempt;Status="Outro envio desta volta está em andamento; fila preservada";}
                    else {State.Next=now+(delay<TimeSpan.FromHours(1)?TimeSpan.FromHours(1):delay);Status="Servidor limitou envios";}
                }
                else Retry();
            }
            catch (HttpRequestException) { Retry(); }
            catch (TaskCanceledException) when (!cancellation.IsCancellationRequested) { Retry(); }
            finally { Save(); }
            return;
            void Retry() { attempt.Count++; attempt.Next = now.AddSeconds(Math.Min(3600, Math.Pow(2, Math.Min(attempt.Count, 11)) * 5 + Random.Shared.Next(10))); State.Attempts[key] = attempt; Status = "Offline/falha temporária; fila preservada"; }
        }
    }
}

// Windows CurrentUser DPAPI: no token is written in plaintext or shared across accounts.
static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)] struct Blob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    public static byte[] Protect(byte[] bytes, bool decrypt)
    {
        var input = new Blob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) }; Blob output = default;
        try { Marshal.Copy(bytes, 0, input.Data, bytes.Length); var ok = decrypt ? CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output) : CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output); if (!ok) throw new System.ComponentModel.Win32Exception(); var result = new byte[output.Length]; Marshal.Copy(output.Data, result, 0, result.Length); return result; }
        finally { Marshal.FreeHGlobal(input.Data); if (output.Data != IntPtr.Zero) LocalFree(output.Data); CryptographicOperations.ZeroMemory(bytes); }
    }
}
