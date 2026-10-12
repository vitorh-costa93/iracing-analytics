using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace RacingAgent;

/// <summary>
/// Explicit, one-off historical backfill of official race results (never automatic). Drives the iRacing UI
/// through UI Automation only: Results &amp; Stats > Results Archive > "Find Past Results", one search per
/// Year/Season (Race only, all weeks), then page by page (newest first), row by row: open the "Results"
/// modal, read the subsession id BEFORE downloading, skip ids the server already stores (GET ?scope=all),
/// otherwise download the JSON, reduce it (ResultReducer), queue it and send it (at most 8 per minute).
/// Resumes from state.json. Unlike the idle exporter it ignores MaxPerRun/MaxPerDay and the 10 min gap, but
/// stops cleanly at the first unexpected error, at the daily request/byte budget or at any server refusal.
/// </summary>
internal sealed partial class ResultExporter
{
    internal sealed record BackfillOptions(bool DryRun, bool ProbeIds, int FromYear, int FromSeason, int Limit = int.MaxValue, int ToYear = 9999, int ToSeason = 4);
    static readonly TimeSpan SendSpacing = TimeSpan.FromSeconds(7.6); // <= 8 sends per minute
    static readonly Regex Range = new(@"^(\d+)-(\d+) of (\d+)$", RegexOptions.Compiled);
    static readonly Regex Found = new(@"^(\d+) Results? found$", RegexOptions.Compiled);

    internal async Task<string> BackfillAsync(Store store, BackfillOptions options, Action<string> report, CancellationToken cancellation)
    {
        lock (gate)
        {
            if (running) return "Backfill: outra verificação em andamento.";
            if (!SafeToOperate()) return "Backfill pausado: simulador aberto.";
            running = true;
        }
        try
        {
            Store.BackfillMode = !options.DryRun;
            var known = await store.KnownResults(cancellation, all: true);
            if (known is null) return "Backfill: servidor indisponível para conferir corridas conhecidas.";
            return await Task.Run(() => { try { return Backfill(store, known, options, report, cancellation); } finally { RestoreWindowState(); } }, CancellationToken.None);
        }
        catch (OperationCanceledException) { return "Backfill: cancelado."; }
        catch (Exception e) { return $"Backfill indisponível: {e.GetType().Name}: {e.Message} @ {string.Join(" < ", (e.StackTrace ?? "").Split((char)10).Take(3).Select(l => l.Trim()))}"; }
        finally { Store.BackfillMode = false; lock (gate) running = false; }
    }

    string Backfill(Store store, HashSet<long> known, BackfillOptions o, Action<string> report, CancellationToken ct)
    {
        var logPath = Path.Combine(store.Root, "backfill.log");
        void Log(string message)
        {
            var line = $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ} {(o.DryRun ? "[dry] " : "")}{message}";
            try { File.AppendAllText(logPath, line + Environment.NewLine); } catch (IOException) { }
            report(message);
        }
        var window = ExistingWindow();
        if (window is null) return "Backfill: abra o aplicativo iRacing (uma janela).";
        if (ResultModal(window) is not null) return "Backfill: um resultado está aberto no iRacing; não vou interferir.";
        if (SaveDialogs(window).Count > 0) return "Backfill: há um diálogo Salvar aberto no iRacing; não vou interferir.";
        if (SearchDialogOpen(window)) return "Backfill: o diálogo Find Past Results já está aberto; não vou interferir.";
        if (!EnsureArchive(window, ct)) return "Backfill: não achei Results & Stats > Results Archive no iRacing.";

        var stop = ""; int downloaded = 0, skipped = 0, found = 0;
        Log($"início: desde {o.FromYear} S{o.FromSeason}; conhecidas no servidor: {known.Count}; modo {(o.DryRun ? (o.ProbeIds ? "dry-run com leitura de ids" : "dry-run só contagem") : "real")}");
        if (!o.DryRun && !DrainQueue(store, ref stop, ct)) return $"Backfill: {stop.Trim()}";
        var now = DateTime.UtcNow.Year;
        for (var year = now; year >= o.FromYear && stop.Length == 0; year--)
        {
            for (var season = 4; season >= 1 && stop.Length == 0; season--)
            {
                if (year == o.FromYear && season < o.FromSeason) continue;
                if (year * 10 + season > o.ToYear * 10 + o.ToSeason) continue; // --to: newest season to include
                ct.ThrowIfCancellationRequested();
                var key = $"{year}-{season}";
                if (!o.DryRun && store.State.BackfillDone.Contains(key)) { Log($"{key}: já concluída, pulando"); continue; }
                if (!SafeToOperate()) { stop = " Pausada: simulador aberto."; break; }
                var total = SearchRetry(window, year, season, ct);
                if (total < 0) { stop = $" Busca de {key} falhou ({LastError})."; break; }
                found += total;
                if (total == 0) { Log($"{key}: 0 corridas"); if (!o.DryRun) { store.State.BackfillDone.Add(key); store.Save(); } continue; }
                int sDown = 0, sSkip = 0, pages = 0, startAt = 0;
                if (!o.DryRun && store.State.BackfillKey == key && store.State.BackfillTotal > 0)
                    startAt = Math.Max(0, store.State.BackfillIndex + (total - store.State.BackfillTotal)); // new races land on top (newest first)
                if (!o.DryRun && store.State.BackfillKey != key) { store.State.BackfillKey = key; store.State.BackfillIndex = 0; store.State.BackfillTotal = total; store.Save(); }
                if (!o.DryRun && startAt > 0) Log($"{key}: retomando na corrida {startAt + 1} de {total}");
                if (o.DryRun && !o.ProbeIds) { Log($"{key}: {total} corridas encontradas"); continue; }
                Stale(() => { SetPageSize(window, "50", ct); return true; });
                var staleRetries = 0;
                while (stop.Length == 0)
                {
                    var rows = Stale(() => ArchiveRows(window));
                    var info = Stale(() => PageInfo(window));
                    if (rows.Count == 0 || info is null) { stop = $" Lista de {key} vazia ou sem paginação."; break; }
                    pages++;
                    for (var i = 0; i < rows.Count && stop.Length == 0; i++)
                    {
                        var global = info.Value.Start + i;
                        if (global < startAt) continue;
                        if (sDown + downloaded >= o.Limit) { stop = " Limite de downloads do teste atingido."; break; }
                        ct.ThrowIfCancellationRequested();
                        if (!SafeToOperate()) { stop = " Pausada: simulador aberto."; break; }
                        try
                        {
                            var current = Stale(() => ArchiveRows(window)); if (i >= current.Count) break;
                            ScrollIntoView(current[i]);
                            if (!Invoke(current[i])) { stop = " Falha ao abrir resultado."; break; }
                            try
                            {
                                if (WaitFor(() => ResultModal(window), ct) is not { } modal) { stop = " Resultado não abriu."; break; }
                                var shown = WaitFor(() => { try { return ModalSubsessionId(window) is { } v ? (object)v : null; } catch (ElementNotAvailableException) { return null; } }, ct, 8000) as long?; // header fills in after the modal opens
                                if (shown is null) { stop = " Não consegui ler o subsessionId do modal."; break; }
                                if (known.Contains(shown.Value)) sSkip++;
                                else if (!o.DryRun)
                                {
                                    if (!CanSendMore(store)) { stop = " Cota diária de envio do agente atingida; retome amanhã."; break; }
                                    var json = DownloadJson(window, modal, ct);
                                    if (json is null) { stop = $" Download JSON indisponível ({LastError})."; break; }
                                    var id = store.EnqueueOfficial(json, null);
                                    if (id is null) { stop = " JSON inesperado."; break; }
                                    known.Add(id.Value); sDown++; Log($"{key}: baixada corrida {global + 1}/{total}: {json.Length} B brutos -> {ResultReducer.Reduce(json).Length} B reduzidos");
                                    if (!DrainQueue(store, ref stop, ct)) break;
                                }
                                else sDown++; // dry-run: would download
                                if (!o.DryRun) { store.State.BackfillIndex = global + 1; store.State.BackfillTotal = total; store.Save(); }
                            }
                            finally { CloseModal(window, ct); }
                            Thread.Sleep(Random.Shared.Next(2000, 4001));
                        }
                        catch (ElementNotAvailableException) when (staleRetries++ < 6) { Thread.Sleep(2000); i--; }
                    }
                    if (stop.Length > 0) break;
                    if (Stale(() => NextPage(window, ct))) { Log($"{key}: página {pages} ({info.Value.Start + 1}-{info.Value.End} de {total}) baixadas {sDown} conhecidas {sSkip}"); continue; }
                    break;
                }
                downloaded += sDown; skipped += sSkip;
                Log($"{key}: {total} corridas, {pages} página(s), {(o.DryRun ? "novas (seriam baixadas)" : "baixadas")} {sDown}, já conhecidas {sSkip}{(stop.Length > 0 ? ", PARADA:" + stop : "")}");
                if (stop.Length == 0 && !o.DryRun) { store.State.BackfillDone.Add(key); store.State.BackfillKey = ""; store.State.BackfillIndex = 0; store.State.BackfillTotal = 0; store.Save(); }
            }
        }
        // Never leave a dialog or modal open behind.
        CloseModal(window, CancellationToken.None);
        var summary = $"Backfill {(o.DryRun ? "(dry-run) " : "")}{(stop.Length == 0 ? "concluído" : "interrompido")}: {found} corridas listadas, {(o.DryRun ? "novas" : "baixadas")} {downloaded}, conhecidas {skipped}.{stop}";
        Log(summary);
        return summary;
    }

    // Sends the queue one file at a time at <= 8/min. False (with the reason in stop) on anything but a confirmed send.
    static bool DrainQueue(Store store, ref string stop, CancellationToken ct)
    {
        for (var guard = 0; store.Backlog > 0 && guard < 400; guard++)
        {
            ct.ThrowIfCancellationRequested();
            Thread.Sleep(SendSpacing);
            store.Send(ct).GetAwaiter().GetResult();
            if (store.Status != "Envio confirmado") { stop = " Envio interrompido: " + store.Status + "."; return false; }
        }
        return true;
    }

    // Do not download what the agent's own daily request/byte budget could not send today.
    static bool CanSendMore(Store store)
    {
        var s = store.State;
        if (s.Day != DateTimeOffset.UtcNow.ToString("yyyy-MM-dd")) return true;
        if (Store.BackfillMode) return s.Requests < 3000;
        return s.Requests < Math.Clamp(s.DailyLimit, 1, 128) && s.Bytes + 200 * 1024 < 10L * 1024 * 1024;
    }

    // A node that vanishes while the tree is being enumerated reads as an empty name.
    static string NameOf(AutomationElement element) { try { return element.Current.Name; } catch (ElementNotAvailableException) { return ""; } }

    // The page re-renders after dialogs/modals close: a stale element gets fresh attempts before the error surfaces.
    static T Stale<T>(Func<T> action)
    {
        for (var attempt = 0; ; attempt++)
        {
            try { return action(); }
            catch (ElementNotAvailableException) when (attempt < 8) { Thread.Sleep(2000); }
        }
    }

    static AutomationElement? ByName(AutomationElement scope, ControlType type, string name) =>
        scope.FindAll(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, type), new PropertyCondition(AutomationElement.NameProperty, name)))
            .Cast<AutomationElement>().OrderBy(e => e.Current.IsOffscreen).FirstOrDefault();

    static bool SearchDialogOpen(AutomationElement window) => ByName(window, ControlType.Edit, "Year") is not null;

    static AutomationElement? FindButton(AutomationElement window) =>
        window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "find-past-results-button"));

    static bool EnsureArchive(AutomationElement window, CancellationToken ct)
    {
        if (FindButton(window) is not null) return true;
        var link = WaitFor(() => window.FindAll(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
            new PropertyCondition(AutomationElement.NameProperty, "Results & Stats"))).Cast<AutomationElement>().FirstOrDefault(e => !e.Current.IsOffscreen), ct, 3000);
        if (link is null || !Invoke(link)) return false;
        Thread.Sleep(2500);
        if (FindButton(window) is null && ByName(window, ControlType.TabItem, "Results Archive") is { } tab && tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var sp))
        { ((SelectionItemPattern)sp).Select(); Thread.Sleep(2000); }
        return WaitFor(() => FindButton(window), ct, 8000) is not null;
    }

    // The page re-renders while the dialog opens/closes: a stale element gets a fresh attempt.
    static int SearchRetry(AutomationElement window, int year, int season, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try { return Search(window, year, season, ct); }
            catch (ElementNotAvailableException) when (attempt < 3) { Thread.Sleep(2500); }
            catch (ElementNotAvailableException) { LastError = "elemento obsoleto"; return -1; }
        }
    }

    // Opens Find Past Results, applies Year/Season/All Weeks and Race only, searches. Returns "N Results found" or -1.
    static int Search(AutomationElement window, int year, int season, CancellationToken ct)
    {
        LastError = "";
        var button = FindButton(window); if (button is null || !Invoke(button)) { LastError = "botão Find Past Results"; return -1; }
        if (WaitFor(() => ByName(window, ControlType.Edit, "Year"), ct, 8000) is null) { LastError = "diálogo não abriu"; return -1; }
        try
        {
            if (ByName(window, ControlType.RadioButton, "Year, Season & Week") is { } radio && radio.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var rp)) ((SelectionItemPattern)rp).Select();
            foreach (var (field, item) in new[] { ("Year", year.ToString()), ("Season", $"Season {season}"), ("Week", "All Weeks") })
                if (!PickMenu(window, field, item, ct)) { LastError = $"seleção {field}={item}"; return -1; }
            // Race only; every license class and discipline stays on so no race is filtered out.
            foreach (var (name, on) in new[] { ("Race", true), ("Practice", false), ("Qualifying", false), ("Time Trial", false),
                ("Rookie", true), ("Class D", true), ("Class C", true), ("Class B", true), ("Class A", true), ("Pro", true), ("Pro / WC", true),
                ("Oval", true), ("Sports Car", true), ("Formula", true), ("Dirt Oval", true), ("Dirt Road", true), ("Road (Retired)", true) })
                if (!SetToggle(window, name, on)) { LastError = "checkbox " + name; return -1; }
            var find = ByName(window, ControlType.Button, "Find Results");
            if (find is null || !Invoke(find)) { LastError = "botão Find Results"; return -1; }
            if (WaitFor(() => SearchDialogOpen(window) ? null : window, ct, 10000) is null) { LastError = "diálogo não fechou"; return -1; }
            var total = WaitFor(() =>
            {
                foreach (AutomationElement t in window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)))
                { var m = Found.Match(NameOf(t)); if (m.Success) return (object)int.Parse(m.Groups[1].Value); }
                return null;
            }, ct, 12000);
            if (total is null) { LastError = "sem 'Results found'"; return -1; }
            Thread.Sleep(1500);
            return (int)total;
        }
        finally
        {
            // A failed search must not leave the dialog open.
            if (SearchDialogOpen(window) && ByName(window, ControlType.Button, "Close") is { } close) Invoke(close);
        }
    }

    // The Year/Season/Week fields are read-only: focusing the edit opens its menu, whose items take Invoke.
    static bool PickMenu(AutomationElement window, string field, string item, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var edit = ByName(window, ControlType.Edit, field); if (edit is null) return false;
            if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out var vp) && ((ValuePattern)vp).Current.Value == item) return true;
            try
            {
                // Re-focusing an already focused edit does not reopen its menu: park the focus on the radio first.
                if (ByName(window, ControlType.RadioButton, "Year, Season & Week") is { } park) { try { park.SetFocus(); } catch (InvalidOperationException) { } Thread.Sleep(300); }
                edit.SetFocus();
            }
            catch (InvalidOperationException) { return false; }
            var entry = WaitFor(() => ByName(window, ControlType.MenuItem, item), ct, 4000);
            if (entry is null) continue;
            if (!Invoke(entry)) continue;
            var set = WaitFor(() => ByName(window, ControlType.Edit, field) is { } after && after.TryGetCurrentPattern(ValuePattern.Pattern, out var av) && ((ValuePattern)av).Current.Value == item ? window : null, ct, 3000);
            if (set is not null) return true;
        }
        return false;
    }

    static bool SetToggle(AutomationElement window, string name, bool on)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var box = ByName(window, ControlType.CheckBox, name); if (box is null) { Thread.Sleep(500); continue; }
            if (!box.TryGetCurrentPattern(TogglePattern.Pattern, out var p)) return false;
            var toggle = (TogglePattern)p;
            if ((toggle.Current.ToggleState == ToggleState.On) != on) toggle.Toggle();
            for (var wait = 0; wait < 6; wait++)
            {
                Thread.Sleep(250);
                if ((toggle.Current.ToggleState == ToggleState.On) == on) return true;
            }
        }
        return false;
    }

    static void SetPageSize(AutomationElement window, string size, CancellationToken ct)
    {
        var button = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>()
            .Where(b => b.Current.AutomationId.StartsWith("menu-button-", StringComparison.Ordinal) && NameOf(b) is "10" or "25" or "50").OrderBy(b => b.Current.IsOffscreen).FirstOrDefault();
        if (button is null || button.Current.Name == size || !Invoke(button)) return;
        var entry = WaitFor(() => ByName(window, ControlType.MenuItem, size), ct, 3000);
        if (entry is not null && Invoke(entry)) Thread.Sleep(2500);
    }

    // "Results" buttons of the archive table, top to bottom.
    static List<AutomationElement> ArchiveRows(AutomationElement window)
    {
        var table = window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Table));
        if (table is null) return [];
        return table.FindAll(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.NameProperty, "Results"))).Cast<AutomationElement>().OrderBy(b => b.Current.BoundingRectangle.Top).ToList();
    }

    static (int Start, int End, int Total)? PageInfo(AutomationElement window)
    {
        foreach (AutomationElement t in window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)))
        {
            var m = Range.Match(NameOf(t));
            if (m.Success) return (int.Parse(m.Groups[1].Value) - 1, int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        }
        return null;
    }

    // The pager buttons are labeled "Last page"/"First page" but behave as previous/next: the right-most enabled one advances.
    static bool NextPage(AutomationElement window, CancellationToken ct)
    {
        var before = PageInfo(window); if (before is null) return false;
        var pagers = window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>()
            .Where(b => NameOf(b) is "Last page" or "First page").OrderBy(b => b.Current.IsOffscreen).ThenBy(b => b.Current.BoundingRectangle.Top).Take(2)
            .OrderBy(b => b.Current.BoundingRectangle.Left).ToList();
        if (pagers.Count != 2 || !pagers[1].Current.IsEnabled || before.Value.End >= before.Value.Total) return false;
        if (!Invoke(pagers[1])) return false;
        if (WaitFor(() => PageInfo(window) is { } now && now.Start != before.Value.Start ? window : null, ct, 8000) is null) return false;
        Thread.Sleep(1200);
        return true;
    }
}
