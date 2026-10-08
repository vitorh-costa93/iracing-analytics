using Microsoft.Win32;
using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.MemoryMappedFiles;
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
            var dumpUi = Array.IndexOf(args, "--dump-ui");
            if (dumpUi >= 0 && dumpUi + 1 < args.Length) { File.WriteAllText(args[dumpUi + 1], ResultExporter.DumpUi(args.Skip(dumpUi + 2).ToArray())); return; }
            var exportTest = Array.IndexOf(args, "--export-test");
            if (exportTest >= 0)
            {
                // Dev check: N newest results, ignoring server-known ids, isolated state dir, nothing is sent.
                ResultExporter.SkipIdleGate = true;
                ResultExporter.TestCount = Math.Clamp(int.TryParse(args.ElementAtOrDefault(exportTest + 1), out var n) ? n : 11, 1, 20);
                // --send: end-to-end against the real store/token; the server upserts by key (overwrites existing rows).
                var testStore = args.Contains("--send") ? store : new Store(Path.Combine(Path.GetTempPath(), "RacingAnalyticsAgent.ExportTest"), endpoint);
                var result = new ResultExporter().TryExportAsync(testStore).GetAwaiter().GetResult();
                if (args.Contains("--send")) { for (var guard = 0; guard < 30 && testStore.Backlog > 0; guard++) { testStore.Send(CancellationToken.None).GetAwaiter().GetResult(); Thread.Sleep(7000); } result += $" Após envio, fila: {testStore.Backlog}; status: {testStore.Status}."; }
                var report = $"{result}\nIds: {string.Join(", ", ResultExporter.TestIds)}\nFila de teste: {testStore.Backlog}\n";
                var outPath = args.ElementAtOrDefault(exportTest + 2);
                if (outPath is not null && !outPath.StartsWith("--")) File.WriteAllText(outPath, report); else Console.WriteLine(report);
                return;
            }
            var once = Array.IndexOf(args, "--export-once");
            if (once >= 0)
            {
                // Dev check of the idle exporter: skips only the 60 s idle gate; every other guard-rail applies.
                ResultExporter.SkipIdleGate = true;
                var line = new ResultExporter().TryExportAsync(store).GetAwaiter().GetResult();
                if (once + 1 < args.Length) File.WriteAllText(args[once + 1], $"{line}\nFila: {store.Backlog}\nDownloads hoje: {store.State.Exports}\n"); return;
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
    readonly Store store; readonly ResultExporter exporter = new(); readonly SimMonitor monitor; readonly System.Windows.Forms.Timer simTimer = new() { Interval = 2000 }; readonly NotifyIcon tray; readonly System.Windows.Forms.Timer timer = new() { Interval = 15000 }; readonly Label status = new() { AutoSize = true, MaximumSize = new Size(510, 0) }; bool busy, exiting; readonly CancellationTokenSource cancellation = new();
    public AgentForm(Store store, bool startHidden)
    {
        this.store = store;
        monitor = new SimMonitor(() => store.State.AutoRecord, snapshot => { try { store.EnqueueResult(snapshot); } catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException) { } });
        Text = "Racing Analytics — Agente"; ClientSize = new Size(550, 480); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(16), WrapContents = false, AutoScroll = true }; Controls.Add(panel);
        panel.Controls.Add(new Label { Text = "Token pessoal do Racing Analytics (armazenamento DPAPI)", AutoSize = true });
        var token = new TextBox { Width = 505, UseSystemPasswordChar = true }; panel.Controls.Add(token);
        var save = new Button { Text = "Salvar token", AutoSize = true }; save.Click += (_, _) => { try { store.Token(token.Text); token.Clear(); status.Text = "Token salvo"; } catch { status.Text = "Token inválido ou armazenamento indisponível"; } }; panel.Controls.Add(save);
        var limit = new NumericUpDown { Minimum = 1, Maximum = 128, Value = Math.Clamp(store.State.DailyLimit, 1, 128), Width = 80 }; panel.Controls.Add(new Label { Text = "Máximo de requests por dia UTC (padrão 60)", AutoSize = true }); panel.Controls.Add(limit); limit.ValueChanged += (_, _) => { store.State.DailyLimit = (int)limit.Value; store.Save(); };
        if (!store.State.StartupInit) { store.State.StartupInit = true; store.Save(); using var first = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"); first.SetValue("RacingAnalyticsAgent", $"\"{Environment.ProcessPath}\" --tray"); }
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
        var record = new CheckBox { Text = "Ligar gravação .ibt automaticamente ao entrar na pista (SDK oficial)", AutoSize = true, Checked = store.State.AutoRecord }; panel.Controls.Add(record);
        record.CheckedChanged += (_, _) => { store.State.AutoRecord = record.Checked; store.Save(); };
        var experimental = new CheckBox { Text = "Exportar resultados oficiais em momento ocioso (sem foco, só corridas novas)", AutoSize = true, Checked = store.State.ExperimentalExport }; panel.Controls.Add(experimental);
        experimental.CheckedChanged += (_, _) => { store.State.ExperimentalExport = experimental.Checked; store.Save(); };
        panel.Controls.Add(new Label { Text = "O resultado da corrida é lido do SessionInfo ao vivo (iRating estimado). O JSON exportado do iRacing para Downloads continua sendo a fonte oficial e substitui a estimativa.", AutoSize = true, MaximumSize = new Size(505, 0) }); panel.Controls.Add(status);
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Racing Analytics", Visible = true }; var menu = new ContextMenuStrip(); menu.Items.Add("Configurar / estado", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); }); menu.Items.Add("Sair", null, (_, _) => { exiting = true; Close(); }); tray.ContextMenuStrip = menu; tray.DoubleClick += (_, _) => { Show(); Activate(); };
        FormClosing += (_, e) => { if (!exiting) { e.Cancel = true; Hide(); } else { cancellation.Cancel(); timer.Stop(); simTimer.Stop(); monitor.Dispose(); tray.Dispose(); } };
        Shown += (_, _) => { if (startHidden) Hide(); }; timer.Tick += async (_, _) => await Tick(); timer.Start(); simTimer.Tick += (_, _) => monitor.Poll(); simTimer.Start();
    }
    async Task Tick()
    {
        if (busy) return; busy = true;
        try
        {
            await Task.Run(() => { foreach (var file in Program.Sources()) { try { store.Collect(file); } catch (IOException) { } catch (UnauthorizedAccessException) { } } }, cancellation.Token);
            var exportStatus = store.State.ExperimentalExport && exporter.Due(store) ? await exporter.TryExportAsync(store, cancellation.Token) : "";
            await store.Send(cancellation.Token);
            status.Text = $"{store.Status}\niRacing: {monitor.Status}\nFila: {store.Backlog} | Sucessos: {store.State.Successes} | Quarentena: {store.Quarantined}\nHoje: {store.State.Requests}/{store.State.DailyLimit} requests, {store.State.Bytes / 1024} KiB/10240\n{exportStatus}";
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
            var official = Encoding.UTF8.GetBytes("{\"type\":\"event_result\",\"data\":{\"subsession_id\":777}}"); var officialStore = new Store(Path.Combine(root, "official"), store.Endpoint);
            if (officialStore.EnqueueOfficial(official, new HashSet<long> { 777 }) != 777 || officialStore.Backlog != 0) throw new Exception("official known skipped"); if (officialStore.EnqueueOfficial(official, new HashSet<long>()) != 777 || officialStore.EnqueueOfficial(official, new HashSet<long>()) != 777 || officialStore.Backlog != 1) throw new Exception("official dedupe"); checks.Add("Official export known-skip/dedupe: OK");
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
            SessionChecks(root, checks);
            var scan = Array.IndexOf(args, "--scan-ibt"); if (scan >= 0) checks.Add(ScanIbt(scan + 1 < args.Length && !args[scan + 1].StartsWith("--") ? args[scan + 1] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "telemetry")));
            File.WriteAllLines(output, checks.Append("PASS"));
        }
        catch (Exception e) { File.WriteAllLines(output, checks.Append("FAIL: " + e.GetType().Name + " " + e.Message)); Environment.ExitCode = 1; }
        finally { Directory.Delete(root, true); }
    }
    // Synthetic SessionInfo: 3 human cars (car 1 = driver, class 10), pace car, a non-starter;
    // ResultsPositions.Position 1-based / ClassPosition 0-based as in real files.
    internal static string Yaml(int official = 1, int resultsOfficial = 1, string category = "SportsCar", bool classified = true) => $"""
        ---
        WeekendInfo:
         TrackName: synthetic gp
         TrackID: 8
         TrackDisplayName: Synthetic Ring
         TrackConfigName: Grand Prix
         SeriesID: 447
         SeasonID: 5900
         SubSessionID: 777
         Official: {official}
         RaceWeek: 3
         EventType: Race
         Category: {category}
         TeamRacing: 0
         WeekendOptions:
          NumStarters: 0

        SessionInfo:
         Sessions:
         - SessionNum: 0
           SessionType: Practice
           ResultsPositions:
           - Position: 1
             ClassPosition: 0
             CarIdx: 1
         - SessionNum: 2
           SessionType: Race
           ResultsPositions:
        {(classified ? """
           - Position: 1
             ClassPosition: 0
             CarIdx: 0
             LapsComplete: 20
             FastestTime: 89.5000
             LapsLed: 20
             Incidents: 0
           - Position: 2
             ClassPosition: 1
             CarIdx: 1
             LapsComplete: 20
             FastestTime: 89.9000
             LapsLed: 0
             Incidents: 4
        """ : "")}
           - Position: 3
             ClassPosition: 0
             CarIdx: 2
             LapsComplete: 19
             FastestTime: 95.2000
             LapsLed: 0
             Incidents: 2
           ResultsOfficial: {resultsOfficial}

        QualifyResultsInfo:
         Results:
         - Position: 4
           ClassPosition: 4
           CarIdx: 1

        DriverInfo:
         DriverCarIdx: 1
         DriverUserID: 42
         Drivers:
         - CarIdx: 0
           UserName: Synthetic Rival
           UserID: 43
           CarID: 196
           CarClassID: 10
           CarScreenName: Synthetic P
           CarIsPaceCar: 0
           CarIsAI: 0
           IsSpectator: 0
           IRating: 2000
         - CarIdx: 1
           UserName: Synthetic Driver
           UserID: 42
           CarID: 196
           CarClassID: 10
           CarScreenName: Synthetic P
           CarIsPaceCar: 0
           CarIsAI: 0
           IsSpectator: 0
           IRating: 2000
           LicLevel: 18
           LicSubLevel: 281
         - CarIdx: 2
           UserName: Synthetic Other
           UserID: 44
           CarID: 100
           CarClassID: 20
           CarScreenName: Synthetic GT
           CarIsPaceCar: 0
           CarIsAI: 0
           IsSpectator: 0
           IRating: 1500
         - CarIdx: 3
           UserName: Synthetic Late
           UserID: 45
           CarID: 196
           CarClassID: 10
           CarScreenName: Synthetic P
           CarIsPaceCar: 0
           CarIsAI: 0
           IsSpectator: 0
           IRating: 2100
         - CarIdx: 9
           UserName: Pace Car
           UserID: -1
           CarIsPaceCar: 1
        CarSetup:
         UpdateCount: 1
         Secret: do-not-send
        ...
        """;

    static void SessionChecks(string root, List<string> checks)
    {
        var at = new DateTimeOffset(2026, 10, 7, 21, 40, 0, TimeSpan.Zero);
        var snap = SessionResult.Build(Yaml(), at, "live", out _) ?? throw new Exception("session result");
        var text = Encoding.UTF8.GetString(snap.Payload);
        using (var doc = JsonDocument.Parse(snap.Payload))
        {
            var r = doc.RootElement.GetProperty("result"); var e = r.GetProperty("entrants");
            if (doc.RootElement.GetProperty("kind").GetString() != "ibt_result" || snap.SubsessionId != 777 || !snap.ResultsOfficial || r.GetProperty("customerId").GetInt32() != 42 || r.GetProperty("racedAt").GetString() != "2026-10-07T21:40:00Z" || r.GetProperty("raceWeek").GetInt32() != 3) throw new Exception("result fields");
            if (e.GetArrayLength() != 4 || e[3].GetProperty("started").GetBoolean() || e[1].GetProperty("position").GetInt32() != 2 || e[1].GetProperty("classPosition").GetInt32() != 1 || r.GetProperty("driver").GetProperty("gridPosition").GetInt32() != 5) throw new Exception("result grid");
            if (doc.RootElement.GetProperty("key").GetString() != Ibt.Hash(Encoding.UTF8.GetBytes("ibt_result:777:42"))) throw new Exception("result key");
        }
        if (text.Contains("Synthetic Driver") || text.Contains("Synthetic Rival") || text.Contains("do-not-send") || text.Contains("UserName") || snap.Payload.Length > SessionResult.MaxPayload) throw new Exception("result privacy");
        checks.Add("SessionInfo result extraction (positions, class, grid, no names/setup): OK");
        var provisional = SessionResult.Build(Yaml(resultsOfficial: 0), at, "live", out _);
        if (provisional is null || provisional.ResultsOfficial || SessionResult.Build(Yaml(official: 0), at, "live", out _) is not null || SessionResult.Build(Yaml(category: "Oval"), at, "live", out _) is not null || SessionResult.Build(Yaml(classified: false), at, "live", out _) is not null) throw new Exception("result gating");
        checks.Add("Result gating (official event, category, driver classified): OK");

        static byte[] SyntheticIbt(string yaml)
        {
            var y = Encoding.Latin1.GetBytes(yaml); const int varAt = 144, bufAt = varAt + 2 * 144, size = 16, records = 4;
            var yamlAt = bufAt + size * records; var bytes = new byte[yamlAt + y.Length];
            void I(int at, int v) => BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(at), v);
            I(0, 2); I(8, 60); I(16, y.Length); I(20, yamlAt); I(24, 2); I(28, varAt); I(32, 1); I(36, size); I(52, bufAt); I(140, records);
            BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(112), new DateTimeOffset(2026, 10, 7, 21, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds());
            void Var(int n, int type, int offset, string name) { I(varAt + n * 144, type); I(varAt + n * 144 + 4, offset); I(varAt + n * 144 + 8, 1); Encoding.ASCII.GetBytes(name).CopyTo(bytes, varAt + n * 144 + 16); }
            Var(0, 2, 0, "SessionNum"); Var(1, 5, 8, "SessionTime");
            for (var r = 0; r < records; r++) { I(bufAt + r * size, r < 2 ? 0 : 2); BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(bufAt + r * size + 8), BitConverter.DoubleToInt64Bits(r < 2 ? 500 + r / 60.0 : 10 + (r - 2) / 60.0)); }
            y.CopyTo(bytes, yamlAt); return bytes;
        }
        using (var ibt = new MemoryStream(SyntheticIbt(Yaml())))
        {
            var fromIbt = SessionResult.FromIbt(ibt, out var why) ?? throw new Exception("ibt result " + why);
            using var doc = JsonDocument.Parse(fromIbt.Payload);
            // record 2 at 2/60 s after the disk start, Race SessionTime 10 s => start 21:00:00 - 9.97 s.
            if (doc.RootElement.GetProperty("result").GetProperty("racedAt").GetString() != "2026-10-07T20:59:50Z" || doc.RootElement.GetProperty("result").GetProperty("origin").GetString() != "ibt") throw new Exception("ibt raced_at");
        }
        using (var stale = new MemoryStream(SyntheticIbt(Yaml(resultsOfficial: 0)))) if (SessionResult.FromIbt(stale, out _) is not null) throw new Exception("ibt stale snapshot accepted");
        checks.Add("Synthetic IBT result (official only, race start from records): OK");

        if (SimMonitor.TelemStartWParam != 0x0001000A) throw new Exception("broadcast wParam");
        var name = "Local\\RacingAgentSelfTest-" + Guid.NewGuid().ToString("N");
        using var mmf = MemoryMappedFile.CreateNew(name, 1 << 20); using var view = mmf.CreateViewAccessor();
        var vars = new[] { ("IsOnTrack", 1, 0), ("IsDiskLoggingEnabled", 1, 1), ("IsDiskLoggingActive", 1, 2), ("IsReplayPlaying", 1, 3), ("SessionNum", 2, 4), ("SessionState", 2, 8), ("SessionTime", 5, 16) };
        const int bufOffset = 4096, yamlOffset = 8192;
        view.Write(0, 2); view.Write(4, 1); view.Write(8, 60); view.Write(24, vars.Length); view.Write(28, 144); view.Write(32, 1); view.Write(36, 64); view.Write(48, 1); view.Write(52, bufOffset);
        for (var n = 0; n < vars.Length; n++) { view.Write(144 + n * 144, vars[n].Item2); view.Write(144 + n * 144 + 4, vars[n].Item3); view.Write(144 + n * 144 + 8, 1); var bytes = Encoding.ASCII.GetBytes(vars[n].Item1); view.WriteArray(144 + n * 144 + 16, bytes, 0, bytes.Length); }
        var update = 0;
        void Info(string yaml) { var b = Encoding.Latin1.GetBytes(yaml); view.WriteArray(yamlOffset, b, 0, b.Length); view.Write(yamlOffset + b.Length, (byte)0); view.Write(16, b.Length); view.Write(20, yamlOffset); view.Write(12, ++update); }
        void Row(bool onTrack, bool active, int session, int state, double time) { view.Write(bufOffset, (byte)(onTrack ? 1 : 0)); view.Write(bufOffset + 1, (byte)1); view.Write(bufOffset + 2, (byte)(active ? 1 : 0)); view.Write(bufOffset + 3, (byte)0); view.Write(bufOffset + 4, session); view.Write(bufOffset + 8, state); view.Write(bufOffset + 16, time); view.Write(48, view.ReadInt32(48) + 1); }
        var sent = new List<nint>(); var results = new List<SessionResult.Snapshot>(); var now = at; var auto = true;
        using (var monitor = new SimMonitor(() => auto, results.Add, name, sent.Add, () => now))
        {
            Info(Yaml(resultsOfficial: 0)); Row(true, false, 0, 4, 100); monitor.Poll(); monitor.Poll();
            if (sent.Count != 1 || sent[0] != SimMonitor.TelemStartWParam) throw new Exception("auto record request");
            now = now.AddSeconds(31); Row(true, true, 0, 4, 130); monitor.Poll(); auto = false; Row(true, false, 0, 4, 140); monitor.Poll();
            if (sent.Count != 1) throw new Exception("auto record repeat/opt-out");
            Row(true, true, 2, 4, 600); monitor.Poll(); if (results.Count != 0) throw new Exception("result before checkered");
            Row(true, true, 2, 5, 1800); Info(Yaml(resultsOfficial: 0)); monitor.Poll(); if (results.Count != 0) throw new Exception("provisional sent early");
            Info(Yaml()); monitor.Poll(); monitor.Poll();
            if (results.Count != 1 || !results[0].ResultsOfficial) throw new Exception("official live result");
            using var doc = JsonDocument.Parse(results[0].Payload);
            if (doc.RootElement.GetProperty("result").GetProperty("racedAt").GetString() != at.AddSeconds(31 - 600).ToString("yyyy-MM-ddTHH:mm:ssZ")) throw new Exception("live raced_at");
        }
        results.Clear(); now = at;
        using (var monitor = new SimMonitor(() => true, results.Add, name, sent.Add, () => now))
        {
            Row(true, true, 2, 5, 1800); Info(Yaml(resultsOfficial: 0)); monitor.Poll(); monitor.Poll();
            if (results.Count != 0) throw new Exception("provisional before leaving");
            view.Write(4, 0); monitor.Poll();
            if (results.Count != 1 || results[0].ResultsOfficial) throw new Exception("provisional on disconnect");
        }
        checks.Add("SDK shared memory: auto-record broadcast (TelemCommand=10/Start=1, opt-out), live official/provisional capture: OK");
        var store = new Store(Path.Combine(root, "results"), "http://localhost:1/api/agent/ingest");
        store.EnqueueResult(snap); store.EnqueueResult(SessionResult.Build(Yaml(resultsOfficial: 0), at, "ibt", out _)!);
        if (store.Backlog != 1 || !store.State.ResultSubsessions.Contains(777) || new Store(store.Root, store.Endpoint).State.ResultSubsessions.Count != 1) throw new Exception("result dedupe");
        checks.Add("One result per subsession (durable): OK");
    }

    // Read-only diagnostic over local .ibt files: counts only, nothing queued or sent.
    static string ScanIbt(string folder)
    {
        var reasons = new Dictionary<string, int>(); var files = 0;
        foreach (var file in Directory.Exists(folder) ? Directory.EnumerateFiles(folder, "*.ibt") : [])
        {
            files++; string reason;
            try { using var f = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); reason = SessionResult.FromIbt(f, out var why) is null ? why : "resultado extraído"; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or EndOfStreamException) { reason = "arquivo em uso/ilegível"; }
            reasons[reason] = reasons.GetValueOrDefault(reason) + 1;
        }
        return $"IBT scan (read-only): {files} files; " + string.Join("; ", reasons.Select(kv => $"{kv.Key}: {kv.Value}"));
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
