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
    public bool PendingResult { get; set; }
    public bool AutoRecord { get; set; } = true;
    public HashSet<long> ResultSubsessions { get; set; } = [];
    public string ExportDay { get; set; } = "";
    public int Exports { get; set; }
    public DateTimeOffset LastScan { get; set; }
    public Dictionary<string, Attempt> Attempts { get; set; } = [];
}
sealed class Attempt { public int Count { get; set; } public DateTimeOffset Next { get; set; } }
sealed class Store
{
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
        Directory.CreateDirectory(root); Directory.CreateDirectory(Path.Combine(root, "queue")); Directory.CreateDirectory(Path.Combine(root, "quarantine"));
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
    public void Save() { lock (persistGate) Atomic(Path.Combine(Root, "state.json"), JsonSerializer.SerializeToUtf8Bytes(State)); }
    public void Token(string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096 || token.Any(char.IsControl)) throw new ArgumentException("Token inválido");
        Atomic(Path.Combine(Root, "credential.bin"), Dpapi.Protect(Encoding.UTF8.GetBytes(token.Trim()), false));
        State.AuthPaused = false; State.Next = default; Save();
    }
    string? Token() => File.Exists(Path.Combine(Root, "credential.bin")) ? Encoding.UTF8.GetString(Dpapi.Protect(File.ReadAllBytes(Path.Combine(Root, "credential.bin")), true)) : null;
    static bool IsResult(string file) { try { using var s = File.OpenRead(file); var b = new byte[48]; var n = s.Read(b, 0, b.Length); var head = Encoding.UTF8.GetString(b, 0, n); return head.Contains("\"kind\":\"result\"") || head.Contains("\"kind\":\"ibt_result\""); } catch { return false; } }
    public int Backlog => Directory.GetFiles(Path.Combine(Root, "queue"), "*.json").Length;
    public int Quarantined => Directory.GetFiles(Path.Combine(Root, "quarantine"), "*.json").Length;
    public void Enqueue(byte[] payload)
    {
        using var doc = JsonDocument.Parse(payload);
        var key = doc.RootElement.GetProperty("key").GetString()!;
        if (key.Length != 64 || key.Any(c => !char.IsAsciiHexDigit(c))) throw new InvalidDataException("queue_key");
        if (payload.Length > (doc.RootElement.GetProperty("kind").GetString() switch { "result" => 1024 * 1024, "ibt_result" => SessionResult.MaxPayload, _ => 512 * 1024 })) throw new InvalidDataException("payload_size");
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
    /// <summary>Queues an official event_result JSON exported by the idle exporter (no file left in
    /// Downloads). Returns the subsession id, or null when the payload is not an event_result.</summary>
    public long? EnqueueOfficial(byte[] json, HashSet<long>? known = null)
    {
        if (json.Length > 1024 * 1024) return null;
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
    public async Task<HashSet<long>?> KnownResults(CancellationToken cancellation)
    {
        var token = Token(); if (token is null || State.AuthPaused) return null;
        using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
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
    public void Collect(string path, bool backfill = false)
    {
        var info = new FileInfo(path);
        if (!backfill && info.LastWriteTimeUtc < State.Activated.UtcDateTime) return;
        if (info.LastWriteTimeUtc > DateTime.UtcNow.AddSeconds(-30)) return;
        if (observed.TryGetValue(path, out var previous) && previous == (info.Length, info.LastWriteTimeUtc)) return;
        if (info.Length > (path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase) ? Ibt.MaxFile : 1024 * 1024)) { Status = "Arquivo acima do limite; intervenção necessária"; return; }
        // Exclusive open proves the simulator/exporter released its file. A crash before the
        // checkpoint replays it; deterministic queue keys deduplicate durable payloads.
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
        var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (State.Files.Contains(hash)) { observed[path] = (info.Length, info.LastWriteTimeUtc); return; }
        stream.Position = 0;
        try
        {
            if (path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase))
            {
                var result = SessionResult.FromIbt(stream, out _); stream.Position = 0;
                if (result is not null) EnqueueResult(result);
            }
            if (path.EndsWith(".ibt", StringComparison.OrdinalIgnoreCase)) foreach (var payload in Ibt.Read(stream))
            {
                Enqueue(payload);
                using var telemetry = JsonDocument.Parse(payload);
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
            lock (persistGate) { State.Files.Add(hash); Save(); }
            observed[path] = (info.Length, info.LastWriteTimeUtc); Status = "Arquivo coletado";
        }
        catch (InvalidDataException) { observed[path] = (info.Length, info.LastWriteTimeUtc); Status = "Arquivo incompatível; intervenção necessária"; }
        catch (JsonException) { observed[path] = (info.Length, info.LastWriteTimeUtc); Status = "Exportação inválida; intervenção necessária"; }
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
        if (recent.Count >= 10 || State.Requests >= Math.Clamp(State.DailyLimit, 1, 128)) { Status = "Limite de requests atingido"; return; }
        foreach (var file in Directory.EnumerateFiles(Path.Combine(Root, "queue"), "*.json").OrderBy(f => IsResult(f) ? 0 : 1).ThenBy(f => new FileInfo(f).CreationTimeUtc))
        {
            var key = Path.GetFileNameWithoutExtension(file);
            var attempt = State.Attempts.GetValueOrDefault(key) ?? new(); if (attempt.Next > now) continue;
            var payload = await File.ReadAllBytesAsync(file, cancellation);
            if (State.Bytes + payload.Length > 10L * 1024 * 1024) { Status = "Limite de 10 MiB/dia atingido"; return; }
            State.Requests++; State.Bytes += payload.Length; State.Next = now.AddSeconds(6); Save(); recent.Enqueue(now);
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint) { Content = new ByteArrayContent(payload) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json"); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            try
            {
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
                if (response.IsSuccessStatusCode) { File.Delete(file); State.Attempts.Remove(key); State.Successes++; Status = "Envio confirmado"; }
                else if (response.StatusCode == HttpStatusCode.Unauthorized) { State.AuthPaused = true; Status = "Token expirado/revogado; configure novamente"; }
                else if ((int)response.StatusCode is 400 or 422 || (int)response.StatusCode is >= 300 and < 500 && response.StatusCode != HttpStatusCode.TooManyRequests)
                { File.Move(file, Path.Combine(Root, "quarantine", key + ".json"), true); State.Attempts.Remove(key); Status = "Payload em quarentena; revisão manual"; }
                else if (response.StatusCode == HttpStatusCode.TooManyRequests)
                { var retry = response.Headers.RetryAfter; State.Next = now + (retry?.Delta ?? (retry?.Date - now) ?? TimeSpan.FromHours(1)); if (State.Next < now.AddHours(1)) State.Next = now.AddHours(1); Status = "Servidor limitou envios"; }
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
