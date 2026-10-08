using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace RacingAgent;

/// <summary>Minimal reader for the iRacing SessionInfo YAML subset (maps, "- " lists, scalars).
/// Values are taken verbatim after the first ": "; names are never forwarded.</summary>
static class SessionYaml
{
    public static Dictionary<string, object> Parse(string text)
    {
        var lines = text.Replace("\r", "").Split('\n').Where(l => l.Trim() is not ("---" or "...")).ToArray();
        var i = 0; return Map(lines, ref i, 0);
    }
    static int Indent(string line) { var n = 0; while (n < line.Length && line[n] == ' ') n++; return n; }
    static int NextContent(string[] lines, int i) { while (i < lines.Length && string.IsNullOrWhiteSpace(lines[i])) i++; return i; }
    static Dictionary<string, object> Map(string[] lines, ref int i, int indent)
    {
        var map = new Dictionary<string, object>(StringComparer.Ordinal);
        while ((i = NextContent(lines, i)) < lines.Length)
        {
            var line = lines[i]; var ind = Indent(line); var content = line.Trim();
            if (ind < indent || ind == indent && content.StartsWith("- ", StringComparison.Ordinal)) break;
            if (ind > indent) { i++; continue; }
            var colon = content.IndexOf(':'); if (colon <= 0) { i++; continue; }
            var key = content[..colon]; var value = content[(colon + 1)..].Trim(); i++;
            if (value.Length > 0) { map[key] = value; continue; }
            var next = NextContent(lines, i);
            if (next < lines.Length && Indent(lines[next]) >= ind && lines[next].TrimStart().StartsWith("- ", StringComparison.Ordinal)) { i = next; map[key] = List(lines, ref i, Indent(lines[next])); }
            else if (next < lines.Length && Indent(lines[next]) > ind) { i = next; map[key] = Map(lines, ref i, Indent(lines[next])); }
            else map[key] = "";
        }
        return map;
    }
    static List<Dictionary<string, object>> List(string[] lines, ref int i, int indent)
    {
        var list = new List<Dictionary<string, object>>();
        while ((i = NextContent(lines, i)) < lines.Length)
        {
            var line = lines[i]; var content = line.TrimStart();
            if (Indent(line) != indent || !content.StartsWith("- ", StringComparison.Ordinal)) break;
            lines[i] = new string(' ', indent + 2) + content[2..];
            list.Add(Map(lines, ref i, indent + 2));
        }
        return list;
    }
    public static Dictionary<string, object>? M(this Dictionary<string, object>? m, string key) => m is not null && m.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;
    public static List<Dictionary<string, object>> L(this Dictionary<string, object>? m, string key) => m is not null && m.TryGetValue(key, out var v) && v is List<Dictionary<string, object>> l ? l : [];
    public static string? S(this Dictionary<string, object>? m, string key) => m is not null && m.TryGetValue(key, out var v) ? v as string : null;
    public static int? I(this Dictionary<string, object>? m, string key) => int.TryParse(m.S(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;
    public static double? D(this Dictionary<string, object>? m, string key) => double.TryParse(m.S(key), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
}

/// <summary>Builds the `ibt_result` payload (contract in agent/README.md) from SessionInfo.
/// Sends only extracted fields of the authenticated driver plus per-car rating/position needed
/// for the server-side iRating estimate; no names, setup or raw YAML.</summary>
static class SessionResult
{
    public const int MaxPayload = 128 * 1024;
    static readonly string[] Categories = ["SportsCar", "FormulaCar", "Road"];
    public sealed record Snapshot(long SubsessionId, bool ResultsOfficial, int RaceSessionNum, byte[] Payload);

    /// <summary>Returns the race snapshot when the event is official, single-driver, in a supported
    /// category and the driver is classified in the Race session; otherwise null with a reason.</summary>
    public static Snapshot? Build(string yaml, DateTimeOffset racedAt, string origin, out string reason)
    {
        var root = SessionYaml.Parse(yaml);
        var weekend = root.M("WeekendInfo"); var info = root.M("DriverInfo");
        reason = "sessão sem resultado";
        if (weekend is null || info is null) { reason = "SessionInfo incompleto"; return null; }
        if (weekend.I("Official") != 1) { reason = "evento não oficial"; return null; }
        if (weekend.I("TeamRacing") is not (null or 0)) { reason = "corrida de equipe não suportada"; return null; }
        var category = weekend.S("Category");
        if (category is null || !Categories.Contains(category)) { reason = "categoria não suportada"; return null; }
        var races = root.M("SessionInfo").L("Sessions").Where(s => s.S("SessionType") == "Race").ToList();
        if (races.Count != 1) { reason = races.Count == 0 ? "sem sessão Race" : "várias sessões Race"; return null; }
        var race = races[0];
        var me = info.I("DriverCarIdx"); var drivers = info.L("Drivers");
        var mine = drivers.FirstOrDefault(d => d.I("CarIdx") == me);
        var positions = race.L("ResultsPositions");
        var myRow = positions.FirstOrDefault(p => p.I("CarIdx") == me);
        if (me is null || mine is null || myRow is null) { reason = "piloto ainda não classificado na Race"; return null; }
        int sub = weekend.I("SubSessionID") ?? 0, user = mine.I("UserID") ?? 0, carId = mine.I("CarID") ?? 0, trackId = weekend.I("TrackID") ?? 0;
        if (sub <= 0 || user <= 0 || carId <= 0 || trackId <= 0 || weekend.I("SeriesID") is not > 0 || weekend.I("SeasonID") is not > 0) { reason = "identificadores ausentes"; return null; }
        var byIdx = positions.Where(p => p.I("CarIdx") is not null).GroupBy(p => p.I("CarIdx")!.Value).ToDictionary(g => g.Key, g => g.First());
        var entrants = new List<object>();
        foreach (var d in drivers)
        {
            if (d.I("CarIdx") is not int idx || d.I("CarIsPaceCar") == 1 || d.I("IsSpectator") == 1 || d.I("CarIsAI") == 1 || d.I("UserID") is not > 0) continue;
            byIdx.TryGetValue(idx, out var row);
            int? position = row?.I("Position"), classPosition = row?.I("ClassPosition");
            var started = position is >= 0 && classPosition is >= 0;
            entrants.Add(new { carIdx = idx, classId = d.I("CarClassID") ?? 0, irating = Math.Clamp(d.I("IRating") ?? 0, 0, 20000), started, position = started ? position : null, classPosition = started ? classPosition : null, lapsComplete = started ? row!.I("LapsComplete") : null, fastestTime = started ? row!.D("FastestTime") : null });
            if (entrants.Count > 128) { reason = "grid acima do limite"; return null; }
        }
        var grid = root.M("QualifyResultsInfo").L("Results").FirstOrDefault(q => q.I("CarIdx") == me)?.I("Position");
        var official = race.I("ResultsOfficial") == 1;
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            version = 1, kind = "ibt_result", key = Ibt.Hash(Encoding.UTF8.GetBytes($"ibt_result:{sub}:{user}")),
            result = new
            {
                origin, resultsOfficial = official, official = true, customerId = user, subsessionId = sub,
                seriesId = weekend.I("SeriesID"), seasonId = weekend.I("SeasonID"), category, raceWeek = weekend.I("RaceWeek"),
                racedAt = racedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
                trackId, trackName = weekend.S("TrackDisplayName") ?? weekend.S("TrackName"), trackConfig = weekend.S("TrackConfigName") ?? "",
                driver = new { carIdx = me, carId, carName = mine.S("CarScreenName"), licLevel = mine.I("LicLevel"), licSubLevel = mine.I("LicSubLevel"), lapsLed = myRow.I("LapsLed") ?? 0, incidents = myRow.I("Incidents") ?? 0, gridPosition = grid is >= 0 ? grid + 1 : null },
                entrants,
            },
        });
        if (payload.Length > MaxPayload) { reason = "payload acima de 128 KiB"; return null; }
        reason = official ? "resultado oficial" : "resultado provisório (bandeirada)";
        return new Snapshot(sub, official, race.I("SessionNum") ?? -1, payload);
    }

    /// <summary>Read-only extraction from an .ibt. The file's SessionInfo is a snapshot taken when
    /// the file was opened (header sessionInfoUpdate stays 0), so only an official Race block is
    /// trusted here; the live monitor is the normal source. Race start = disk start date +
    /// record offset - session-relative SessionTime of the first Race record.</summary>
    public static Snapshot? FromIbt(Stream stream, out string reason)
    {
        reason = "arquivo inválido";
        if (stream.Length < 144 || stream.Length > Ibt.MaxFile) return null;
        var header = new byte[144]; stream.Position = 0; stream.ReadExactly(header);
        int H(int at) => BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(at, 4));
        int tick = H(8), yamlLen = H(16), yamlAt = H(20), count = H(24), table = H(28), size = H(36), start = H(52), records = H(140);
        if (tick is < 1 or > 360 || yamlLen < 1 || yamlLen > 4 * 1024 * 1024 || yamlAt < 144 || (long)yamlAt + yamlLen > stream.Length || count is < 1 or > 2000 || size is < 1 or > 1024 * 1024 || records < 1 || start < 144 || start + (long)size * records > stream.Length || table < 144 || table + (long)count * 144 > stream.Length) return null;
        var yamlBytes = new byte[yamlLen]; stream.Position = yamlAt; stream.ReadExactly(yamlBytes);
        var yaml = Encoding.Latin1.GetString(yamlBytes).TrimEnd('\0');
        var probe = Build(yaml, DateTimeOffset.UnixEpoch.AddYears(40), "ibt", out reason);
        if (probe is null) return null;
        if (!probe.ResultsOfficial) { reason = "Race do .ibt não oficial (snapshot de abertura do arquivo)"; return null; }
        var fields = new Dictionary<string, (int type, int offset)>();
        stream.Position = table;
        for (var n = 0; n < count; n++) { var v = new byte[144]; stream.ReadExactly(v); fields[Encoding.ASCII.GetString(v, 16, 32).TrimEnd('\0')] = (BinaryPrimitives.ReadInt32LittleEndian(v), BinaryPrimitives.ReadInt32LittleEndian(v.AsSpan(4))); }
        if (!fields.TryGetValue("SessionNum", out var sn) || sn.type != 2 || !fields.TryGetValue("SessionTime", out var st) || st.type != 5 || sn.offset + 4 > size || st.offset + 8 > size) { reason = "canais de sessão ausentes"; return null; }
        DateTimeOffset epoch;
        try { epoch = DateTimeOffset.FromUnixTimeSeconds(BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(112, 8))); } catch { reason = "data inválida"; return null; }
        var row = new byte[size]; stream.Position = start;
        for (var n = 0; n < records; n++)
        {
            stream.ReadExactly(row);
            if (BinaryPrimitives.ReadInt32LittleEndian(row.AsSpan(sn.offset)) != probe.RaceSessionNum) continue;
            var time = BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(row.AsSpan(st.offset)));
            if (!double.IsFinite(time) || time < 0) continue;
            return Build(yaml, epoch.AddSeconds((double)n / tick - time), "ibt", out reason);
        }
        reason = "sem registros da Race"; return null;
    }
}
