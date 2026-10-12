using System.Text.Json;
using System.Text.Json.Nodes;

namespace RacingAgent;

/// <summary>
/// Shrinks an official event_result JSON before it is queued, keeping the same envelope
/// ({type:"event_result", data:{...}}) and everything the server validates or stores: per-driver
/// identity/car/class/positions/laps/incidents/times/ratings/licenses/reason_out/division, and the event
/// header, weather, track state and splits. Dropped: cosmetic blobs (livery, helmet, suit, flair), league/
/// championship points, internal flags, warm-up and other non practice/qualify/race sessions, per-session
/// weather summaries and AI entrants. The server never receives AI rows from official sessions anyway.
/// </summary>
static class ResultReducer
{
    static readonly HashSet<string> DriverDrop = new(StringComparer.Ordinal)
    {
        "livery", "helmet", "suit", "flair_id", "flair_name", "flair_shortname", "carcfg", "friend", "watched", "drop_race",
        "league_points", "league_agg_points", "aggregate_champ_points", "max_pct_fuel_fill", "opt_laps_complete",
        "weight_penalty_kg", "best_nlaps_num", "best_nlaps_time", "best_qual_lap_at", "best_qual_lap_num", "best_lap_num",
        "old_cpi", "new_cpi", "old_ttrating", "new_ttrating", "license_change_oval", "license_change_road", "reason_out_id",
        "car_class_short_name", "division_name",
    };
    static readonly HashSet<string> EventDrop = new(StringComparer.Ordinal) { "allowed_licenses", "series_logo", "heat_info_id", "private_session_id", "can_protest" };
    static readonly HashSet<int> KeptSessions = [3, 4, 6]; // practice, qualify, race

    /// <summary>Returns the reduced compact JSON, or the input untouched when it does not look like an event_result.</summary>
    public static byte[] Reduce(byte[] json)
    {
        try
        {
            if (JsonNode.Parse(json) is not JsonObject root || root["data"] is not JsonObject data) return json;
            foreach (var key in EventDrop) data.Remove(key);
            if (data["session_results"] is JsonArray sessions)
            {
                for (var i = sessions.Count - 1; i >= 0; i--)
                {
                    if (sessions[i] is not JsonObject session || !(session["simsession_type"]?.GetValueKind() == JsonValueKind.Number && KeptSessions.Contains(session["simsession_type"]!.GetValue<int>())))
                    { sessions.RemoveAt(i); continue; }
                    session.Remove("weather_result");
                    if (session["results"] is JsonArray results)
                    {
                        for (var r = results.Count - 1; r >= 0; r--)
                        {
                            if (results[r] is not JsonObject row) continue;
                            if (row["ai"]?.GetValueKind() == JsonValueKind.True) { results.RemoveAt(r); continue; }
                            Strip(row);
                        }
                    }
                }
            }
            return JsonSerializer.SerializeToUtf8Bytes(root);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException) { return json; }
    }

    static void Strip(JsonObject row)
    {
        foreach (var key in DriverDrop) row.Remove(key);
        if (row["driver_results"] is JsonArray team) foreach (var member in team) if (member is JsonObject m) Strip(m);
    }
}
