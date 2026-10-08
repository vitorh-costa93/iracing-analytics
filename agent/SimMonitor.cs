using System.Buffers.Binary;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;

namespace RacingAgent;

/// <summary>Reads the official iRacing SDK shared memory (no external library) to:
/// (1) ask the simulator to start .ibt disk logging through the official broadcast message when
/// the car is on track and logging is off (never edits app.ini, never takes focus or injects keys);
/// (2) capture the Race result from the live SessionInfo, which keeps updating (the copy inside
/// an .ibt is a snapshot from when the file was opened). Status strings carry no personal data.</summary>
sealed class SimMonitor : IDisposable
{
    public const string MapName = "Local\\IRSDKMemMapFileName";
    // irsdk_BroadcastMsg.irsdk_BroadcastTelemCommand = 10 and irsdk_TelemCommandMode.Start = 1,
    // verified against IRSDKSharper's enums (7 is ReloadTextures, not a telemetry command).
    public const int TelemCommand = 10, TelemStart = 1;
    public static nint TelemStartWParam => MakeWParam(TelemCommand, TelemStart);
    public static nint MakeWParam(int message, int var1) => (nint)(((var1 & 0xFFFF) << 16) | (message & 0xFFFF));

    readonly string mapName; readonly Func<bool> autoRecord; readonly Action<SessionResult.Snapshot> onResult; readonly Action<nint> broadcast; readonly Func<DateTimeOffset> clock;
    MemoryMappedFile? map; MemoryMappedViewAccessor? view;
    int infoUpdate = -1; DateTimeOffset lastRequest = DateTimeOffset.MinValue;
    long currentSub; int raceSessionNum = -1; DateTimeOffset? raceStart; SessionResult.Snapshot? provisional; readonly HashSet<long> captured = [];
    public string Status { get; private set; } = "Simulador fechado";
    public int Requests { get; private set; }

    public SimMonitor(Func<bool> autoRecord, Action<SessionResult.Snapshot> onResult, string mapName = MapName, Action<nint>? broadcast = null, Func<DateTimeOffset>? clock = null)
    { this.autoRecord = autoRecord; this.onResult = onResult; this.mapName = mapName; this.broadcast = broadcast ?? Broadcast; this.clock = clock ?? (() => DateTimeOffset.UtcNow); }

    public void Poll()
    {
        try { PollCore(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or ArgumentException or ObjectDisposedException) { Close(); Status = "SDK indisponível; tentando novamente"; }
    }
    void PollCore()
    {
        if (view is null)
        {
            try { map = MemoryMappedFile.OpenExisting(mapName, MemoryMappedFileRights.Read); view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read); }
            catch (FileNotFoundException) { Close(); Status = "Simulador fechado"; return; }
        }
        int H(long at) => view!.ReadInt32(at);
        if ((H(4) & 1) == 0) { Close(); Status = "Simulador fechado"; return; }
        int numVars = H(24), varAt = H(28), numBuf = H(32), bufLen = H(36);
        if (numVars is < 1 or > 4096 || numBuf is < 1 or > 4 || bufLen < 1 || varAt < 112 || varAt + (long)numVars * 144 > view.Capacity) throw new InvalidDataException("sdk_header");
        var vars = new Dictionary<string, (int type, int offset)>(StringComparer.Ordinal);
        var header = new byte[144];
        for (var n = 0; n < numVars; n++) { view.ReadArray(varAt + n * 144L, header, 0, 144); vars[Encoding.ASCII.GetString(header, 16, 32).TrimEnd('\0')] = (BinaryPrimitives.ReadInt32LittleEndian(header), BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(4))); }
        // Latest of the rotating buffers; re-check its tick so a torn read is discarded.
        var row = new byte[bufLen]; var ok = false;
        for (var attempt = 0; attempt < 3 && !ok; attempt++)
        {
            int best = 0, bestTick = int.MinValue;
            for (var b = 0; b < numBuf; b++) { var t = H(48 + b * 16); if (t > bestTick) { bestTick = t; best = b; } }
            var offset = H(48 + best * 16 + 4); if (offset < 0 || offset + (long)bufLen > view.Capacity) throw new InvalidDataException("sdk_buffer");
            view.ReadArray(offset, row, 0, bufLen); ok = H(48 + best * 16) == bestTick;
        }
        if (!ok) return;
        double? V(string name)
        {
            if (!vars.TryGetValue(name, out var v) || v.offset < 0) return null;
            var w = v.type == 5 ? 8 : v.type is 2 or 3 or 4 ? 4 : v.type is 0 or 1 ? 1 : 0;
            if (w == 0 || v.offset + w > bufLen) return null;
            var s = row.AsSpan(v.offset);
            return v.type switch { 0 => (sbyte)s[0], 1 => s[0], 2 => BinaryPrimitives.ReadInt32LittleEndian(s), 3 => BinaryPrimitives.ReadUInt32LittleEndian(s), 4 => BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(s)), _ => BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(s)) };
        }
        var now = clock();
        var onTrack = V("IsOnTrack") == 1; var replay = V("IsReplayPlaying") == 1;
        var enabled = V("IsDiskLoggingEnabled"); var active = V("IsDiskLoggingActive");
        string record;
        if (active is null || enabled is null) record = "SDK sem variáveis de gravação";
        else if (active == 1) record = "gravando .ibt";
        else if (!onTrack || replay) record = "gravação inativa (fora da pista)";
        else if (enabled != 1) record = "gravação em disco desativada no iRacing (não alterada)";
        else if (!autoRecord()) record = "gravação automática desligada";
        else if (now - lastRequest < TimeSpan.FromSeconds(30)) record = "aguardando início da gravação";
        else { broadcast(TelemStartWParam); lastRequest = now; Requests++; record = "início de gravação solicitado"; }

        var update = H(12);
        int? session = V("SessionNum") is double sn ? (int)sn : null; var state = V("SessionState"); var sessionTime = V("SessionTime");
        if (update != infoUpdate)
        {
            int len = H(16), at = H(20);
            if (len < 1 || len > 4 * 1024 * 1024 || at < 0 || at + (long)len > view.Capacity) throw new InvalidDataException("sdk_yaml");
            var bytes = new byte[len]; view.ReadArray(at, bytes, 0, len);
            if (H(12) != update) return; // changed while copying; next poll rereads it
            infoUpdate = update;
            var yaml = Encoding.Latin1.GetString(bytes).TrimEnd('\0');
            var probe = SessionResult.Build(yaml, raceStart ?? now, "live", out _);
            var sub = probe?.SubsessionId ?? ParseSub(yaml);
            if (sub != currentSub) { FlushProvisional(); currentSub = sub; raceStart = null; raceSessionNum = RaceSessionNum(yaml); }
            if (raceSessionNum >= 0 && session == raceSessionNum && sessionTime is >= 0 && raceStart is null) { raceStart = now.AddSeconds(-sessionTime.Value); probe = SessionResult.Build(yaml, raceStart.Value, "live", out _); }
            if (probe is not null && raceStart is not null && !captured.Contains(probe.SubsessionId))
            {
                if (probe.ResultsOfficial) { Deliver(probe); provisional = null; }
                else if (session == raceSessionNum && state >= 5) provisional = probe;
            }
        }
        else if (raceSessionNum >= 0 && session == raceSessionNum && sessionTime is >= 0 && raceStart is null) { raceStart = now.AddSeconds(-sessionTime.Value); infoUpdate = -1; }
        if (provisional is not null && session != raceSessionNum) FlushProvisional();
        Status = $"Simulador conectado; {record}" + (provisional is not null ? "; aguardando oficialização (só o oficial é enviado)" : "");
    }
    static long ParseSub(string yaml) => SessionYaml.Parse(yaml).M("WeekendInfo").I("SubSessionID") ?? 0;
    static int RaceSessionNum(string yaml) { var races = SessionYaml.Parse(yaml).M("SessionInfo").L("Sessions").Where(s => s.S("SessionType") == "Race").ToList(); return races.Count == 1 ? races[0].I("SessionNum") ?? -1 : -1; }
    void Deliver(SessionResult.Snapshot snapshot) { if (captured.Add(snapshot.SubsessionId)) onResult(snapshot); }
    // Policy: only the official result is ever sent. If the driver leaves before it becomes
    // official, the snapshot is discarded; the pending Race flag in the store keeps the idle
    // exporter polling Recent Races, which delivers the official JSON.
    void FlushProvisional() { provisional = null; }
    void Close() { FlushProvisional(); view?.Dispose(); map?.Dispose(); view = null; map = null; infoUpdate = -1; }
    public void Dispose() => Close();

    static uint message;
    static void Broadcast(nint wParam)
    {
        if (message == 0) message = RegisterWindowMessage("IRSDK_BROADCASTMSG");
        if (message != 0) SendNotifyMessage(0xFFFF, message, wParam, 0);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] static extern bool SendNotifyMessage(nint hwnd, uint msg, nint wParam, nint lParam);
}
