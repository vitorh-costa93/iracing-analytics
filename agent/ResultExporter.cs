using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace RacingAgent;

/// <summary>
/// Conservative, opt-in export of an already open result in the installed iRacing UI.
/// Requires renderer accessibility to expose a named JSON export InvokePattern.
/// Never launches/activates a window, injects input, opens an unnamed menu, reads a
/// browser profile or falls back to private endpoints. It cannot select the latest
/// race reliably from unnamed result controls; the user must open that result.
/// </summary>
internal sealed class ResultExporter
{
    readonly object gate = new();
    Stopwatch? sinceAttempt;
    bool running;

    internal async Task<string> TryExportLatestAsync(CancellationToken cancellation = default, bool allowInvoke = true)
    {
        lock (gate)
        {
            if (running) return "Exportação: verificação em andamento.";
            if (sinceAttempt is not null && sinceAttempt.Elapsed < TimeSpan.FromMinutes(10)) return "Exportação: aguardando intervalo de dez minutos.";
            if (!SafeToOperate()) return "Exportação pausada: simulador aberto ou usuário ativo (mínimo 60 s).";
            sinceAttempt = Stopwatch.StartNew();
            running = true;
        }
        // UIA must run away from the application's UI thread. If a provider stalls,
        // the caller is released; cancellation is rechecked before every invocation.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var work = Task.Run(() =>
        {
            try { return Export(timeout.Token, allowInvoke); }
            catch (OperationCanceledException) { return "Exportação: verificação cancelada."; }
            catch { return "Exportação indisponível: provedor de acessibilidade não respondeu."; }
            finally { lock (gate) running = false; }
        }, CancellationToken.None);
        try { return await work.WaitAsync(timeout.Token); }
        catch (OperationCanceledException) { return "Exportação: verificação cancelada ou tempo excedido."; }
    }

    // Read-only diagnostic for local validation. Returns counts/status only: no
    // driver names, session IDs, raw accessibility tree or downloaded payload.
    internal static string InspectExistingUi()
    {
        try
        {
            var window = ExistingWindow();
            if (window is null) return "UI ausente ou janela ambígua.";
            var modal = ResultModal(window);
            if (modal is null) return "UI acessível; resultado não aberto ou renderer sem acessibilidade.";
            var exports = JsonExports(modal);
            return $"Resultado acessível; controles JSON semânticos: {exports.Count}.";
        }
        catch { return "Provedor UIA indisponível."; }
    }

    static string Export(CancellationToken cancellation, bool allowInvoke)
    {
        cancellation.ThrowIfCancellationRequested();
        var window = ExistingWindow();
        if (window is null) return "Exportação: abra o aplicativo iRacing (uma janela).";
        var modal = ResultModal(window);
        if (modal is null) return "Exportação: abra o resultado mais recente; acessibilidade do renderer é necessária.";
        var candidates = JsonExports(modal);
        if (candidates.Count != 1)
            return "Exportação automática indisponível: controle JSON não identificado. Exporte manualmente para Downloads.";
        if (!allowInvoke) return "Exportação: controle JSON identificado; diagnóstico sem ação.";
        var button = candidates[0];
        if (!button.Current.IsEnabled || !button.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern))
            return "Exportação indisponível: controle JSON não permite InvokePattern.";
        cancellation.ThrowIfCancellationRequested();
        if (!SafeToOperate()) return "Exportação pausada: simulador aberto ou usuário ativo.";
        // InvokePattern is semantic; never SetFocus, SetForegroundWindow, SendInput,
        // coordinates or keyboard shortcuts. An unidentified Save dialog is left
        // for the user. A request is not proof that a file was exported/ingested.
        ((InvokePattern)pattern).Invoke();
        return "Exportação JSON solicitada; aguardando arquivo em Downloads. Pode exigir confirmação no iRacing.";
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

    static List<AutomationElement> JsonExports(AutomationElement modal)
    {
        // Exact English/Portuguese labels only. Share Results, an unnamed button,
        // generic Export and CSV exports are intentionally not sufficient evidence.
        var labels = new[] { "Export JSON", "Export Results JSON", "Export Results as JSON", "Download JSON", "Download Results JSON", "Exportar JSON", "Exportar resultados em JSON" };
        var condition = new AndCondition(
            new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink)),
            new OrCondition(labels.Select(label => (Condition)new PropertyCondition(AutomationElement.NameProperty, label, PropertyConditionFlags.IgnoreCase)).ToArray()));
        return modal.FindAll(TreeScope.Descendants, condition).Cast<AutomationElement>().ToList();
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
        return GetLastInputInfo(ref input) && unchecked((uint)Environment.TickCount - input.Time) >= 60000;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LastInputInfo { internal uint Size; internal uint Time; }
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetLastInputInfo(ref LastInputInfo input);
}
