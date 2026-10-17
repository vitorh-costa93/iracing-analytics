using System.Text;

namespace RacingAgent;

/// <summary>Minimal local diagnostic log (%LOCALAPPDATA%\RacingAnalyticsAgent\agent.log). Never receives tokens,
/// payloads or names: callers pass only fixed messages, status strings and exception type/message.
/// Rotates to agent.log.1 at 128 KiB, so the total stays under ~256 KiB. Logging never throws.</summary>
static class AgentLog
{
    const long MaxBytes = 128 * 1024;
    static readonly object gate = new();
    static string? path;
    public static void Init(string root) { path = Path.Combine(root, "agent.log"); }
    public static void Write(string message)
    {
        if (path is null) return;
        try
        {
            lock (gate)
            {
                var info = new FileInfo(path);
                if (info.Exists && info.Length > MaxBytes) File.Move(path, path + ".1", true);
                File.AppendAllText(path, $"{DateTimeOffset.UtcNow:yyyy-MM-ddTHH:mm:ssZ} {message.Replace('\r', ' ').Replace('\n', ' ')}{Environment.NewLine}", Encoding.UTF8);
            }
        }
        catch { }
    }
    public static void Error(string where, Exception e) => Write($"ERRO {where}: {e.GetType().Name}: {e.Message}");
}
