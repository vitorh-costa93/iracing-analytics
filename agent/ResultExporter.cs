using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace RacingAgent;

/// <summary>
/// Opt-in idle export of official race results from the installed iRacing UI.
/// Works through UI Automation only (the tree stays complete while the window is minimized):
/// InvokePattern on the "Results" button of each race row, then on the modal's download
/// button and its "Download JSON" item. No focus, SendInput or coordinates. Runs only with the
/// sim closed and the user idle (60 s), never touches a modal the user already has open, stops
/// at the first race the server already has, and is capped per run and per day. The JSON that
/// the UI drops in Downloads as a GUID .tmp is read, queued and deleted immediately.
/// </summary>
internal sealed class ResultExporter
{
    const int MaxPerRun = 5, MaxPerDay = 20;
    static readonly TimeSpan MinInterval = TimeSpan.FromMinutes(10), ScanInterval = TimeSpan.FromHours(6);
    internal static bool SkipIdleGate;
    readonly object gate = new();
    Stopwatch? sinceAttempt;
    bool running;

    internal bool Due(Store store) => store.State.PendingResult || DateTimeOffset.UtcNow - store.State.LastScan >= ScanInterval;

    internal async Task<string> TryExportAsync(Store store, CancellationToken cancellation = default)
    {
        lock (gate)
        {
            if (running) return "Exportação: verificação em andamento.";
            if (sinceAttempt is not null && sinceAttempt.Elapsed < MinInterval) return "Exportação: aguardando intervalo de dez minutos.";
            if (!SafeToOperate()) return "Exportação pausada: simulador aberto ou usuário ativo (mínimo 60 s).";
            var today = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
            if (store.State.ExportDay != today) { store.State.ExportDay = today; store.State.Exports = 0; }
            if (store.State.Exports >= MaxPerDay) return "Exportação: limite diário de downloads atingido.";
            sinceAttempt = Stopwatch.StartNew(); running = true;
        }
        try
        {
            var known = await store.KnownResults(cancellation);
            if (known is null) return "Exportação: servidor indisponível para conferir corridas conhecidas.";
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            return await Task.Run(() => Export(store, known, timeout.Token), CancellationToken.None).WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) { return "Exportação: verificação cancelada ou tempo excedido."; }
        catch { return "Exportação indisponível: provedor de acessibilidade não respondeu."; }
        finally { lock (gate) running = false; }
    }

    static string Export(Store store, HashSet<long> known, CancellationToken cancellation)
    {
        var window = ExistingWindow();
        if (window is null) return "Exportação: abra o aplicativo iRacing (uma janela).";
        if (ResultModal(window) is not null) return "Exportação: um resultado está aberto no iRacing; não vou interferir.";
        if (SaveDialogs(window).Count > 0) return "Exportação: há um diálogo Salvar aberto no iRacing; não vou interferir.";
        var raceRows = RaceButtons(window).Count;
        if (raceRows == 0) return "Exportação: abra Results no iRacing (lista de corridas).";
        int exported = 0; var stop = "";
        for (var i = 0; i < raceRows && exported < MaxPerRun; i++)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!SafeToOperate()) { stop = " Pausada: usuário ativo."; break; }
            if (store.State.Exports >= MaxPerDay) { stop = " Limite diário."; break; }
            var buttons = RaceButtons(window); if (i >= buttons.Count) break;
            if (!Invoke(buttons[i])) { stop = " Falha ao abrir resultado."; break; }
            try
            {
                var modal = WaitFor(() => ResultModal(window), cancellation);
                if (modal is null) { stop = " Resultado não abriu."; break; }
                var json = DownloadJson(window, modal, cancellation);
                store.State.Exports++; store.Save();
                if (json is null) { stop = " Download JSON indisponível."; break; }
                var id = store.EnqueueOfficial(json, known);
                if (id is null) { stop = " JSON inesperado."; break; }
                if (known.Contains(id.Value)) { stop = " Alcançou corrida já conhecida."; break; }
                exported++;
            }
            finally { CloseModal(window, cancellation); }
        }
        store.State.LastScan = DateTimeOffset.UtcNow; store.Save();
        return $"Exportação: {exported} resultado(s) novo(s) enfileirado(s).{stop}{(LastError.Length > 0 ? " [" + LastError + "]" : "")}";
    }

    // Race rows only: the type column ("R") shares the row with its "Results" button.
    static List<AutomationElement> RaceButtons(AutomationElement window)
    {
        var types = window.FindAll(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem),
            new PropertyCondition(AutomationElement.NameProperty, "R"))).Cast<AutomationElement>()
            .Where(e => !e.Current.IsOffscreen).Select(e => e.Current.BoundingRectangle).ToList();
        return window.FindAll(TreeScope.Descendants, new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.NameProperty, "Results"))).Cast<AutomationElement>()
            .Where(b => !b.Current.IsOffscreen && types.Any(t => Math.Abs((t.Top + t.Height / 2) - (b.Current.BoundingRectangle.Top + b.Current.BoundingRectangle.Height / 2)) < 20))
            .OrderBy(b => b.Current.BoundingRectangle.Top).ToList();
    }

    static byte[]? DownloadJson(AutomationElement window, AutomationElement modal, CancellationToken cancellation)
    {
        // The unnamed download icon is the lowest unnamed menu-button of the modal footer.
        // Anchor on the modal's own "Share Results" button: the list page has a similar unnamed
        // download button whose JSON is a different (session list) payload.
        var download = WaitFor(() =>
        {
            var buttons = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>()
                .Where(b => !b.Current.IsOffscreen).ToList();
            var share = buttons.FirstOrDefault(b => b.Current.Name.Contains("Share", StringComparison.Ordinal));
            if (share is null) return null;
            var shareRect = share.Current.BoundingRectangle;
            return buttons
                .Where(b => b.Current.AutomationId.StartsWith("menu-button-", StringComparison.Ordinal)
                    && Math.Abs(b.Current.BoundingRectangle.Top - shareRect.Top) < 20 && b.Current.BoundingRectangle.Left < shareRect.Left)
                .OrderByDescending(b => b.Current.BoundingRectangle.Left).FirstOrDefault();
        }, cancellation);
        if (download is null)
        {
            var all = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().ToList();
            LastError = $"botão de download do rodapé não encontrado (botões {all.Count}, share {all.Count(b => b.Current.Name.Contains("Share"))}, sem nome {all.Count(b => b.Current.Name.Length == 0 && !b.Current.IsOffscreen)}; share {all.First(b => b.Current.Name.Contains("Share")).Current.BoundingRectangle}; menu {string.Join(" ", all.Where(b => b.Current.AutomationId.StartsWith("menu-button-")).Select(b => b.Current.BoundingRectangle.ToString() + (b.Current.IsOffscreen ? "off" : "")))})";
            return null;
        }
        if (!Invoke(download)) { LastError = "Invoke do botão de download falhou"; return null; }
        var item = WaitFor(() => window.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
            new PropertyCondition(AutomationElement.NameProperty, "Download JSON"))), cancellation);
        if (item is null) return null;
        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var started = DateTime.UtcNow.AddSeconds(-1);
        if (!Invoke(item)) return null;
        for (var waited = 0; waited < 15000; waited += 500)
        {
            cancellation.ThrowIfCancellationRequested();
            Thread.Sleep(500);
            foreach (var file in new DirectoryInfo(downloads).EnumerateFiles("*.tmp").Where(f => f.CreationTimeUtc >= started && f.Length is > 0 and <= 1024 * 1024))
            {
                try
                {
                    byte[] bytes;
                    using (var stream = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    {
                        bytes = new byte[stream.Length];
                        stream.ReadExactly(bytes);
                    }
                    var head = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 120));
                    if (!head.TrimStart().StartsWith('{') || !head.Contains("\"event_result\"")) continue;
                    if (new FileInfo(file.FullName).Length != bytes.Length) continue; // still being written
                    DismissSave(window);
                    try { File.Delete(file.FullName); } catch (IOException) { }
                    return bytes;
                }
                catch (IOException) { }
            }
        }
        DismissSave(window);
        return null;
    }

    // The UI's download opens a native Save dialog (#32770, titled with the blob URL) while the
    // complete payload already sits in Downloads as a GUID .tmp. Cancelling it with BM_CLICK
    // (no focus) lets the browser discard the file, so nothing is left behind locally.
    static List<AutomationElement> SaveDialogs(AutomationElement window) =>
        window.FindAll(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window),
            new PropertyCondition(AutomationElement.ClassNameProperty, "#32770"))).Cast<AutomationElement>()
            .Where(d => d.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "FileNameControlHost")) is not null).ToList();

    static void DismissSave(AutomationElement window)
    {
        foreach (var dialog in SaveDialogs(window))
        {
            // The native Cancel button has control id 2 (IDCANCEL) regardless of the UI language.
            var cancel = dialog.FindFirst(TreeScope.Descendants, new AndCondition(
                new PropertyCondition(AutomationElement.AutomationIdProperty, "2"),
                new PropertyCondition(AutomationElement.ClassNameProperty, "Button")));
            if (cancel is not null) SendMessage(new IntPtr(cancel.Current.NativeWindowHandle), 0x00F5 /* BM_CLICK */, IntPtr.Zero, IntPtr.Zero);
        }
        Thread.Sleep(400);
    }

    static void CloseModal(AutomationElement window, CancellationToken cancellation)
    {
        // Menu popups are dismissed together with the modal. Failing to close is non-fatal.
        try
        {
            DismissSave(window);
            var close = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink)).Cast<AutomationElement>()
                .FirstOrDefault(e => e.Current.AutomationId.StartsWith("default-close-modal-btn", StringComparison.Ordinal));
            if (close is not null) Invoke(close);
            WaitFor(() => ResultModal(window) is null ? window : null, CancellationToken.None, 4000);
        }
        catch (Exception e) { LastError = e.GetType().Name + ": " + e.Message; }
    }
    internal static string LastError = "";

    static bool Invoke(AutomationElement element)
    {
        if (!element.Current.IsEnabled || !element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) return false;
        ((InvokePattern)pattern).Invoke(); return true;
    }

    static T? WaitFor<T>(Func<T?> find, CancellationToken cancellation, int millis = 6000) where T : class
    {
        for (var waited = 0; waited < millis; waited += 250)
        {
            cancellation.ThrowIfCancellationRequested();
            var found = find(); if (found is not null) return found;
            Thread.Sleep(250);
        }
        return null;
    }

    static AutomationElement? ExistingWindow()
    {
        var handles = new List<IntPtr>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                if (!process.ProcessName.Equals("iRacingUI", StringComparison.OrdinalIgnoreCase)) continue;
                var handle = process.MainWindowHandle;
                if (handle != IntPtr.Zero) handles.Add(handle);
            }
        }
        return handles.Count == 1 ? AutomationElement.FromHandle(handles[0]) : null;
    }

    static AutomationElement? ResultModal(AutomationElement window)
    {
        var modals = window.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "modal-results-modal-dialog"));
        return modals.Count == 1 ? modals[0] : null;
    }

    static bool SafeToOperate()
    {
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                if (process.ProcessName.StartsWith("iRacingSim", StringComparison.OrdinalIgnoreCase)
                    || process.ProcessName.Equals("LockApp", StringComparison.OrdinalIgnoreCase)) return false;
            }
        }
        var input = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        return SkipIdleGate || GetLastInputInfo(ref input) && unchecked((uint)Environment.TickCount - input.Time) >= 60000;
    }

    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    struct LastInputInfo { internal uint Size; internal uint Time; }
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetLastInputInfo(ref LastInputInfo input);
}
