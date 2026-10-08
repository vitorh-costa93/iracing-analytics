using Microsoft.Win32;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace RacingAgent;
static class Program
{
    [STAThread] static void Main(string[] args)
    {
        using var singleton = new Mutex(true, "Local\\RacingAnalyticsAgent", out var owner); if (!owner) return;
        try
        {
            if (args.Contains("--self-test")) { SelfTest.Run(args); return; }
            var endpoint = "https://iracing-analytics.vercel.app/api/agent/ingest";
            var dev = Array.IndexOf(args, "--dev-url");
            if (dev >= 0) { if (dev + 1 >= args.Length || !Uri.TryCreate(args[dev + 1], UriKind.Absolute, out var u) || !u.IsLoopback || u.Scheme is not ("http" or "https")) throw new ArgumentException("Somente localhost em desenvolvimento"); endpoint = u.AbsoluteUri; }
            var store = new Store(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), dev >= 0 ? "RacingAnalyticsAgent.Dev" : "RacingAnalyticsAgent"), endpoint);
            var tokenFile = Array.IndexOf(args, "--configure-token-file");
            if (tokenFile >= 0)
            {
                if (tokenFile + 1 >= args.Length || new FileInfo(args[tokenFile + 1]).Length > 8192) throw new ArgumentException("Arquivo de token inválido");
                store.Token(File.ReadAllText(args[tokenFile + 1])); return;
            }
            if (args.Contains("--backfill")) { foreach (var file in Sources()) { try { store.Collect(file, true); } catch (IOException) { } } return; }
            ApplicationConfiguration.Initialize(); Application.Run(new AgentForm(store, args.Contains("--tray")));
        }
        catch { MessageBox.Show("Não foi possível iniciar. Verifique o armazenamento local e a configuração do agente.", "Racing Analytics"); }
        finally { singleton.ReleaseMutex(); }
    }
    internal static IEnumerable<string> Sources()
    {
        var folders = new[] { (Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "telemetry"), "*.ibt"), (Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"), "eventresult*.json") };
        foreach (var (path, filter) in folders) if (Directory.Exists(path)) foreach (var file in Directory.EnumerateFiles(path, filter)) yield return file;
    }
}
sealed class AgentForm : Form
{
    readonly Store store; readonly ResultExporter exporter = new(); readonly NotifyIcon tray; readonly System.Windows.Forms.Timer timer = new() { Interval = 15000 }; readonly Label status = new() { AutoSize = true, MaximumSize = new Size(510, 0) }; bool busy, exiting; readonly CancellationTokenSource cancellation = new();
    public AgentForm(Store store, bool startHidden)
    {
        this.store = store; Text = "Racing Analytics — Agente"; ClientSize = new Size(550, 480); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(16), WrapContents = false, AutoScroll = true }; Controls.Add(panel);
        panel.Controls.Add(new Label { Text = "Token pessoal do Racing Analytics (armazenamento DPAPI)", AutoSize = true });
        var token = new TextBox { Width = 505, UseSystemPasswordChar = true }; panel.Controls.Add(token);
        var save = new Button { Text = "Salvar token", AutoSize = true }; save.Click += (_, _) => { try { store.Token(token.Text); token.Clear(); status.Text = "Token salvo"; } catch { status.Text = "Token inválido ou armazenamento indisponível"; } }; panel.Controls.Add(save);
        var limit = new NumericUpDown { Minimum = 1, Maximum = 128, Value = Math.Clamp(store.State.DailyLimit, 1, 128), Width = 80 }; panel.Controls.Add(new Label { Text = "Máximo de requests por dia UTC (padrão 60)", AutoSize = true }); panel.Controls.Add(limit); limit.ValueChanged += (_, _) => { store.State.DailyLimit = (int)limit.Value; store.Save(); };
        using var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        var startup = new CheckBox { Text = "Iniciar com Windows", AutoSize = true, Checked = run?.GetValue("RacingAnalyticsAgent") is not null }; panel.Controls.Add(startup);
        startup.CheckedChanged += (_, _) => { using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"); if (startup.Checked) key.SetValue("RacingAnalyticsAgent", $"\"{Environment.ProcessPath}\" --tray"); else key.DeleteValue("RacingAnalyticsAgent", false); };
        var open = new Button { Text = "Abrir resultados no iRacing", AutoSize = true }; open.Click += (_, _) =>
        {
            var paths = new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "iRacing", "ui", "iRacingUI.exe"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "iRacing", "ui", "iRacingUI.exe") };
            var path = paths.FirstOrDefault(File.Exists);
            if (path is null) { status.Text = "iRacing UI não localizado. Abra o aplicativo e selecione Results."; return; }
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); status.Text = "Abra Results no iRacing UI e exporte o resultado."; } catch { status.Text = "Não foi possível abrir o iRacing UI; abra-o manualmente."; }
        }; panel.Controls.Add(open);
        var experimental = new CheckBox { Text = "Tentar exportação sem foco (experimental)", AutoSize = true, Checked = store.State.ExperimentalExport }; panel.Controls.Add(experimental);
        experimental.CheckedChanged += (_, _) => { store.State.ExperimentalExport = experimental.Checked; store.Save(); };
        panel.Controls.Add(new Label { Text = "Exporte o resultado no iRacing para Downloads. Exportação automática ainda indisponível.", AutoSize = true, MaximumSize = new Size(505, 0) }); panel.Controls.Add(status);
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Racing Analytics", Visible = true }; var menu = new ContextMenuStrip(); menu.Items.Add("Configurar / estado", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); }); menu.Items.Add("Sair", null, (_, _) => { exiting = true; Close(); }); tray.ContextMenuStrip = menu; tray.DoubleClick += (_, _) => { Show(); Activate(); };
        FormClosing += (_, e) => { if (!exiting) { e.Cancel = true; Hide(); } else { cancellation.Cancel(); timer.Stop(); tray.Dispose(); } };
        Shown += (_, _) => { if (startHidden) Hide(); }; timer.Tick += async (_, _) => await Tick(); timer.Start();
    }
    async Task Tick()
    {
        if (busy) return; busy = true;
        try
        {
            await Task.Run(() => { foreach (var file in Program.Sources()) { try { store.Collect(file); } catch (IOException) { } catch (UnauthorizedAccessException) { } } }, cancellation.Token);
            var exportStatus = store.State.ExperimentalExport && store.State.PendingResult ? await exporter.TryExportLatestAsync(cancellation.Token) : "";
            await store.Send(cancellation.Token);
            status.Text = $"{store.Status}\nFila: {store.Backlog} | Sucessos: {store.State.Successes} | Quarentena: {store.Quarantined}\nHoje: {store.State.Requests}/{store.State.DailyLimit} requests, {store.State.Bytes / 1024} KiB/10240\n{exportStatus}";
        }
        catch (OperationCanceledException) { }
        catch { status.Text = "Falha local; fila preservada. Verifique armazenamento/credencial."; }
        finally { busy = false; }
    }
}
static class SelfTest
{
    public static void Run(string[] args)
    {
        var output = args.SkipWhile(a => a != "--self-test").Skip(1).FirstOrDefault() ?? Path.Combine(Path.GetTempPath(), "racing-agent-test.txt");
        var root = Path.Combine(Path.GetTempPath(), "racing-agent-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        var checks = new List<string>();
        try
        {
            var encrypted = Dpapi.Protect(Encoding.UTF8.GetBytes("synthetic-token"), false); if (Encoding.UTF8.GetString(Dpapi.Protect(encrypted, true)) != "synthetic-token") throw new Exception("DPAPI"); checks.Add("DPAPI roundtrip: OK");
            using var a = JsonDocument.Parse("{\"z\":2,\"a\":1}"); using var b = JsonDocument.Parse("{\"a\":1,\"z\":2}"); if (!Store.Canonical(a.RootElement).SequenceEqual(Store.Canonical(b.RootElement))) throw new Exception("canonical"); checks.Add("Canonical object ordering: OK");
            var store = new Store(root, "http://localhost:1/api/agent/ingest");
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { version = 1, kind = "result", key = Ibt.Hash("synthetic"u8), export = new { type = "event_result", data = new { } } }); store.Enqueue(payload); store.Enqueue(payload); if (store.Backlog != 1) throw new Exception("dedupe"); if (new Store(root, store.Endpoint).Backlog != 1) throw new Exception("durability"); checks.Add("Queue dedupe/restart: OK");
            using var bad = new MemoryStream(new byte[144]); try { Ibt.Read(bad).ToArray(); throw new Exception("accepted malformed"); } catch (InvalidDataException) { } checks.Add("Malformed IBT rejected: OK");
            var codes = new[] { 500, 429, 401, 422, 200 };
            foreach (var code in codes)
            {
                var testRoot = Path.Combine(root, code.ToString()); var sending = new Store(testRoot, store.Endpoint, new FixedResponse(code)); sending.Token("synthetic-token"); sending.Enqueue(payload);
                sending.Send(CancellationToken.None).GetAwaiter().GetResult();
                if (code == 401 && !sending.State.AuthPaused || code == 422 && (sending.Quarantined != 1 || sending.Backlog != 0) || code == 200 && (sending.Backlog != 0 || sending.State.Successes != 1) || code == 500 && sending.State.Attempts.Values.Single().Next <= DateTimeOffset.UtcNow || code == 429 && sending.State.Next < DateTimeOffset.UtcNow.AddMinutes(59)) throw new Exception("HTTP state " + code);
            }
            checks.Add("HTTP 200/401/422/429/500 transitions: OK");
            var source = Path.Combine(root, "eventresult-synthetic.json"); File.WriteAllText(source, "{\"type\":\"event_result\",\"data\":{}}"); File.SetLastWriteTimeUtc(source, DateTime.UtcNow.AddDays(-1)); store.Collect(source); if (store.State.Files.Count != 0) throw new Exception("historical auto import"); store.Collect(source, true); if (store.State.Files.Count != 1) throw new Exception("backfill checkpoint"); checks.Add("Activation exclusion/explicit backfill/checkpoint: OK");
            var privateIbt = Array.IndexOf(args, "--ibt"); if (privateIbt >= 0) { using var f = File.OpenRead(args[privateIbt + 1]); var laps = Ibt.Read(f).ToArray(); foreach (var lap in laps) { using var doc = JsonDocument.Parse(lap); if (lap.Length > 512 * 1024) throw new Exception("payload cap"); var compressed = Convert.FromBase64String(doc.RootElement.GetProperty("lap").GetProperty("csvGzipBase64").GetString()!); if (compressed.Length > 128 * 1024) throw new Exception("gzip cap"); } checks.Add($"Private IBT streaming: OK ({laps.Length} complete laps), no private payload saved"); }
            var privateResult = Array.IndexOf(args, "--result"); if (privateResult >= 0)
            {
                var resultStore = new Store(Path.Combine(root, "private-result"), store.Endpoint); resultStore.Collect(args[privateResult + 1], true);
                if (resultStore.Backlog != 1 || resultStore.State.Files.Count != 1) throw new Exception("private result envelope");
                checks.Add("Private event_result envelope/queue: OK, temporary payload deleted after test");
            }
            File.WriteAllLines(output, checks.Append("PASS"));
        }
        catch (Exception e) { File.WriteAllLines(output, checks.Append("FAIL: " + e.GetType().Name + " " + e.Message)); Environment.ExitCode = 1; }
        finally { Directory.Delete(root, true); }
    }
    sealed class FixedResponse(int code) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            if (request.Headers.Authorization?.Scheme != "Bearer") throw new Exception("authorization");
            return Task.FromResult(new HttpResponseMessage((System.Net.HttpStatusCode)code));
        }
    }
}
