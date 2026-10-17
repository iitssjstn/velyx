// Vidalune for Windows: the icon next to the clock. It starts the server (Node) itself, inside a
// Windows job object, so the server and everything it starts (FFmpeg) stop with the icon, however
// the icon ends: through its menu, Task Manager, a crash or signing out. Compiled with Mono's mcs or
// csc against .NET Framework 4, which every Windows 10 and 11 PC has.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace Vidalune
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Anything that goes wrong in this program itself ends up in the log, not in thin air.
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Settings.Fail(e.ExceptionObject as Exception);
            Application.ThreadException += (s, e) => Settings.Fail(e.Exception);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            bool open = Array.IndexOf(args, "--open") >= 0;
            bool first;
            using (var mutex = new Mutex(true, "Local\\VidaluneTray", out first))
            {
                if (!first)
                {
                    // Already running (started at sign-in): the shortcut only opens the website.
                    if (open) Tray.OpenWebsite(Settings.Load().Port);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Tray tray;
                try { tray = new Tray(open); }
                catch (Exception e) { Settings.Fail(e); return; }
                Application.Run(tray);
            }
        }
    }

    /// <summary>Where everything is, and the server's settings (vidalune.env in the data folder).</summary>
    class Settings
    {
        public string InstallDir;
        public string DataDir;
        public string LogFile;
        public string StatusFile;
        public int Port = 3000;
        public Dictionary<string, string> Env = new Dictionary<string, string>();

        public static Settings Load()
        {
            var s = new Settings();
            s.InstallDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            s.DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Vidalune");
            s.LogFile = Path.Combine(s.DataDir, "logs", "vidalune.log");
            s.StatusFile = Path.Combine(s.DataDir, "status.json");
            string envFile = Path.Combine(s.DataDir, "vidalune.env");
            if (File.Exists(envFile))
            {
                foreach (string raw in File.ReadAllLines(envFile))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    s.Env[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim().Trim('"');
                }
            }
            int port;
            string p;
            if (s.Env.TryGetValue("PORT", out p) && int.TryParse(p, out port) && port > 0 && port < 65536) s.Port = port;
            return s;
        }

        /// <summary>Writes an error of this program to the log (the server's own lines are there too).</summary>
        public static void Fail(Exception e)
        {
            try
            {
                var s = Load();
                Directory.CreateDirectory(Path.GetDirectoryName(s.LogFile));
                File.AppendAllText(s.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " Vidalune icon error: " + e + Environment.NewLine, new UTF8Encoding(false));
            }
            catch (Exception) { }
        }

        /// <summary>Every drive Windows has ready (internal, USB, network): where libraries may be.</summary>
        public static string Drives()
        {
            var roots = new List<string>();
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.IsReady && (d.DriveType == DriveType.Fixed || d.DriveType == DriveType.Removable || d.DriveType == DriveType.Network)) roots.Add(d.RootDirectory.FullName);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            return string.Join(",", roots.ToArray());
        }
    }

    /// <summary>Texts in Dutch or English, after the Windows display language.</summary>
    static class T
    {
        static readonly bool Nl = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "nl";
        public static string Open { get { return Nl ? "Vidalune openen" : "Open Vidalune"; } }
        public static string Restart { get { return Nl ? "Herstarten" : "Restart"; } }
        public static string Log { get { return Nl ? "Logboek openen" : "Open log"; } }
        public static string Quit { get { return Nl ? "Vidalune afsluiten" : "Quit Vidalune"; } }
        public static string Running { get { return Nl ? "Vidalune draait" : "Vidalune is running"; } }
        public static string Starting { get { return Nl ? "Vidalune start…" : "Vidalune is starting…"; } }
        public static string Stopped { get { return Nl ? "Vidalune is gestopt" : "Vidalune has stopped"; } }
        public static string Crashed { get { return Nl ? "Vidalune is gestopt door een fout. Kijk in het logboek wat er misging." : "Vidalune stopped because of an error. The log shows what went wrong."; } }
        public static string GaveUp { get { return Nl ? "Vidalune stopt steeds. Kies Herstarten om het opnieuw te proberen, of kijk in het logboek." : "Vidalune keeps stopping. Choose Restart to try again, or look at the log."; } }
        public static string NoNode { get { return Nl ? "Vidalune is niet volledig geïnstalleerd. Installeer Vidalune opnieuw." : "Vidalune is not fully installed. Install Vidalune again."; } }
        public static string Watching(int n)
        {
            if (Nl) return n == 1 ? "Er kijkt nu iemand. Toch afsluiten?" : "Er kijken nu " + n + " mensen. Toch afsluiten?";
            return n == 1 ? "Someone is watching right now. Quit anyway?" : n + " people are watching right now. Quit anyway?";
        }
        public static string WatchingTip(int n) { return Nl ? (n == 1 ? " · 1 kijker" : " · " + n + " kijkers") : (n == 1 ? " · 1 viewer" : " · " + n + " viewers"); }
    }

    /// <summary>A Windows job object that ends everything in it once its last handle closes.</summary>
    sealed class KillOnCloseJob
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int length);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        const int ExtendedLimitInformation = 9;
        const uint KillOnJobClose = 0x2000;

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        // Deliberately never closed: Windows closes it when this program ends, in any way.
        readonly IntPtr handle;

        public KillOnCloseJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject failed");
            var info = new ExtendedLimits();
            info.Basic.LimitFlags = KillOnJobClose;
            if (!SetInformationJobObject(handle, ExtendedLimitInformation, ref info, Marshal.SizeOf(typeof(ExtendedLimits))))
                throw new InvalidOperationException("SetInformationJobObject failed");
        }

        public void Add(Process p)
        {
            if (!AssignProcessToJobObject(handle, p.Handle)) throw new InvalidOperationException("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
        }
    }

    sealed class Tray : ApplicationContext
    {
        [DllImport("kernel32.dll")]
        static extern uint SetThreadExecutionState(uint flags);
        const uint EsContinuous = 0x80000000, EsSystemRequired = 0x00000001;

        readonly Settings settings = Settings.Load();
        readonly KillOnCloseJob job = new KillOnCloseJob();
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Icon runningIcon, stoppedIcon;
        readonly Control ui = new Control();
        readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer();
        readonly List<DateTime> crashes = new List<DateTime>();
        readonly object logLock = new object();
        Process server;
        StreamWriter log;
        bool stopping, healthy, openWhenReady, keepingAwake;
        int watching;

        public Tray(bool open)
        {
            openWhenReady = open || !File.Exists(Path.Combine(settings.DataDir, "first-run-done"));
            ui.CreateControl();
            runningIcon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            stoppedIcon = LoadIcon("stopped.ico") ?? runningIcon;

            var menu = new ContextMenuStrip();
            var openItem = menu.Items.Add(T.Open, null, delegate { OpenWebsite(settings.Port); });
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            menu.Items.Add(T.Restart, null, delegate { Restart(); });
            menu.Items.Add(T.Log, null, delegate { OpenLog(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(T.Quit, null, delegate { Quit(); });
            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { OpenWebsite(settings.Port); };
            ShowState();
            icon.Visible = true;

            poll.Interval = 5000;
            poll.Tick += delegate { Check(); };
            poll.Start();
            StartServer();
        }

        static Icon LoadIcon(string name)
        {
            try
            {
                Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
                return s == null ? null : new Icon(s, SystemInformation.SmallIconSize);
            }
            catch (Exception) { return null; }
        }

        public static void OpenWebsite(int port)
        {
            try { Process.Start(new ProcessStartInfo("http://localhost:" + port + "/") { UseShellExecute = true }); }
            catch (Exception) { }
        }

        void OpenLog()
        {
            try { Process.Start(new ProcessStartInfo("notepad.exe", "\"" + settings.LogFile + "\"") { UseShellExecute = true }); }
            catch (Exception) { }
        }

        void StartServer()
        {
            string node = Path.Combine(settings.InstallDir, "node", "node.exe");
            string entry = Path.Combine(settings.InstallDir, "app", "backend", "dist", "index.js");
            if (!File.Exists(node) || !File.Exists(entry))
            {
                icon.ShowBalloonTip(10000, "Vidalune", T.NoNode, ToolTipIcon.Error);
                return;
            }
            OpenLogFile();
            var start = new ProcessStartInfo(node, "\"" + entry + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = settings.DataDir,
            };
            var env = start.EnvironmentVariables;
            env["NODE_ENV"] = "production";
            env["HOST"] = "0.0.0.0";
            env["PORT"] = settings.Port.ToString(CultureInfo.InvariantCulture);
            env["DATA_DIR"] = settings.DataDir;
            env["MEDIA_ROOTS"] = Settings.Drives();
            env["FRONTEND_DIR"] = Path.Combine(settings.InstallDir, "app", "frontend", "dist");
            env["FFMPEG_PATH"] = Path.Combine(settings.InstallDir, "ffmpeg", "ffmpeg.exe");
            env["FFPROBE_PATH"] = Path.Combine(settings.InstallDir, "ffmpeg", "ffprobe.exe");
            env["VIDALUNE_PACKAGE"] = "windows";
            foreach (var kv in settings.Env) env[kv.Key] = kv.Value;
            // What this program relies on is never taken from vidalune.env.
            env["STATUS_FILE"] = settings.StatusFile;
            env["STOP_ON_STDIN_END"] = "1";

            var p = new Process { StartInfo = start, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => Log(e.Data);
            p.ErrorDataReceived += (s, e) => Log(e.Data);
            p.Exited += delegate { ui.BeginInvoke(new Action(() => ServerExited(p))); };
            stopping = false;
            healthy = false;
            Log("Starting Vidalune");
            p.Start();
            job.Add(p);
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            server = p;
            ShowState();
        }

        void OpenLogFile()
        {
            lock (logLock)
            {
                if (log != null) return;
                Directory.CreateDirectory(Path.GetDirectoryName(settings.LogFile));
                var info = new FileInfo(settings.LogFile);
                if (info.Exists && info.Length > 10 * 1024 * 1024)
                {
                    string old = Path.Combine(info.DirectoryName, "vidalune.old.log");
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(settings.LogFile, old);
                }
                log = new StreamWriter(new FileStream(settings.LogFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
            }
        }

        void Log(string line)
        {
            if (line == null) return;
            lock (logLock)
            {
                if (log != null) log.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " " + line);
            }
        }

        void ServerExited(Process p)
        {
            if (p != server) return;
            server = null;
            healthy = false;
            watching = 0;
            KeepAwake(false);
            ShowState();
            if (stopping) return;
            Log("Vidalune stopped unexpectedly (exit code " + p.ExitCode + ")");
            crashes.Add(DateTime.Now);
            crashes.RemoveAll(t => DateTime.Now - t > TimeSpan.FromMinutes(10));
            if (crashes.Count > 5)
            {
                icon.ShowBalloonTip(10000, "Vidalune", T.GaveUp, ToolTipIcon.Error);
                return;
            }
            icon.ShowBalloonTip(5000, "Vidalune", T.Crashed, ToolTipIcon.Warning);
            var again = new System.Windows.Forms.Timer { Interval = 5000 };
            again.Tick += delegate { again.Dispose(); if (server == null && !stopping) StartServer(); };
            again.Start();
        }

        /// <summary>Asks the server to stop (it closes its database and FFmpeg), and ends it after 15 s.</summary>
        void StopServer()
        {
            Process p = server;
            if (p == null) return;
            stopping = true;
            try { p.StandardInput.Close(); } catch (Exception) { }
            if (!p.WaitForExit(15000))
            {
                try { p.Kill(); } catch (Exception) { }
                p.WaitForExit(5000);
            }
            server = null;
            healthy = false;
            watching = 0;
            KeepAwake(false);
        }

        void Restart()
        {
            crashes.Clear();
            StopServer();
            StartServer();
        }

        void Quit()
        {
            if (watching > 0 && MessageBox.Show(T.Watching(watching), "Vidalune", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            poll.Stop();
            StopServer();
            icon.Visible = false;
            Log("Vidalune closed");
            ExitThread();
        }

        void Check()
        {
            if (server == null) return;
            int port = settings.Port;
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool ok = Healthy(port);
                int viewers = ReadWatching();
                try { ui.BeginInvoke(new Action(() => Checked(ok, viewers))); } catch (InvalidOperationException) { }
            });
        }

        static bool Healthy(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health");
                req.Timeout = 3000;
                using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
            }
            catch (WebException) { return false; }
        }

        int ReadWatching()
        {
            try
            {
                var info = new FileInfo(settings.StatusFile);
                // An old file (server hanging or gone) says nothing about now.
                if (!info.Exists || DateTime.Now - info.LastWriteTime > TimeSpan.FromSeconds(30)) return 0;
                Match m = Regex.Match(File.ReadAllText(settings.StatusFile), "\"watching\"\\s*:\\s*(\\d+)");
                return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
            }
            catch (IOException) { return 0; }
        }

        void Checked(bool ok, int viewers)
        {
            if (server == null) return;
            healthy = ok;
            watching = ok ? viewers : 0;
            // Someone is watching: the PC may not fall asleep. Afterwards Windows decides again.
            KeepAwake(watching > 0);
            ShowState();
            if (ok && openWhenReady)
            {
                openWhenReady = false;
                try { File.WriteAllText(Path.Combine(settings.DataDir, "first-run-done"), DateTime.Now.ToString("o")); } catch (IOException) { }
                OpenWebsite(settings.Port);
            }
        }

        void KeepAwake(bool on)
        {
            if (on == keepingAwake) return;
            keepingAwake = on;
            SetThreadExecutionState(on ? EsContinuous | EsSystemRequired : EsContinuous);
        }

        void ShowState()
        {
            icon.Icon = server != null && healthy ? runningIcon : stoppedIcon;
            string text = server == null ? T.Stopped : healthy ? T.Running + (watching > 0 ? T.WatchingTip(watching) : "") : T.Starting;
            icon.Text = text.Length > 63 ? text.Substring(0, 63) : text;
        }
    }
}
