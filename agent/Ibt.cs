using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RacingAgent;

static class Ibt
{
    public const long MaxFile = 512L * 1024 * 1024;
    static readonly string[] Channels = ["SessionTime", "Speed", "Brake", "Throttle", "RPM", "SteeringWheelAngle", "Gear", "Clutch", "LatAccel", "LongAccel", "Yaw", "YawRate", "BrakeABSactive", "DRS_Status", "PushToPass", "P2P_Status", "P2P_Count", "Lat", "Lon"];
    public static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static IEnumerable<byte[]> Read(Stream stream)
    {
        if (stream.Length > MaxFile || stream.Length < 144) throw new InvalidDataException("ibt_size");
        using var reader = new BinaryReader(stream, Encoding.UTF8, true);
        var header = reader.ReadBytes(144);
        int H(int at) => BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(at, 4));
        var count = H(24); var table = H(28); var size = H(36); var start = H(52); var records = H(140);
        if (H(0) < 1 || count < 1 || count > 2000 || size < 1 || size > 1024 * 1024 || records < 1 || start < 144 || start + (long)size * records > stream.Length || table < 144 || table + (long)count * 144 > stream.Length) throw new InvalidDataException("ibt_header");
        var fields = new Dictionary<string, (int type, int offset)>();
        stream.Position = table;
        for (var n = 0; n < count; n++)
        {
            var v = reader.ReadBytes(144); var type = BinaryPrimitives.ReadInt32LittleEndian(v); var offset = BinaryPrimitives.ReadInt32LittleEndian(v.AsSpan(4));
            var width = type == 5 ? 8 : type is 2 or 3 or 4 ? 4 : type is 0 or 1 ? 1 : 0;
            if (width == 0 || offset < 0 || offset + width > size) throw new InvalidDataException("ibt_variable");
            fields[Encoding.ASCII.GetString(v, 16, 32).TrimEnd('\0')] = (type, offset);
        }
        foreach (var name in new[] { "SessionTime", "SessionNum", "Lap", "LapDistPct", "Speed", "Brake", "Throttle", "Lat", "Lon" }) if (!fields.ContainsKey(name)) throw new InvalidDataException("ibt_channels");
        if (H(16) < 1 || H(16) > 4 * 1024 * 1024 || H(20) < 144 || (long)H(20) + H(16) > stream.Length) throw new InvalidDataException("ibt_yaml");
        stream.Position = H(20); var yaml = Encoding.UTF8.GetString(reader.ReadBytes(H(16))).TrimEnd('\0');
        string? Get(string text, string key) => Regex.Match(text, @"(?m)^\s*" + key + @":\s*(.+?)\r?$") is { Success: true } m ? m.Groups[1].Value.Trim().Trim('"', '\'') : null;
        int Required(string key) => int.TryParse(Get(yaml, key), out var v) && v > 0 ? v : throw new InvalidDataException("ibt_metadata");
        var sub = Required("SubSessionID"); var customer = Required("DriverUserID"); var driverIndex = Get(yaml, "DriverCarIdx");
        var driverInfo = yaml[(yaml.IndexOf("DriverInfo:", StringComparison.Ordinal) is var driverAt && driverAt >= 0 ? driverAt : throw new InvalidDataException("ibt_driver"))..];
        var driver = Regex.Match(driverInfo, @"(?ms)^\s*- CarIdx: " + Regex.Escape(driverIndex ?? "missing") + @"\r?\n(?<body>.*?)(?=^\s*- CarIdx:|\z)").Groups["body"].Value;
        var car = Get(driver, "CarScreenName") ?? throw new InvalidDataException("ibt_car");
        var track = Get(yaml, "TrackName") ?? throw new InvalidDataException("ibt_track"); var config = Get(yaml, "TrackConfigName") ?? "";
        var trackLength = Get(yaml, "TrackLength");
        if (trackLength is null || !double.TryParse(trackLength.Replace(" km", ""), CultureInfo.InvariantCulture, out var km) || km <= 0 || km > 100) throw new InvalidDataException("ibt_length");
        var epoch = BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(112, 8));
        DateTimeOffset origin;
        try { origin = DateTimeOffset.FromUnixTimeSeconds(epoch); } catch { throw new InvalidDataException("ibt_date"); }
        if (origin.Year < 2000 || origin.Year > DateTime.UtcNow.Year + 1) throw new InvalidDataException("ibt_date");
        var row = new byte[size];
        double V(string name)
        {
            if (!fields.TryGetValue(name, out var v)) return double.NaN;
            var s = row.AsSpan(v.offset);
            return v.type switch { 0 => (sbyte)s[0], 1 => s[0], 2 => BinaryPrimitives.ReadInt32LittleEndian(s), 3 => BinaryPrimitives.ReadUInt32LittleEndian(s), 4 => BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(s)), 5 => BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(s)), _ => double.NaN };
        }
        // Disk timestamp is recording start, while SessionTime may already be minutes old.
        stream.Position = start; stream.ReadExactly(row);
        var initialTime = V("SessionTime"); if (!double.IsFinite(initialTime)) throw new InvalidDataException("ibt_time");
        origin = origin.AddSeconds(-initialTime);
        var csv = new StringBuilder(); int lap = -1, session = -1, samples = 0; double first = 0, firstDist = 1, lastDist = 0, fuelStart = double.NaN, fuelEnd = double.NaN, incStart = double.NaN, incEnd = double.NaN, sampled = double.NegativeInfinity; bool pit = false, invalid = false;
        byte[]? Finish(double boundaryTime, bool crossed)
        {
            if (!crossed || samples < 30 || firstDist > .03 || lastDist < .97 || boundaryTime - first < 10 || invalid) return null;
            var raw = Encoding.UTF8.GetBytes(csv.ToString()); if (raw.Length > 2 * 1024 * 1024) throw new InvalidDataException("csv_size");
            byte[] compressed;
            var lines = csv.ToString().TrimEnd('\n').Split('\n');
            var stride = 1;
            do
            {
                using var buffer = new MemoryStream(); using (var gz = new GZipStream(buffer, CompressionLevel.SmallestSize, true)) gz.Write(raw);
                compressed = buffer.ToArray(); if (compressed.Length <= 128 * 1024) break;
                stride *= 2;
                raw = Encoding.UTF8.GetBytes(string.Join('\n', lines.Where((_, i) => i == 0 || (i - 1) % stride == 0 || i == lines.Length - 1)) + "\n");
                if (stride > 64) throw new InvalidDataException("gzip_size");
            } while (true);
            var metadata = new Dictionary<string, object?> { ["subsessionId"] = sub, ["customerId"] = customer, ["carName"] = car, ["trackName"] = track, ["trackConfig"] = config, ["sessionNumber"] = session, ["startedAt"] = origin.AddSeconds(first).ToString("O"), ["endedAt"] = origin.AddSeconds(boundaryTime).ToString("O"), ["trackLengthMeters"] = km * 1000 };
            metadata["sampleRateHz"] = 20.0 / stride;
            var sessionBlock = Regex.Match(yaml, @"(?ms)^\s*- SessionNum: " + session + @"\r?\n(?<body>.*?)(?=^\s*- SessionNum:|\z)").Groups["body"].Value;
            var kind = Get(sessionBlock, "SessionType");
            metadata["sessionType"] = kind is "Practice" or "Race" ? kind : kind is "Qualify" or "Lone Qualify" or "Open Qualify" ? "Qualify" : throw new InvalidDataException("ibt_session_type");
            foreach (var k in new[] { "SeasonYear", "SeasonQuarter" }) if (int.TryParse(Get(yaml, k), out var val) && val > 0) metadata[char.ToLowerInvariant(k[0]) + k[1..]] = val;
            if (int.TryParse(Get(yaml, "TrackID"), out var trackId) && trackId > 0) metadata["nativeTrackId"] = trackId;
            if (int.TryParse(Get(driver, "CarID"), out var carId) && carId > 0) metadata["nativeCarId"] = carId;
            int? incidents = double.IsFinite(incStart) && incEnd >= incStart ? (int)(incEnd - incStart) : null;
            double? Finite(double x) => double.IsFinite(x) ? x : null;
            return JsonSerializer.SerializeToUtf8Bytes(new { version = 1, kind = "telemetry", key = Hash(Encoding.UTF8.GetBytes($"{sub}:{customer}:{session}:{lap}")), metadata, lap = new { number = lap, time = boundaryTime - first, clean = !pit && fields.ContainsKey("OnPitRoad") && incidents == 0, incidents, fuelLevel = Finite(fuelEnd), fuelUsed = fuelStart >= fuelEnd ? Finite(fuelStart - fuelEnd) : null, csvGzipBase64 = Convert.ToBase64String(compressed) } });
        }
        stream.Position = start;
        for (var n = 0; n < records; n++)
        {
            stream.ReadExactly(row); var nextLap = (int)V("Lap"); var nextSession = (int)V("SessionNum"); var time = V("SessionTime"); var dist = V("LapDistPct");
            if (!double.IsFinite(time) || !double.IsFinite(dist) || dist < 0 || dist > 1 || nextLap < 1) continue;
            if (nextLap != lap || nextSession != session)
            {
                var output = Finish(time, nextSession == session && nextLap == lap + 1); if (output is not null) yield return output;
                lap = nextLap; session = nextSession; first = time; firstDist = dist; samples = 0; sampled = double.NegativeInfinity; pit = invalid = false; fuelStart = V("FuelLevel"); incStart = V("PlayerCarMyIncidentCount");
                csv.Clear().Append("LapDistPct,").AppendJoin(',', Channels).Append('\n');
            }
            lastDist = dist; pit |= V("OnPitRoad") == 1; invalid |= V("LapCurrentLapTime") < 0; fuelEnd = V("FuelLevel"); incEnd = V("PlayerCarMyIncidentCount");
            if (time - sampled < .05 - 1e-8) continue;
            sampled = time; samples++;
            csv.Append(dist.ToString("R", CultureInfo.InvariantCulture));
            foreach (var name in Channels) { var val = V(name); csv.Append(','); if (double.IsFinite(val)) csv.Append(val.ToString("R", CultureInfo.InvariantCulture)); }
            csv.Append('\n'); if (csv.Length > 2 * 1024 * 1024) throw new InvalidDataException("csv_size");
        }
        // The last segment has no observed finish crossing and is deliberately not uploaded.
    }
}
