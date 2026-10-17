using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;

namespace RacingAgent;

/// <summary>
/// Background export of official race results from the installed iRacing UI.
/// Works through UI Automation only: InvokePattern on the "Results" button of each race row, then on
/// the modal's download button and its "Download JSON" item. No SendInput or coordinates; the window
/// is brought forward only as far as needed (see ExistingWindow). Every scan fingerprints all visible
/// "Recent Races" rows (up to 10) and opens only those not yet confirmed in State.SentRaces, so a new
/// race at any position is caught. Runs only with the sim closed (no user-idle requirement), never
/// touches a modal/dialog the user already has open, and is capped per run and per day. The JSON that
/// the UI drops in Downloads as a GUID .tmp is read, queued and deleted immediately (also on failure paths).
/// </summary>
internal sealed partial class ResultExporter
{
    const int MaxPerRun = 5, MaxPerDay = 20;
    static readonly TimeSpan MinInterval = TimeSpan.FromMinutes(10), TriggerInterval = TimeSpan.FromSeconds(60), ScanInterval = TimeSpan.FromMinutes(30);
    // Dev check only (--export-test N): export the N newest results regardless of what the server knows.
    internal static int TestCount;
    internal static readonly List<long> TestIds = new();
    readonly object gate = new();
    Stopwatch? sinceAttempt;
    bool running;
    // Event-driven scan request (agent start with the UI open, iRacing UI opened, simulator closed). Cleared when an attempt starts;
    // re-armed (bounded) when the attempt could not read the list, e.g. the UI is still loading.
    static volatile bool scanRequested; static int triggerRetries;
    internal static void RequestScan(string reason) { if (!scanRequested) AgentLog.Write("Varredura solicitada: " + reason); triggerRetries = 0; scanRequested = true; }

    internal bool Due(Store store) => scanRequested || store.State.PendingResult || DateTimeOffset.UtcNow - store.State.LastScan >= ScanInterval;

    internal async Task<string> TryExportAsync(Store store, CancellationToken cancellation = default)
    {
        var triggered = scanRequested;
        lock (gate)
        {
            if (running) return "Exportação: verificação em andamento.";
            if (sinceAttempt is not null && sinceAttempt.Elapsed < (triggered ? TriggerInterval : MinInterval)) return "Exportação: aguardando intervalo entre tentativas.";
            if (!SafeToOperate()) return "Exportação pausada: simulador aberto.";
            scanRequested = false;
            var today = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
            if (store.State.ExportDay != today) { store.State.ExportDay = today; store.State.Exports = 0; }
            sinceAttempt = Stopwatch.StartNew(); running = true;
        }
        try
        {
            if (!store.State.FieldMigrated)
            {
                // The server now treats a race as known only once its field is stored: forget the local "already exported" memory once.
                store.State.FieldMigrated = true; store.State.LastResultIds = []; store.State.SentRaces = []; store.Save();
            }
            var known = TestCount > 0 ? new HashSet<long>() : await store.KnownResults(cancellation);
            if (known is null) { Rearm(triggered); return Log("Exportação: servidor indisponível para conferir corridas conhecidas."); }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(TestCount > 0 ? 600 : 240));
            listRead = false;
            var result = await Task.Run(() => { try { return Export(store, known, timeout.Token); } finally { RestoreWindowState(); } }, CancellationToken.None).WaitAsync(timeout.Token);
            if (!listRead) Rearm(triggered);
            return Log(result);
        }
        catch (OperationCanceledException) { Rearm(triggered); return Log("Exportação: verificação cancelada ou tempo excedido."); }
        catch (Exception e) { AgentLog.Error("Export", e); Rearm(triggered); return $"Exportação indisponível: provedor de acessibilidade não respondeu ({e.GetType().Name}: {e.Message} @ {string.Join(" < ", (e.StackTrace ?? "").Split('\n').Take(3).Select(l => l.Trim()))})."; }
        finally { lock (gate) running = false; }
    }
    static volatile bool listRead;
    // A triggered scan that could not read the list (UI still loading) is retried a few times, never indefinitely.
    static void Rearm(bool triggered) { if (triggered && Interlocked.Increment(ref triggerRetries) <= 4) scanRequested = true; }
    static string Log(string line) { AgentLog.Write(line); return line; }

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
        listRead = true;
        // Every visible row (up to 10) is checked: rows whose fingerprint is already confirmed are not opened, all others are
        // opened newest first and checked id by id (server-known ids are confirmed without a download).
        var confirmed = store.State.SentRaces;
        if (TestCount == 0 && rows.All(r => confirmed.Contains(r.Fingerprint)))
        {
            store.State.LastScan = DateTimeOffset.UtcNow; store.Save();
            return $"Exportação: {rows.Count} corridas em Recent Races, todas já confirmadas.";
        }
        int exported = 0; var stop = ""; var checkedRows = 0; var runIds = new List<long>();
        var limit = TestCount > 0 ? TestCount : MaxPerRun; var staleRetries = 0;
        for (var i = 0; i < rows.Count && exported < limit; i++)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!SafeToOperate()) { stop = " Pausada: simulador aberto."; break; }
            try {
            var current = RecentRaces(window); if (i >= current.Count) break;
            var fingerprint = current[i].Fingerprint;
            if (TestCount == 0 && confirmed.Contains(fingerprint)) continue;
            ScrollIntoView(current[i].Row);
            if (!Invoke(current[i].Button)) { stop = " Falha ao abrir resultado."; break; }
            try
            {
                var modal = WaitFor(() => ResultModal(window), cancellation);
                if (modal is null) { stop = " Resultado não abriu."; break; }
                // The modal header shows the subsession id: decide before spending a download.
                var shown = ModalSubsessionId(window);
                if (TestCount == 0 && shown is not null && known.Contains(shown.Value))
                { Confirm(store, fingerprint); checkedRows++; continue; } // checked id by id: skip known races, keep going down the list
                if (store.State.Exports >= MaxPerDay) { stop = " Limite diário de downloads atingido."; break; }
                var json = DownloadJson(window, modal, cancellation);
                store.State.Exports++; store.Save();
                if (json is null) { stop = " Download JSON indisponível."; break; }
                long? id;
                try { id = store.EnqueueOfficial(json, known); }
                catch (JsonException) { id = null; }
                if (id is null) { stop = " JSON inesperado."; break; }
                if (TestCount == 0) Confirm(store, fingerprint); // queued durably (or already known): never reopened
                if (known.Contains(id.Value) && TestCount == 0) { checkedRows++; continue; }
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
        // Keep the confirmed set bounded: forget fingerprints that left the visible list once it grows past 50.
        if (confirmed.Count > 50) confirmed.IntersectWith(rows.Select(r => r.Fingerprint));
        store.State.LastScan = DateTimeOffset.UtcNow; store.Save();
        return $"Exportação: {exported} resultado(s) novo(s) enfileirado(s), {checkedRows} já conhecida(s).{stop}{(LastError.Length > 0 ? " [" + LastError + "]" : "")}";
    }
    static void Confirm(Store store, string fingerprint) { if (fingerprint.Length > 0) { store.State.SentRaces.Add(fingerprint); store.Save(); } }

    // The header text can sit outside the dialog node, so search the whole window (onscreen only; the page behind has no 7+ digit text).
    internal static long? ModalSubsessionId(AutomationElement window)
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

    internal static void ScrollIntoView(AutomationElement element)
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

    internal static byte[]? DownloadJson(AutomationElement window, AutomationElement modal, CancellationToken cancellation)
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
            LastError = $"botão de download do rodapé não encontrado (botões {all.Count}, share {all.Count(b => b.Current.Name.Contains("Share"))}, sem nome {all.Count(b => b.Current.Name.Length == 0 && !b.Current.IsOffscreen)}; share {all.FirstOrDefault(b => b.Current.Name.Contains("Share"))?.Current.BoundingRectangle.ToString() ?? "ausente"}; menu {string.Join(" ", all.Where(b => b.Current.AutomationId.StartsWith("menu-button-")).Select(b => b.Current.BoundingRectangle.ToString() + (b.Current.IsOffscreen ? "off" : "")))})";
            return null;
        }
        if (!Invoke(download)) { LastError = "Invoke do botão de download falhou"; return null; }
        var item = WaitFor(() => window.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
            new PropertyCondition(AutomationElement.NameProperty, "Download JSON"))), cancellation);
        if (item is null) return null;
        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var started = DateTime.UtcNow.AddSeconds(-1);
        // Every exit path (success, timeout, invalid content, cancellation) dismisses the Save dialog and then
        // removes any .tmp created after `started` whose content is an event_result (never other files).
        try
        {
            if (!Invoke(item)) return null;
            for (var waited = 0; waited < 15000; waited += 500)
            {
                cancellation.ThrowIfCancellationRequested();
                Thread.Sleep(500);
                foreach (var file in new DirectoryInfo(downloads).EnumerateFiles("*.tmp").Where(f => f.CreationTimeUtc >= started && f.Length is > 0 and <= 1024 * 1024))
                {
                    try
                    {
                        var bytes = ReadEventResultTmp(file.FullName);
                        if (bytes is null) continue;
                        if (new FileInfo(file.FullName).Length != bytes.Length) continue; // still being written
                        return bytes;
                    }
                    catch (IOException) { }
                }
            }
            return null;
        }
        finally
        {
            try { DismissSave(window); } catch (Exception e) { AgentLog.Error("DismissSave", e); }
            CleanDownloadTmp(downloads, started);
        }
    }

    // Reads a Downloads .tmp and returns its bytes only when it is an event_result JSON.
    static byte[]? ReadEventResultTmp(string path)
    {
        byte[] bytes;
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            bytes = new byte[stream.Length];
            stream.ReadExactly(bytes);
        }
        var head = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 120));
        return head.TrimStart().StartsWith('{') && head.Contains("\"event_result\"") ? bytes : null;
    }

    // The browser may still hold the file for a moment after the dialog closes: a few short retries, best effort.
    static void CleanDownloadTmp(string downloads, DateTime started)
    {
        for (var attempt = 0; attempt < 4; attempt++)
        {
            var left = 0;
            try
            {
                foreach (var file in new DirectoryInfo(downloads).EnumerateFiles("*.tmp").Where(f => f.CreationTimeUtc >= started && f.Length is > 0 and <= 1024 * 1024))
                {
                    try
                    {
                        if (ReadEventResultTmp(file.FullName) is null) continue;
                        File.Delete(file.FullName);
                    }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException) { left++; }
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { left++; }
            if (left == 0) return;
            Thread.Sleep(500);
        }
        AgentLog.Write("Aviso: .tmp de event_result não pôde ser removido de Downloads");
    }

    // The UI's download opens a native Save dialog (#32770, titled with the blob URL) while the
    // complete payload already sits in Downloads as a GUID .tmp. Cancelling it with BM_CLICK
    // (no focus) lets the browser discard the file, so nothing is left behind locally.
    internal static List<AutomationElement> SaveDialogs(AutomationElement window) =>
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

    internal static void CloseModal(AutomationElement window, CancellationToken cancellation)
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
            if (name.StartsWith("@patterns:"))
            {
                var el = window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, name[(name.IndexOf(':') + 1)..]));
                if (el is null) return "não achei " + name;
                sb.AppendLine("Padrões: " + string.Join(",", el.GetSupportedPatterns().Select(x => x.ProgrammaticName)));
                continue;
            }
            if (name.StartsWith("@focus:"))
            {
                var el = window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, name[7..]));
                if (el is null) return "não achei " + name;
                try { el.SetFocus(); } catch (Exception e) { return "SetFocus falhou: " + e.Message; }
                Thread.Sleep(2500); continue;
            }
            if (name.StartsWith("@set:"))
            {
                var parts = name[5..].Split('=', 2);
                var edit = window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, parts[0]));
                if (edit is null) return $"não achei {parts[0]}";
                try { ((ValuePattern)edit.GetCurrentPattern(ValuePattern.Pattern)).SetValue(parts[1]); } catch (Exception e) { return "SetValue falhou: " + e.Message; }
                Thread.Sleep(2500); continue;
            }
            if (name == "@close") { CloseModal(window, CancellationToken.None); continue; }
            if (name == "@recent0")
            {
                var first = RecentRaces(window).FirstOrDefault(); if (first.Button is null) return "Recent Races não encontrado";
                ScrollIntoView(first.Row); Invoke(first.Button); Thread.Sleep(3500); continue;
            }
            // "#id" matches by AutomationId. Pattern order: Invoke, SelectionItem, Toggle, ExpandCollapse.
            var byId = name.StartsWith('#');
            var target = window.FindAll(TreeScope.Descendants, new PropertyCondition(byId ? AutomationElement.AutomationIdProperty : AutomationElement.NameProperty, byId ? name[1..] : name)).Cast<AutomationElement>()
                .OrderBy(e => e.Current.IsOffscreen).FirstOrDefault(e => (e.TryGetCurrentPattern(InvokePattern.Pattern, out _) || e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _) || e.TryGetCurrentPattern(TogglePattern.Pattern, out _) || e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out _)));
            if (target is null) return $"não achei '{name}'";
            if (target.TryGetCurrentPattern(InvokePattern.Pattern, out var p)) ((InvokePattern)p).Invoke();
            else if (target.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var sip)) ((SelectionItemPattern)sip).Select();
            else if (target.TryGetCurrentPattern(TogglePattern.Pattern, out var tgp)) ((TogglePattern)tgp).Toggle();
            else ((ExpandCollapsePattern)target.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand();
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
                var state = "";
                if (e.TryGetCurrentPattern(TogglePattern.Pattern, out var tp)) state = "|toggle=" + ((TogglePattern)tp).Current.ToggleState;
                else if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var sp)) state = "|selected=" + ((SelectionItemPattern)sp).Current.IsSelected;
                else if (type == "Edit" && e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) state = "|value=" + ((ValuePattern)vp).Current.Value;
                if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var xp)) state += "|exp=" + ((ExpandCollapsePattern)xp).Current.ExpandCollapseState;
                sb.AppendLine($"{type}|{c.Name.Replace('\n', ' ')}|{c.AutomationId}|{(int)r.Left},{(int)r.Top},{(int)r.Width}x{(int)r.Height}{state}{(c.IsOffscreen ? "|off" : "")}{(c.IsEnabled ? "" : "|dis")}");
            }
            catch { }
        }
        return sb.ToString();
    }

    internal static bool Invoke(AutomationElement element)
    {
        if (!element.Current.IsEnabled || !element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) return false;
        ((InvokePattern)pattern).Invoke(); return true;
    }

    internal static T? WaitFor<T>(Func<T?> find, CancellationToken cancellation, int millis = 6000) where T : class
    {
        for (var waited = 0; waited < millis; waited += 250)
        {
            cancellation.ThrowIfCancellationRequested();
            var found = find(); if (found is not null) return found;
            Thread.Sleep(250);
        }
        return null;
    }

    internal static AutomationElement? ExistingWindow()
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
        windowHandle = handles[0]; restoredFromMinimized = false; raisedFrom = IntPtr.Zero; raised = false;
        var element = AutomationElement.FromHandle(windowHandle);
        // Escalate only as far as needed to get a complete UI tree (the embedded Chromium hides it while minimized/occluded):
        // 1) as is (user keeps working, nothing changes on screen); 2) restore from minimized without activation (SW_SHOWNOACTIVATE);
        // 3) place above other windows without activating (SWP_NOACTIVATE: no focus, keyboard input stays where it was);
        // 4) last resort, bring to the foreground (steals focus; documented limitation). The caller restores the state afterwards.
        if (TreeReady(element)) return element;
        if (IsIconic(windowHandle)) { ShowWindow(windowHandle, 4); restoredFromMinimized = true; Thread.Sleep(1500); if (TreeReady(element)) return element; }
        raisedFrom = GetForegroundWindow(); raised = true;
        SetWindowPos(windowHandle, new IntPtr(0) /* HWND_TOP */, 0, 0, 0, 0, SwpNoSize | SwpNoMove | SwpNoActivate);
        Thread.Sleep(1500); if (TreeReady(element)) return element;
        if (GetForegroundWindow() != windowHandle) { SetForegroundWindow(windowHandle); Thread.Sleep(2500); }
        return element;
    }
    // A usable tree exposes at least one hyperlink (the left navigation); an occluded/minimized Chromium exposes none.
    static bool TreeReady(AutomationElement window)
    {
        try { return window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink)) is not null; }
        catch (Exception e) when (e is ElementNotAvailableException or InvalidOperationException) { return false; }
    }
    const uint SwpNoSize = 0x1, SwpNoMove = 0x2, SwpNoActivate = 0x10;
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    static IntPtr windowHandle, raisedFrom; static bool restoredFromMinimized, raised;
    internal static void RestoreWindowState()
    {
        if (windowHandle == IntPtr.Zero) return;
        if (restoredFromMinimized) ShowWindow(windowHandle, 7); // SW_SHOWMINNOACTIVE
        else if (raised && raisedFrom != IntPtr.Zero && raisedFrom != windowHandle)
            SetWindowPos(windowHandle, raisedFrom, 0, 0, 0, 0, SwpNoSize | SwpNoMove | SwpNoActivate); // back just behind the window the user was on
        if (raised && raisedFrom != IntPtr.Zero && GetForegroundWindow() != raisedFrom) SetForegroundWindow(raisedFrom);
        restoredFromMinimized = false; raised = false; raisedFrom = IntPtr.Zero;
    }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool ShowWindow(IntPtr hwnd, int command);

    internal static AutomationElement? ResultModal(AutomationElement window)
    {
        var modals = window.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "modal-results-modal-dialog"));
        return modals.Count == 1 ? modals[0] : null;
    }

    internal static bool SafeToOperate()
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
}
