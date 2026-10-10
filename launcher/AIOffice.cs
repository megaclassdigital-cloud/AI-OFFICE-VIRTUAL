// AIOffice.exe — aplikasi tray untuk AI Office (tanpa terminal). Dibangun dengan csc bawaan Windows (tanpa dependensi).
// Tugasnya: menyalakan pengawas (scripts/office-launcher.mjs) tersembunyi, menampilkan status koneksi di ikon tray, membuka UI, menjeda/melanjutkan,
// memulai ulang komponen, dan mematikan semuanya dengan aman. Seluruh logika koneksi ada di pengawas Node; aplikasi ini hanya cangkang.
//
// Build:  launcher\build.ps1   (hasil: AIOffice.exe di akar repo)
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace AIOffice
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
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
        readonly string root;
        readonly string nodeExe;
        readonly NotifyIcon tray;
        readonly System.Windows.Forms.Timer timer;
        readonly ToolStripMenuItem statusItem, pauseItem;
        Process supervisor;
        string lastOverall = "";
        bool paused;
        string ui = "http://127.0.0.1:3190";

        public TrayApp(string[] args)
        {
            root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
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
            menu.Items.Add("Matikan semua dengan aman (jeda dulu, tunggu agent selesai)", null, (s, e) => SafeShutdown());
            menu.Items.Add("Keluar sekarang (komponen dihentikan)", null, (s, e) => ExitNow());

            tray = new NotifyIcon { Icon = MakeIcon(Color.Gray), Visible = true, Text = "AI Office: memulai", ContextMenuStrip = menu };
            tray.DoubleClick += (s, e) => OpenUi();

            StartSupervisor(args);
            timer = new System.Windows.Forms.Timer { Interval = 3000 };
            timer.Tick += (s, e) => Refresh();
            timer.Start();
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
                if (!File.Exists(file)) return;
                var json = File.ReadAllText(file);
                string overall = Field(json, "overall");
                string summary = Field(json, "summary");
                string uiField = Field(json, "ui");
                if (!string.IsNullOrEmpty(uiField)) ui = uiField;
                paused = json.Contains("\"paused\": true");
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
