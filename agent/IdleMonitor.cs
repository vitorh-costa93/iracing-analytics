using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RacingAgent;

/// <summary>
/// Tracks user activity across mouse/keyboard (GetLastInputInfo) AND steering wheels / pedals /
/// joysticks (winmm joyGetPosEx, passive polling without HidHide or exclusive DirectInput hooks).
/// Used so the agent only auto-launches iRacingUI when all devices have been idle for >= 10 min.
/// </summary>
internal sealed class IdleMonitor
{
    const uint JoyReturnAll = 0xFF;
    const int AxisDeadzone = 512;

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [StructLayout(LayoutKind.Sequential)]
    struct JOYINFOEX
    {
        public uint dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos, dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    [DllImport("winmm.dll")]
    static extern uint joyGetPosEx(uint uJoyID, ref JOYINFOEX pji);

    readonly JOYINFOEX?[] lastJoy = new JOYINFOEX?[16];
    DateTimeOffset lastJoyActivityUtc = DateTimeOffset.UtcNow;

    internal void Poll()
    {
        var now = DateTimeOffset.UtcNow;
        for (uint id = 0; id < 16; id++)
        {
            var cur = new JOYINFOEX { dwSize = (uint)Marshal.SizeOf<JOYINFOEX>(), dwFlags = JoyReturnAll };
            if (joyGetPosEx(id, ref cur) != 0)
            {
                lastJoy[id] = null;
                continue;
            }
            var prev = lastJoy[id];
            lastJoy[id] = cur;
            if (prev is null) continue;
            if (Moved(prev.Value, cur)) lastJoyActivityUtc = now;
        }
    }

    static bool Moved(JOYINFOEX a, JOYINFOEX b) =>
        a.dwButtons != b.dwButtons
        || a.dwPOV != b.dwPOV
        || Math.Abs((long)a.dwXpos - b.dwXpos) > AxisDeadzone
        || Math.Abs((long)a.dwYpos - b.dwYpos) > AxisDeadzone
        || Math.Abs((long)a.dwZpos - b.dwZpos) > AxisDeadzone
        || Math.Abs((long)a.dwRpos - b.dwRpos) > AxisDeadzone
        || Math.Abs((long)a.dwUpos - b.dwUpos) > AxisDeadzone
        || Math.Abs((long)a.dwVpos - b.dwVpos) > AxisDeadzone;

    internal TimeSpan IdleDuration()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        double inputMs = GetLastInputInfo(ref info)
            ? unchecked((uint)Environment.TickCount - info.dwTime)
            : 0;
        double joyMs = Math.Max(0, (DateTimeOffset.UtcNow - lastJoyActivityUtc).TotalMilliseconds);
        return TimeSpan.FromMilliseconds(Math.Min(inputMs, joyMs));
    }

    internal bool IsIdleFor(TimeSpan threshold) => IdleDuration() >= threshold;

    internal static string? FindIracingUiPath()
    {
        var paths = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "iRacing", "ui", "iRacingUI.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "iRacing", "ui", "iRacingUI.exe"),
        };
        return paths.FirstOrDefault(File.Exists);
    }

    internal static bool IsIracingUiRunning()
    {
        foreach (var p in Process.GetProcessesByName("iRacingUI")) using (p) return true;
        return false;
    }

    internal static void CloseIracingUi()
    {
        foreach (var p in Process.GetProcessesByName("iRacingUI"))
        {
            using (p)
            {
                try
                {
                    if (p.MainWindowHandle != IntPtr.Zero) p.CloseMainWindow();
                    if (!p.WaitForExit(4000)) p.Kill(entireProcessTree: true);
                }
                catch { }
            }
        }
    }
}
