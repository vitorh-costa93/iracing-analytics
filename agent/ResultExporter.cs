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
    // Dev check only (--export-test N): export the N newest results regardless of what the server knows.
    internal static int TestCount;
    internal static readonly List<long> TestIds = new();
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
            if (!SafeToOperate()) return "Exportação pausada: simulador aberto.";
            var today = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
            if (store.State.ExportDay != today) { store.State.ExportDay = today; store.State.Exports = 0; }
            sinceAttempt = Stopwatch.StartNew(); running = true;
        }
        try
        {
            var known = TestCount > 0 ? new HashSet<long>() : await store.KnownResults(cancellation);
            if (known is null) return "Exportação: servidor indisponível para conferir corridas conhecidas.";
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(TestCount > 0 ? 600 : 120));
            return await Task.Run(() => { try { return Export(store, known, timeout.Token); } finally { RestoreWindowState(); } }, CancellationToken.None).WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) { return "Exportação: verificação cancelada ou tempo excedido."; }
        catch (Exception e) { return $"Exportação indisponível: provedor de acessibilidade não respondeu ({e.GetType().Name}: {e.Message} @ {string.Join(" < ", (e.StackTrace ?? "").Split('\n').Take(3).Select(l => l.Trim()))})."; }
        finally { lock (gate) running = false; }
    }

    static string Export(Store store, HashSet<long> known, CancellationToken cancellation)
    {
        var window = ExistingWindow();
        if (window is null) return "Exportação: abra o aplicativo iRacing (uma janela).";
        if (ResultModal(window) is not null) return "Exportação: um resultado está aberto no iRacing; não vou interferir.";
        if (SaveDialogs(window).Count > 0) return "Exportação: há um diálogo Salvar aberto no iRacing; não vou interferir.";
        var rows = RecentRaces(window);
        if (rows.Count == 0)
        {
            // Profile > Stats is where the last 10 races live; navigate there only when idle and nothing is open.
            foreach (var name in new[] { "Profile", "Stats" })
            {
                var link = WaitFor(() => window.FindAll(TreeScope.Descendants, new AndCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
                    new PropertyCondition(AutomationElement.NameProperty, name))).Cast<AutomationElement>().FirstOrDefault(e => !e.Current.IsOffscreen), cancellation, 3000);
                if (link is null || !Invoke(link)) break;
                Thread.Sleep(2500);
            }
            rows = WaitFor(() => RecentRaces(window) is { Count: > 0 } r ? r : null, cancellation, 8000) ?? [];
        }
        if (rows.Count == 0) return "Exportação: não achei 'Recent Races' (Perfil > Stats) no iRacing.";
        // Unchanged newest row = no new race since the last scan: nothing is opened, nothing is downloaded.
        if (TestCount == 0 && store.State.LastTopRace == rows[0].Fingerprint)
        {
            store.State.LastScan = DateTimeOffset.UtcNow; store.Save();
            return "Exportação: nenhuma corrida nova em Recent Races.";
        }
        int exported = 0; var stop = ""; var reachedKnown = false; var runIds = new List<long>();
        var limit = TestCount > 0 ? TestCount : MaxPerRun; var staleRetries = 0;
        for (var i = 0; i < rows.Count && exported < limit; i++)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!SafeToOperate()) { stop = " Pausada: simulador aberto."; break; }
            try {
            var current = RecentRaces(window); if (i >= current.Count) break;
            ScrollIntoView(current[i].Row);
            if (!Invoke(current[i].Button)) { stop = " Falha ao abrir resultado."; break; }
            try
            {
                var modal = WaitFor(() => ResultModal(window), cancellation);
                if (modal is null) { stop = " Resultado não abriu."; break; }
                // The modal header shows the subsession id: decide before spending a download.
                var shown = ModalSubsessionId(window);
                if (TestCount == 0 && shown is not null && (known.Contains(shown.Value) || store.State.LastResultIds.Contains(shown.Value)))
                { reachedKnown = true; continue; } // checked id by id: skip known races, keep going down the list
                if (store.State.Exports >= MaxPerDay) { stop = " Limite diário de downloads atingido."; break; }
                var json = DownloadJson(window, modal, cancellation);
                store.State.Exports++; store.Save();
                if (json is null) { stop = " Download JSON indisponível."; break; }
                var id = store.EnqueueOfficial(json, known);
                if (id is null) { stop = " JSON inesperado."; break; }
                if (known.Contains(id.Value) && TestCount == 0) { reachedKnown = true; continue; }
                runIds.Add(id.Value);
                if (TestCount > 0) TestIds.Add(id.Value);
                exported++;
            }
            finally { CloseModal(window, cancellation); }
            }
            // The page re-renders after a modal closes; stale elements get one more attempt on the same row.
            catch (ElementNotAvailableException) when (staleRetries++ < 4) { Thread.Sleep(2000); i--; }
        }
        // Newest first, bounded: the durable record of which result ids were already exported.
        store.State.LastResultIds = runIds.Concat(store.State.LastResultIds.Where(x => !runIds.Contains(x))).Take(20).ToList();
        // Only a scan that reached an already-known race (or exhausted the list) proves the newer rows were all handled.
        if (TestCount == 0 && (reachedKnown || (stop.Length == 0 && exported < limit))) store.State.LastTopRace = rows[0].Fingerprint;
        store.State.LastScan = DateTimeOffset.UtcNow; store.Save();
        return $"Exportação: {exported} resultado(s) novo(s) enfileirado(s).{stop}{(LastError.Length > 0 ? " [" + LastError + "]" : "")}";
    }

    // The header text can sit outside the dialog node, so search the whole window (onscreen only; the page behind has no 7+ digit text).
    static long? ModalSubsessionId(AutomationElement window)
    {
        var top = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)).Cast<AutomationElement>()
            .Select(e => (Name: e.Current.Name, R: e.Current.BoundingRectangle))
            .Where(t => t.Name.Length is >= 7 and <= 10 && t.Name.All(char.IsDigit) && t.R.Height > 0 && t.R.Top > 0 && t.R.Top < 400)
            .OrderBy(t => t.R.Top).ThenBy(t => t.R.Left).FirstOrDefault();
        return top.Name is not null && long.TryParse(top.Name, out var id) ? id : null;
    }

    // Profile > Stats > "Recent Races": the last 10 races only (no practice/qualifying), newest first.
    // Each row is a DataItem sibling group; the row's "Results" button shares its vertical band.
    // Offscreen rows stay in the accessibility tree, so no scrolling by coordinates is needed.
    internal static List<(AutomationElement Row, AutomationElement Button, string Fingerprint)> RecentRaces(AutomationElement window)
    {
        var card = window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "member-profile-last10-stats-card"));
        var rows = new List<(AutomationElement, AutomationElement, string)>();
        if (card is null) return rows;
        var cells = card.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem)).Cast<AutomationElement>()
            .Select(e => (E: e, R: e.Current.BoundingRectangle, N: e.Current.Name)).Where(c => c.R.Height > 0).ToList();
        foreach (var button in card.FindAll(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.NameProperty, "Results"))).Cast<AutomationElement>().OrderBy(b => b.Current.BoundingRectangle.Top))
        {
            var mid = button.Current.BoundingRectangle.Top + button.Current.BoundingRectangle.Height / 2;
            var band = cells.Where(c => c.R.Top <= mid && mid <= c.R.Bottom && c.R.Height < 80).OrderBy(c => c.R.Left).ToList();
            if (band.Count == 0) continue;
            // date | series | season | car | track | start | finish | inc | sof (skip winner and points)
            var fp = string.Join("|", band.Select(c => c.N).Where(n => n.Length > 0 && n != "Results"));
            rows.Add((band[0].E, button, fp));
        }
        return rows;
    }

    static void ScrollIntoView(AutomationElement element)
    {
        try { if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out var p)) ((ScrollItemPattern)p).ScrollIntoView(); } catch { }
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

    // Dev diagnostic (--dump-ui): visible, non-text-input elements of the iRacing UI, no personal data beyond control names.
    internal static string DumpUi(string[] invokeNames)
    {
        var window = ExistingWindow(); if (window is null) return "janela iRacingUI não encontrada (ou mais de uma)";
        var sb = new StringBuilder();
        foreach (var name in invokeNames)
        {
            if (name == "@id") { sb.AppendLine("ID lido do modal: " + (ModalSubsessionId(window)?.ToString() ?? "NULL")); continue; }
            if (name == "@close") { CloseModal(window, CancellationToken.None); continue; }
            if (name == "@recent0")
            {
                var first = RecentRaces(window).FirstOrDefault(); if (first.Button is null) return "Recent Races não encontrado";
                ScrollIntoView(first.Row); Invoke(first.Button); Thread.Sleep(3500); continue;
            }
            var target = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, name)).Cast<AutomationElement>()
                .FirstOrDefault(e => !e.Current.IsOffscreen && e.TryGetCurrentPattern(InvokePattern.Pattern, out _) || !e.Current.IsOffscreen && e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _));
            if (target is null) return $"não achei '{name}'";
            if (target.TryGetCurrentPattern(InvokePattern.Pattern, out var p)) ((InvokePattern)p).Invoke(); else ((SelectionItemPattern)target.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
            Thread.Sleep(3500);
        }
        foreach (AutomationElement e in window.FindAll(TreeScope.Descendants, Condition.TrueCondition))
        {
            try
            {
                var c = e.Current;
                var type = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
                if (type is "Pane" or "Group" or "Custom" && c.Name.Length == 0 && c.AutomationId.Length == 0) continue;
                var r = c.BoundingRectangle;
                sb.AppendLine($"{type}|{c.Name.Replace('\n', ' ')}|{c.AutomationId}|{(int)r.Left},{(int)r.Top},{(int)r.Width}x{(int)r.Height}{(c.IsOffscreen ? "|off" : "")}");
            }
            catch { }
        }
        return sb.ToString();
    }

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
        if (handles.Count != 1) return null;
        // A minimized window exposes no UI tree: restore it without taking focus; the caller re-minimizes it afterwards.
        windowHandle = handles[0]; restoredFromMinimized = false;
        if (IsIconic(windowHandle)) { ShowWindow(windowHandle, 4); restoredFromMinimized = true; Thread.Sleep(1500); }
        // The embedded Chromium only exposes its UI tree while the window is not occluded: raise it for the scan (sim is closed).
        if (GetForegroundWindow() != windowHandle) { SetForegroundWindow(windowHandle); Thread.Sleep(2500); }
        return AutomationElement.FromHandle(windowHandle);
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetForegroundWindow(IntPtr hwnd);

    static IntPtr windowHandle; static bool restoredFromMinimized;
    static void RestoreWindowState() { if (restoredFromMinimized && windowHandle != IntPtr.Zero) ShowWindow(windowHandle, 7); restoredFromMinimized = false; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool ShowWindow(IntPtr hwnd, int command);

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
        // Runs in the background whenever the simulator is closed; no user-idle requirement (decided 09/10/2026).
        return true;
    }

    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    struct LastInputInfo { internal uint Size; internal uint Time; }
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetLastInputInfo(ref LastInputInfo input);
}
