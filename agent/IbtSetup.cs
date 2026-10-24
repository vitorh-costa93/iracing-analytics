using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RacingAgent;

/// <summary>Builds the `ibt_setup` payload (contract in agent/README.md) from the CarSetup section of the
/// driver's own .ibt SessionInfo: only the tab -> section -> label -> value tree (the same tree Garage61
/// exposes as run.setup.parameters). Never the raw YAML, names, other drivers or any other section.</summary>
static class IbtSetup
{
    public const int MaxPayload = 64 * 1024;
    const int MaxParams = 800;
    static readonly Regex Key = new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);
    // Same readout list as lib/setup-params.ts (READOUT, applied to the humanized lowercase label): values that change
    // between sessions without touching the setup (tyre wear/temps, fuel and fuel-derived garage readouts). Used only
    // for the local identity, so one setup is sent once per car/track/season, not once per session.
    static readonly Regex Readout = new(@"last hot pressure|last temps|tread remaining|fuel level|corner weight|ride height|rh at speed|downforce|^ld$|to drag|fwtdist|cross weight|\bgap\b|defl|display page|dash", RegexOptions.CultureInvariant);
    public static string Humanize(string value) => Regex.Replace(Regex.Replace(Regex.Replace(value, "([a-z0-9])([A-Z])", "$1 $2"), @"\bArb\b", "ARB"), @"\bRd\b", "3rd");
    static string Normalize(string value) => Regex.Replace(Regex.Replace(value.Trim(), @"\s+", " "), @"\+(?=\d)", "").ToLowerInvariant();

    /// <summary>Returns the payload (its `key` is the deterministic identity) or null with a reason.</summary>
    public static byte[]? Build(string yaml, DateTimeOffset recordedAt, out string reason)
    {
        var root = SessionYaml.Parse(yaml);
        var weekend = root.M("WeekendInfo"); var info = root.M("DriverInfo"); var setup = root.M("CarSetup");
        if (setup is null) { reason = "sem CarSetup"; return null; }
        if (weekend is null || info is null) { reason = "SessionInfo incompleto"; return null; }
        var me = info.I("DriverCarIdx"); var mine = info.L("Drivers").FirstOrDefault(d => d.I("CarIdx") == me);
        int user = info.I("DriverUserID") ?? 0, carId = mine?.I("CarID") ?? 0, trackId = weekend.I("TrackID") ?? 0;
        if (me is null || mine is null || user <= 0 || carId <= 0 || trackId <= 0) { reason = "identificadores ausentes"; return null; }
        var parameters = new SortedDictionary<string, SortedDictionary<string, SortedDictionary<string, string>>>(StringComparer.Ordinal);
        var identity = new List<string>(); var count = 0;
        foreach (var (tab, tabValue) in setup)
        {
            if (tabValue is not Dictionary<string, object> sections || !Key.IsMatch(tab)) continue; // UpdateCount and other scalars
            foreach (var (section, sectionValue) in sections)
            {
                if (sectionValue is not Dictionary<string, object> labels || !Key.IsMatch(section)) continue;
                foreach (var (label, raw) in labels)
                {
                    if (raw is not string value || !Key.IsMatch(label) || value.Length > 120 || value.Any(char.IsControl)) continue;
                    if (!parameters.TryGetValue(tab, out var s)) parameters[tab] = s = new(StringComparer.Ordinal);
                    if (!s.TryGetValue(section, out var l)) s[section] = l = new(StringComparer.Ordinal);
                    l[label] = value.Trim();
                    var humanLabel = Humanize(label);
                    if (!Readout.IsMatch(humanLabel.ToLowerInvariant())) identity.Add($"{Humanize(tab)}|{Humanize(section)}|{humanLabel}".ToLowerInvariant() + "=" + Normalize(value));
                    if (++count > MaxParams) { reason = "CarSetup acima do limite"; return null; }
                }
            }
        }
        if (count == 0) { reason = "CarSetup vazio"; return null; }
        identity.Sort(StringComparer.Ordinal);
        // Local season bucket (the server resolves the real season from recordedAt): seasons start mid-Dec/Mar/Jun/Sep.
        var bucket = recordedAt.UtcDateTime.AddDays(16); var season = $"{bucket.Year}Q{(bucket.Month - 1) / 3 + 1}";
        var digest = Ibt.Hash(Encoding.UTF8.GetBytes(string.Join('\n', identity)));
        // iRacing's name of the loaded setup file (e.g. "TS 26S4 SF23 W06 Spa Race.sto"): lets the server attach these
        // parameters to the matching uploaded .sto. Part of the key so setups sent before the field existed are re-sent once.
        var rawName = info.S("DriverSetupName") ?? ""; var setupName = rawName.Length <= 200 && !rawName.Any(char.IsControl) ? rawName.Trim() : "";
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            version = 1, kind = "ibt_setup", key = Ibt.Hash(Encoding.UTF8.GetBytes($"ibt_setup:{user}:{carId}:{trackId}:{season}:{digest}:{setupName}:n2")),
            setup = new
            {
                customerId = user, nativeCarId = carId, nativeTrackId = trackId, carName = mine.S("CarScreenName") ?? "", trackName = weekend.S("TrackName") ?? "",
                trackConfig = weekend.S("TrackConfigName") ?? "", loadType = info.S("DriverSetupLoadTypeName") ?? "", setupName = setupName, recordedAt = recordedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture), parameters,
            },
        });
        if (payload.Length > MaxPayload) { reason = "payload acima de 64 KiB"; return null; }
        reason = "setup extraído"; return payload;
    }

    /// <summary>Read-only: SessionInfo of the .ibt + recording start from the disk header.</summary>
    public static byte[]? FromIbt(Stream stream, out string reason)
    {
        reason = "arquivo inválido";
        if (stream.Length < 144 || stream.Length > Ibt.MaxFile) return null;
        var header = new byte[144]; stream.Position = 0; stream.ReadExactly(header);
        int yamlLen = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(16)), yamlAt = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(20));
        if (yamlLen < 1 || yamlLen > 4 * 1024 * 1024 || yamlAt < 144 || (long)yamlAt + yamlLen > stream.Length) return null;
        DateTimeOffset at;
        try { at = DateTimeOffset.FromUnixTimeSeconds(BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(112, 8))); } catch { reason = "data inválida"; return null; }
        if (at.Year < 2008 || at > DateTimeOffset.UtcNow.AddDays(1)) { reason = "data inválida"; return null; }
        var bytes = new byte[yamlLen]; stream.Position = yamlAt; stream.ReadExactly(bytes);
        return Build(Encoding.UTF8.GetString(bytes).TrimEnd('\0'), at, out reason);
    }
}
