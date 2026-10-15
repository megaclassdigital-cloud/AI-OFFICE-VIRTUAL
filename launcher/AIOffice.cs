// AIOffice.exe — aplikasi tray untuk AI Office (tanpa terminal). Dibangun dengan csc bawaan Windows (tanpa dependensi).
// Tugasnya: menyalakan pengawas (scripts/office-launcher.mjs) tersembunyi, menampilkan status koneksi di ikon tray, membuka UI, menjeda/melanjutkan,
// memulai ulang komponen, dan mematikan semuanya dengan aman. Seluruh logika koneksi ada di pengawas Node; aplikasi ini hanya cangkang.
//
// Build:  launcher\build.ps1   (hasil: AIOffice.exe di akar repo)
using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("AI Office")]
[assembly: AssemblyDescription("AI Office: menyalakan dan menjaga Paperclip, agent, dan Office View dari satu aplikasi")]
[assembly: AssemblyCompany("Mega Class Digital")]
[assembly: AssemblyProduct("AI Office")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace AIOffice
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            if (Array.IndexOf(args, "--make-shortcuts") >= 0) { var r = TrayApp.ResolveRootStatic(); TrayApp.MakeShortcut(TrayApp.StartMenuPath(), r); TrayApp.MakeShortcut(TrayApp.DesktopPath(), r); return; }
            bool created;
            using (var mutex = new Mutex(true, "AIOffice.SingleInstance", out created))
            {
                if (!created)
                {
                    // Sudah berjalan: cukup minta pengawas membuka UI.
                    MessageBox.Show("AI Office sudah berjalan (lihat ikon di area notifikasi).", "AI Office", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApp(args));
            }
        }
    }

    class TrayApp : ApplicationContext
    {
        [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint esFlags);
        const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x00000001;
        bool keepAwake = true;
        ToolStripMenuItem awakeItem;
        static string KeepAwakeFile() { return Path.Combine(DataDir(), "keepawake.txt"); }
        // Cegah Windows masuk tidur otomatis (idle) selama AI Office berjalan; layar tetap boleh mati. Tidak menahan tidur karena tutup layar/tombol power.
        void ApplyKeepAwake()
        {
            try { SetThreadExecutionState(keepAwake ? (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) : ES_CONTINUOUS); } catch { }
        }
        void ToggleKeepAwake()
        {
            keepAwake = !keepAwake;
            try { File.WriteAllText(KeepAwakeFile(), keepAwake ? "on" : "off"); } catch { }
            awakeItem.Checked = keepAwake;
            ApplyKeepAwake();
            tray.ShowBalloonTip(3000, "AI Office", keepAwake ? "Laptop tidak akan tidur otomatis selama AI Office berjalan (layar boleh mati)." : "Laptop boleh tidur otomatis; pekerjaan akan berhenti saat tidur dan dilanjutkan setelah bangun.", ToolTipIcon.Info);
        }

        readonly string root;
        readonly string nodeExe;
        readonly NotifyIcon tray;
        readonly System.Windows.Forms.Timer timer;
        readonly ToolStripMenuItem statusItem, pauseItem, autoItem;
        Process supervisor;
        string lastOverall = "";
        DateTime lastMemWarn = DateTime.MinValue;
        readonly DateTime started = DateTime.Now;
        bool paused;
        string ui = "http://127.0.0.1:3190";

        public TrayApp(string[] args)
        {
            root = ResolveRoot();
            nodeExe = FindNode();
            if (nodeExe == null)
            {
                MessageBox.Show("Node.js tidak ditemukan. Pasang Node.js 24 dari nodejs.org lalu jalankan lagi.", "AI Office", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(2);
            }

            var menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("Memulai…") { Enabled = false };
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Buka AI Office", null, (s, e) => OpenUi());
            pauseItem = new ToolStripMenuItem("Jeda pekerjaan", null, (s, e) => TogglePause());
            menu.Items.Add(pauseItem);
            menu.Items.Add("Mulai ulang Paperclip", null, (s, e) => SendCommand("restart", "paperclip"));
            menu.Items.Add("Mulai ulang Office View", null, (s, e) => SendCommand("restart", "office-view"));
            menu.Items.Add("Mulai ulang Orkestrator", null, (s, e) => SendCommand("restart", "orchestrator"));
            menu.Items.Add(new ToolStripSeparator());
            try { keepAwake = !File.Exists(KeepAwakeFile()) || File.ReadAllText(KeepAwakeFile()).Trim() != "off"; } catch { }
            awakeItem = new ToolStripMenuItem("Cegah laptop tidur otomatis saat AI Office berjalan", null, (s, e) => ToggleKeepAwake());
            awakeItem.Checked = keepAwake;
            menu.Items.Add(awakeItem);
            menu.Items.Add("Pengaturan daya Windows (tutup layar, tidur)…", null, (s, e) => { try { Process.Start(new ProcessStartInfo("control.exe", "powercfg.cpl") { UseShellExecute = true }); } catch { } });
            autoItem = new ToolStripMenuItem("Mulai otomatis bersama Windows", null, (s, e) => ToggleAutostart());
            autoItem.Checked = File.Exists(StartupLnk());
            menu.Items.Add(autoItem);
            menu.Items.Add("Buat pintasan di Desktop", null, (s, e) => { MakeShortcut(DesktopLnk(), root); tray.ShowBalloonTip(2000, "AI Office", "Pintasan dibuat di Desktop.", ToolTipIcon.Info); });
            menu.Items.Add("Buka folder log", null, (s, e) => { try { Process.Start("explorer.exe", Path.Combine(root, "reports")); } catch { } });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Matikan semua dengan aman (jeda dulu, tunggu agent selesai)", null, (s, e) => SafeShutdown());
            menu.Items.Add("Keluar sekarang (komponen dihentikan)", null, (s, e) => ExitNow());

            tray = new NotifyIcon { Icon = MakeIcon(Color.Gray), Visible = true, Text = "AI Office: memulai", ContextMenuStrip = menu };
            tray.DoubleClick += (s, e) => OpenUi();

            FirstRunSetup();
            ApplyKeepAwake();
            StartSupervisor(args);
            timer = new System.Windows.Forms.Timer { Interval = 3000 };
            timer.Tick += (s, e) => { ApplyKeepAwake(); Refresh(); };
            timer.Start();
        }

        static string DataDir()
        {
            var d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AIOffice");
            Directory.CreateDirectory(d);
            return d;
        }

        static bool IsRoot(string p) { return !string.IsNullOrEmpty(p) && File.Exists(Path.Combine(p, "scripts", "office-launcher.mjs")); }

        static string ResolveRoot()
        {
            var here = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (IsRoot(here)) { try { File.WriteAllText(Path.Combine(DataDir(), "root.txt"), here); } catch { } return here; }
            try { var saved = File.ReadAllText(Path.Combine(DataDir(), "root.txt")).Trim(); if (IsRoot(saved)) return saved; } catch { }
            using (var dlg = new FolderBrowserDialog { Description = "Pilih folder AI-Agent-Office (yang berisi folder scripts)" })
            {
                if (dlg.ShowDialog() == DialogResult.OK && IsRoot(dlg.SelectedPath))
                {
                    File.WriteAllText(Path.Combine(DataDir(), "root.txt"), dlg.SelectedPath);
                    return dlg.SelectedPath;
                }
            }
            MessageBox.Show("Folder AI Office tidak ditemukan.", "AI Office", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.Exit(3);
            return null;
        }

        static string FindNode()
        {
            foreach (var p in new[] { @"C:\Program Files\nodejs\node.exe", @"C:\Program Files (x86)\nodejs\node.exe" })
                if (File.Exists(p)) return p;
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try { var p = Path.Combine(dir.Trim(), "node.exe"); if (File.Exists(p)) return p; } catch { }
            }
            return null;
        }

        void StartSupervisor(string[] args)
        {
            var extra = args.Length > 0 ? " " + string.Join(" ", args) : "";
            var psi = new ProcessStartInfo(nodeExe, "scripts/office-launcher.mjs --no-open" + extra)
            {
                WorkingDirectory = root, CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden
            };
            try { supervisor = Process.Start(psi); }
            catch (Exception ex) { MessageBox.Show("Gagal menyalakan pengawas: " + ex.Message, "AI Office", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }

        static string DesktopLnk() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "AI Office.lnk"); }
        static string StartupLnk() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "AI Office.lnk"); }
        static string StartMenuLnk() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "AI Office.lnk"); }

        internal static string ResolveRootStatic() { return ResolveRoot(); }
        internal static string DesktopPath() { return DesktopLnk(); }
        internal static string StartMenuPath() { return StartMenuLnk(); }

        internal static void MakeShortcut(string lnk, string root)
        {
            try
            {
                var exe = Application.ExecutablePath;
                var ps = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + lnk.Replace("'", "''") + "');$s.TargetPath='" + exe.Replace("'", "''") + "';$s.WorkingDirectory='" + root.Replace("'", "''") + "';$s.IconLocation='" + exe.Replace("'", "''") + ",0';$s.Description='AI Office';$s.Save()";
                var p = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -WindowStyle Hidden -Command \"" + ps.Replace("\"", "\\\"") + "\"") { CreateNoWindow = true, UseShellExecute = false });
                p.WaitForExit(8000);
            }
            catch { }
        }

        void ToggleAutostart()
        {
            if (File.Exists(StartupLnk())) { try { File.Delete(StartupLnk()); } catch { } }
            else MakeShortcut(StartupLnk(), root);
            autoItem.Checked = File.Exists(StartupLnk());
        }

        void FirstRunSetup()
        {
            var marker = Path.Combine(DataDir(), "setup.done");
            if (File.Exists(marker)) return;
            MakeShortcut(StartMenuLnk(), root);
            if (MessageBox.Show("Pasang AI Office seperti aplikasi biasa?\n\n- Pintasan di Desktop dan Start Menu\n- Mulai otomatis saat Windows menyala (bisa diubah di menu ikon)\n\nSelama komputer mati, pekerjaan agent berhenti; Paperclip butuh beberapa menit untuk siap setelah dinyalakan.", "AI Office — pengaturan awal", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                MakeShortcut(DesktopLnk(), root);
                MakeShortcut(StartupLnk(), root);
                autoItem.Checked = File.Exists(StartupLnk());
            }
            try { File.WriteAllText(marker, DateTime.Now.ToString("o")); } catch { }
        }

        void RunNode(string args)
        {
            try
            {
                Process.Start(new ProcessStartInfo(nodeExe, args) { WorkingDirectory = root, CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch { }
        }

        void SendCommand(string cmd, string key)
        {
            RunNode("scripts/office-launcher.mjs --command " + cmd + (key != null ? " " + key : ""));
            tray.ShowBalloonTip(2000, "AI Office", "Perintah dikirim: " + cmd + (key != null ? " " + key : ""), ToolTipIcon.Info);
        }

        void OpenUi()
        {
            foreach (var edge in new[] { @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", @"C:\Program Files\Microsoft\Edge\Application\msedge.exe" })
            {
                if (!File.Exists(edge)) continue;
                try { Process.Start(new ProcessStartInfo(edge, "--app=" + ui) { UseShellExecute = false }); return; } catch { }
            }
            try { Process.Start(new ProcessStartInfo(ui) { UseShellExecute = true }); } catch { }
        }

        void TogglePause()
        {
            RunNode("scripts/pause.mjs " + (paused ? "off" : "on"));
            tray.ShowBalloonTip(2500, "AI Office", paused ? "Pekerjaan dilanjutkan." : "Pekerjaan dijeda: tidak ada pekerjaan baru; agent yang berjalan menyelesaikan run-nya.", ToolTipIcon.Info);
        }

        void SafeShutdown()
        {
            if (MessageBox.Show("Matikan semua dengan aman?\n\nPekerjaan dijeda, agent yang sedang bekerja diselesaikan dulu (maksimal 20 menit), lalu seluruh komponen dan Paperclip dihentikan.", "AI Office", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            SendCommand("shutdown", null);
            tray.ShowBalloonTip(4000, "AI Office", "Mematikan dengan aman… ikon ini hilang sendiri setelah selesai.", ToolTipIcon.Info);
        }

        void ExitNow()
        {
            if (MessageBox.Show("Keluar sekarang?\n\nKomponen dihentikan; agent yang sedang bekerja bisa terputus (Paperclip mencoba ulang saat dinyalakan lagi). Untuk keluar tanpa risiko pakai \"Matikan semua dengan aman\".", "AI Office", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
            SendCommand("stop-now", null);
            Thread.Sleep(1500);
            Quit();
        }

        void Quit()
        {
            try { SetThreadExecutionState(ES_CONTINUOUS); } catch { }
            timer.Stop();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
            Application.Exit();
        }

        void Refresh()
        {
            try
            {
                var file = Path.Combine(root, "workspace", "launcher-status.json");
                // Status basi (pengawas belum menulis ulang sejak dinyalakan): jangan percaya, apalagi menutup diri karena "mati" sisa sesi lalu.
                // "Fresh" = ditulis SETELAH exe ini dinyalakan dan masih baru; status dari sesi sebelumnya (mis. "mati" setelah shutdown) tidak dihitung.
                bool fresh = File.Exists(file) && File.GetLastWriteTime(file) >= started && (DateTime.Now - File.GetLastWriteTime(file)).TotalSeconds < 25;
                if (!fresh)
                {
                    bool supervisorGone = supervisor == null || supervisor.HasExited;
                    if (supervisorGone && (DateTime.Now - started).TotalSeconds > 30) { Quit(); return; }
                    tray.Text = "AI Office: memulai…";
                    return;
                }
                var json = File.ReadAllText(file);
                string overall = Field(json, "overall");
                string summary = Field(json, "summary");
                string uiField = Field(json, "ui");
                if (!string.IsNullOrEmpty(uiField)) ui = uiField;
                paused = json.Contains("\"paused\": true");
                if (json.Contains("\"lowMemory\": true") && (DateTime.Now - lastMemWarn).TotalMinutes > 30)
                {
                    lastMemWarn = DateTime.Now;
                    tray.ShowBalloonTip(8000, "AI Office: memori hampir habis", "RAM bebas di bawah 0,7 GB, jadi AI Office bisa lambat atau terputus. Tutup Chrome, ChatGPT/Claude Desktop, atau aplikasi lain yang tidak dipakai.", ToolTipIcon.Warning);
                }
                pauseItem.Text = paused ? "Lanjutkan pekerjaan" : "Jeda pekerjaan";
                var text = "AI Office: " + (string.IsNullOrEmpty(summary) ? overall : summary);
                tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
                statusItem.Text = string.IsNullOrEmpty(summary) ? overall : summary;
                Color c = overall == "ok" ? Color.FromArgb(34, 197, 94) : overall == "sebagian" ? Color.FromArgb(234, 179, 8) : overall == "mati" ? Color.Gray : Color.FromArgb(239, 68, 68);
                if (overall != lastOverall)
                {
                    tray.Icon = MakeIcon(c);
                    if (lastOverall != "" && overall == "ok") tray.ShowBalloonTip(3000, "AI Office", "Semua terhubung ke Paperclip.", ToolTipIcon.Info);
                    else if (lastOverall == "ok" && overall != "ok") tray.ShowBalloonTip(5000, "AI Office", summary, ToolTipIcon.Warning);
                    if (lastOverall == "" && overall == "ok") { tray.ShowBalloonTip(3000, "AI Office", "Siap. Klik dua kali ikon untuk membuka.", ToolTipIcon.Info); OpenUi(); }
                    if (overall == "mati") { Quit(); return; }
                    lastOverall = overall;
                }
            }
            catch { }
        }

        static string Field(string json, string name)
        {
            var m = Regex.Match(json, "\"" + name + "\":\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }

        static Icon MakeIcon(Color c)
        {
            using (var bmp = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var b = new SolidBrush(Color.FromArgb(24, 28, 38))) g.FillEllipse(b, 1, 1, 30, 30);
                    using (var b = new SolidBrush(c)) g.FillEllipse(b, 6, 6, 20, 20);
                    using (var f = new Font("Segoe UI", 8, FontStyle.Bold)) g.DrawString("AI", f, Brushes.White, 8, 8);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }
    }
}
