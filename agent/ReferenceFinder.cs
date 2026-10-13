using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace RacingAgent;

/// <summary>
/// Looks for another driver's reference .ibt in Documents\iRacing\setups\&lt;CarPath&gt;\&lt;YYSQ&gt;\ for the car/track of a
/// freshly collected own telemetry file. Only *.ibt files are opened (never .sto setups); the track is matched by the
/// TrackID in each file's own YAML, and only the fastest clean lap without P2P/Overtake is queued as a "reference" payload
/// (never the raw IBT). Guard-rails: one search per car/track/season, retried at most once per day while nothing is found.
/// </summary>
static class ReferenceFinder
{
    const int MaxFiles = 200;
    static readonly Regex SafeName = new(@"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,99}$", RegexOptions.Compiled);
    public static string SetupsRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "setups");
    public static string SeasonFolder(int year, int quarter) => $"{year % 100:00}S{quarter}";

    /// <summary>Cheap header read: the YAML track id, without parsing a single telemetry record.</summary>
    internal static int? PeekTrackId(Stream stream)
    {
        if (stream.Length < 144 || stream.Length > Ibt.MaxFile) return null;
        var header = new byte[144]; stream.Position = 0; stream.ReadExactly(header);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(16, 4)); var at = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(20, 4));
        if (length < 1 || length > 4 * 1024 * 1024 || at < 144 || (long)at + length > stream.Length) return null;
        var bytes = new byte[length]; stream.Position = at; stream.ReadExactly(bytes);
        var match = Regex.Match(Encoding.UTF8.GetString(bytes), @"(?m)^\s*TrackID:\s*(\d+)\s*$");
        return match.Success && int.TryParse(match.Groups[1].Value, out var id) ? id : null;
    }

    /// <summary>Returns the "reference" payload for the fastest eligible lap, or null when no matching file/lap exists.</summary>
    public static byte[]? Find(string setupsRoot, string carPath, int trackId, int? year, int? quarter)
    {
        if (!SafeName.IsMatch(carPath) || carPath.Contains("..")) return null;
        var carDir = Path.Combine(setupsRoot, carPath);
        if (!Directory.Exists(carDir)) return null;
        var seasonDir = year is > 0 && quarter is > 0 ? Path.Combine(carDir, SeasonFolder(year.Value, quarter.Value))
            : Directory.EnumerateDirectories(carDir).OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
        if (seasonDir is null || !Directory.Exists(seasonDir)) return null;
        byte[]? best = null; var bestTime = double.MaxValue; string? bestFile = null;
        foreach (var file in Directory.EnumerateFiles(seasonDir, "*.ibt").Take(MaxFiles))
        {
            try
            {
                using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (PeekTrackId(stream) != trackId) continue;
                stream.Position = 0;
                foreach (var payload in Ibt.Read(stream))
                {
                    using var doc = JsonDocument.Parse(payload); var lap = doc.RootElement.GetProperty("lap");
                    if (!lap.GetProperty("clean").GetBoolean() || (lap.TryGetProperty("overtake", out var ot) && ot.GetBoolean())) continue;
                    var time = lap.GetProperty("time").GetDouble();
                    if (time < bestTime) { bestTime = time; best = payload; bestFile = Path.GetFileName(file); }
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or JsonException) { }
        }
        return best is null ? null : ToReference(best, bestFile!);
    }

    static byte[] ToReference(byte[] lapPayload, string fileName)
    {
        var root = JsonNode.Parse(lapPayload)!.AsObject(); var m = root["metadata"]!.AsObject();
        var lapKey = root["key"]!.GetValue<string>();
        root["kind"] = "reference";
        root["key"] = Ibt.Hash(Encoding.UTF8.GetBytes($"reference:{m["nativeCarId"]}:{m["nativeTrackId"]}:{lapKey}"));
        root["sourceFile"] = fileName.Length > 200 ? fileName[..200] : fileName;
        return JsonSerializer.SerializeToUtf8Bytes(root);
    }
}
