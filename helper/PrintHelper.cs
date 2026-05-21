// PrintLayoutHelper — print engine nativo para PrintLayout.
//
// Existencia: webContents.print() de Electron no permite pasar un DEVMODE
// custom; cualquier configuracion que el usuario toque en el dialogo nativo
// que abre Chromium queda como default del sistema. Esto rompia el resto de
// las apps en las PCs del local. Adobe Reader / Word / Notepad usan la API
// PrintDialog de Win32 en "document mode": el DEVMODE elegido se usa solo
// para ese trabajo y no persiste. Eso es lo que hace este helper, via
// System.Windows.Forms.PrintDialog (que internamente esta en document mode).
//
// Protocolo: lee key=value de stdin (1 por linea), termina con END=1.
//   DEVICE=<name>           opcional — pre-selecciona impresora en el dialog
//   COPIES=<n>              opcional — pre-rellena copias en el dialog
//   SHOW_DIALOG=<0|1>       default 1 — si 0, imprime silent con DEVICE+COPIES
//   WIDTH_MM=<float>        ancho fisico de hoja en mm (custom paper)
//   HEIGHT_MM=<float>       alto fisico de hoja en mm
//   PAGE=<path>             una linea PAGE= por hoja (PNG); orden = orden imprimir
//   END=1                   fin de input
//
// Output a stdout, una key=value por linea:
//   OK=1                    impresion exitosa
//   OK=0 + CANCELED=1       usuario cancelo el dialog
//   OK=0 + ERROR=<msg>      error
//
// Exit codes: 0 ok, 1 error, 2 canceled.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace PrintLayoutHelper {
    static class Program {
        static readonly List<string> PagePaths = new List<string>();
        static int _pageIdx = 0;
        static float _widthMm = 0;
        static float _heightMm = 0;

        [STAThread]
        static int Main(string[] args) {
            try {
                // UTF-8 en stdin/stdout: Node escribe UTF-8. En winexe sin
                // consola adjunta, set de Encoding puede tirar "Invalid handle"
                // — lo abrazamos por las dudas. Si falla queda en default
                // (que en Windows AR suele ser CP1252, OK para ASCII puro).
                try {
                    Console.InputEncoding = new UTF8Encoding(false);
                    Console.OutputEncoding = new UTF8Encoding(false);
                } catch {
                    // ignore
                }

                Log("starting");

                string device = null;
                int copies = 1;
                bool showDialog = true;

                string line;
                while ((line = Console.In.ReadLine()) != null) {
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = line.Substring(0, eq);
                    string v = line.Substring(eq + 1);
                    if (k == "END") break;
                    else if (k == "DEVICE") device = v;
                    else if (k == "COPIES") int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out copies);
                    else if (k == "SHOW_DIALOG") showDialog = v == "1";
                    else if (k == "WIDTH_MM") float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out _widthMm);
                    else if (k == "HEIGHT_MM") float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out _heightMm);
                    else if (k == "PAGE") PagePaths.Add(v);
                }
                Log("read input: pages=" + PagePaths.Count + " device=" + device + " copies=" + copies + " showDialog=" + showDialog);

                if (PagePaths.Count == 0) {
                    WriteResult(false, "Sin hojas para imprimir.");
                    return 1;
                }
                if (_widthMm <= 0 || _heightMm <= 0) {
                    WriteResult(false, "Tamano de hoja invalido.");
                    return 1;
                }

                var doc = new PrintDocument();
                doc.OriginAtMargins = false;
                doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                doc.DefaultPageSettings.PaperSize = MakePaperSize();
                doc.DefaultPageSettings.Landscape = false;
                doc.PrintPage += OnPrintPage;
                doc.QueryPageSettings += OnQueryPageSettings;

                if (!string.IsNullOrEmpty(device)) {
                    doc.PrinterSettings.PrinterName = device;
                }
                if (copies > 0) doc.PrinterSettings.Copies = (short)copies;

                if (showDialog) {
                    Log("preparing dialog");
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);

                    var dlg = new PrintDialog();
                    dlg.AllowSomePages = false;
                    dlg.AllowSelection = false;
                    dlg.AllowCurrentPage = false;
                    dlg.AllowPrintToFile = false;
                    dlg.UseEXDialog = true;
                    dlg.Document = doc;
                    // PrinterSettings.PrinterName ya esta seteado en doc; el dialog
                    // lo respeta y arranca seleccionada.

                    // ShowDialog() sin owner muchas veces queda detras de la
                    // ventana padre (cuando el helper se spawnea desde Electron
                    // como subproceso). Creamos un Form "fantasma" offscreen y
                    // TopMost que actua de owner: asi el dialog se monta a algo
                    // visible-en-Z-order y aparece al frente del usuario.
                    var owner = new Form {
                        StartPosition = FormStartPosition.Manual,
                        Location = new Point(-32000, -32000),
                        Size = new Size(1, 1),
                        ShowInTaskbar = false,
                        FormBorderStyle = FormBorderStyle.None,
                        Opacity = 0,
                        TopMost = true,
                    };
                    owner.Show();
                    owner.Activate();
                    Log("showing dialog");

                    DialogResult res;
                    try {
                        res = dlg.ShowDialog(owner);
                    } finally {
                        owner.Close();
                        owner.Dispose();
                    }
                    Log("dialog returned " + res);
                    if (res != DialogResult.OK) {
                        Console.Out.WriteLine("OK=0");
                        Console.Out.WriteLine("CANCELED=1");
                        Console.Out.Flush();
                        return 2;
                    }
                }

                // Snapshot del DEVMODE de la impresora ANTES de imprimir.
                // Algunos drivers (HP/Canon/Brother) ignoran el flag "document
                // mode" del PrintDialog y persisten lo que el usuario toca en
                // Preferencias al GLOBAL DEVMODE (level 8) y al per-user
                // DEVMODE (level 9) — eso pisa el default para otras apps Y
                // para Preferencias de Windows. Adobe Reader/Word evitan eso
                // restaurando ambos despues del print.
                string printerName = doc.PrinterSettings.PrinterName;
                byte[] snap8 = null;
                byte[] snap9 = null;
                try {
                    snap8 = CapturePrinterDevMode(printerName, 8);
                    snap9 = CapturePrinterDevMode(printerName, 9);
                    Log("snap L8=" + (snap8 == null ? "null" : snap8.Length + "b")
                       + " L9=" + (snap9 == null ? "null" : snap9.Length + "b"));
                } catch (Exception snapEx) {
                    Log("snapshot fallo: " + snapEx.Message);
                }

                Log("printing " + PagePaths.Count + " page(s)");
                try {
                    doc.Print();
                } finally {
                    try {
                        if (snap8 != null) RestorePrinterDevMode(printerName, 8, snap8);
                        if (snap9 != null) RestorePrinterDevMode(printerName, 9, snap9);
                        Log("devmode restored");
                    } catch (Exception restEx) {
                        Log("restore fallo: " + restEx.Message);
                    }
                }
                Log("doc.Print() returned");

                Console.Out.WriteLine("OK=1");
                Console.Out.WriteLine("DEVICE=" + doc.PrinterSettings.PrinterName);
                Console.Out.WriteLine("COPIES=" + doc.PrinterSettings.Copies);
                Console.Out.Flush();
                return 0;
            } catch (Exception ex) {
                WriteResult(false, ex.Message);
                return 1;
            }
        }

        static PaperSize MakePaperSize() {
            // PaperSize en System.Drawing usa centesimas de pulgada.
            int widthHi = (int)Math.Round(_widthMm / 25.4f * 100f);
            int heightHi = (int)Math.Round(_heightMm / 25.4f * 100f);
            // Algunos drivers usan el "PaperName" para detectar tamanos custom;
            // PaperName "Custom..." dispara el flag de custom size en la mayoria.
            return new PaperSize("PrintLayout " + widthHi + "x" + heightHi, widthHi, heightHi);
        }

        static void OnQueryPageSettings(object sender, QueryPageSettingsEventArgs e) {
            // Forzar paper size y margins en cada hoja por si el driver pisa.
            // Esto reemplaza la PaperSize elegida en Preferencias del driver con
            // la del PDF/template — la idea es que PrintLayout es source of truth
            // del tamano fisico de hoja; lo demas del driver (calidad, color,
            // bandeja, duplex) sigue siendo lo elegido por el usuario.
            e.PageSettings.PaperSize = MakePaperSize();
            e.PageSettings.Margins = new Margins(0, 0, 0, 0);
            e.PageSettings.Landscape = false;
        }

        static void OnPrintPage(object sender, PrintPageEventArgs e) {
            if (_pageIdx >= PagePaths.Count) {
                e.HasMorePages = false;
                return;
            }
            // Cargar el PNG en memoria y cerrar el handle del archivo enseguida,
            // asi el tmpdir es borrable por el main de Electron al terminar.
            byte[] bytes = File.ReadAllBytes(PagePaths[_pageIdx]);
            using (var ms = new MemoryStream(bytes))
            using (var img = Image.FromStream(ms)) {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                e.Graphics.SmoothingMode = SmoothingMode.HighQuality;
                e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                e.Graphics.CompositingQuality = CompositingQuality.HighQuality;
                e.Graphics.DrawImage(img, e.PageBounds);
            }
            _pageIdx++;
            e.HasMorePages = _pageIdx < PagePaths.Count;
        }

        // Log a stderr de forma defensiva: en winexe sin consola adjunta,
        // Console.Error puede tirar "Invalid handle". Si falla, no romper.
        static void Log(string msg) {
            try {
                Console.Error.WriteLine("[helper] " + msg);
            } catch {
                // ignore
            }
        }

        // ---------------- Win32 P/Invoke para snapshot/restore del DEVMODE ----------------
        // El comportamiento esperado del PrintDialog en document mode es que
        // los settings que el usuario toque no persistan al sistema. Algunos
        // drivers ignoran ese flag y escriben al system DEVMODE igual.
        // Adobe Reader / Word evitan esto haciendo snapshot+restore del system
        // DEVMODE antes/despues del print job.
        //
        // GetPrinter level 2 devuelve PRINTER_INFO_2 con un puntero a DEVMODE.
        // Copiamos esos bytes a un array gestionado, dejamos imprimir, y
        // despues SetPrinter level 2 con el DEVMODE original lo restaura.

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
        static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool GetPrinter(IntPtr hPrinter, int Level, IntPtr pPrinter, int cbBuf, out int pcbNeeded);

        [DllImport("winspool.drv", EntryPoint = "SetPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool SetPrinter(IntPtr hPrinter, int Level, IntPtr pPrinter, int Command);

        const int PRINTER_ACCESS_USE = 0x00000008;
        const int PRINTER_ACCESS_ADMINISTER = 0x00000004;
        const int PRINTER_COMMAND_NONE = 0;

        // Offset del puntero pDevMode dentro de PRINTER_INFO_2W (Unicode).
        // PRINTER_INFO_2W layout (LP* = IntPtr en 64-bit):
        //   LPWSTR pServerName, pPrinterName, pShareName, pPortName, pDriverName,
        //   pComment, pLocation; LPDEVMODE pDevMode; LPWSTR pSepFile, pPrintProcessor,
        //   pDatatype, pParameters; PSECURITY_DESCRIPTOR pSecurityDescriptor;
        //   DWORD Attributes, Priority, DefaultPriority, StartTime, UntilTime, Status,
        //         cJobs, AveragePPM;
        // En lugar de hardcodear el offset, usamos OpenPrinter + GetPrinter, leemos
        // el blob y extraemos el campo pDevMode por offset calculado.
        //
        // Mucho mas robusto y simple: usar el helper de System.Drawing.Printing
        // para obtener un IntPtr a DEVMODE via .NET. PrinterSettings.GetHdevmode()
        // devuelve un HGLOBAL al DEVMODE del sistema para esa impresora.
        // — eso es lo que usamos.

        [DllImport("kernel32.dll")]
        static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll")]
        static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("kernel32.dll")]
        static extern uint GlobalSize(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GlobalFree(IntPtr hMem);

        // Captura el DEVMODE de la impresora indicada via GetPrinter level
        // 8 (global) o 9 (per-user). PRINTER_INFO_8/9 son struct identicos
        // — un solo puntero pDevMode al inicio. Devuelve null si no hay
        // DEVMODE configurado en ese nivel (caso comun para L8 en limpio).
        // Marker byte[0] = "habia, pero null" — al restaurar borraremos.
        static byte[] CapturePrinterDevMode(string printerName, int level) {
            if (string.IsNullOrEmpty(printerName)) return null;
            if (level != 8 && level != 9) return null;
            IntPtr hPrinter;
            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return null;
            try {
                int needed;
                GetPrinter(hPrinter, level, IntPtr.Zero, 0, out needed);
                if (needed <= 0) return new byte[0];
                IntPtr pInfo = Marshal.AllocHGlobal(needed);
                try {
                    int got;
                    if (!GetPrinter(hPrinter, level, pInfo, needed, out got)) {
                        return new byte[0];
                    }
                    // PRINTER_INFO_8 y _9 = { LPDEVMODE pDevMode } — un solo puntero.
                    IntPtr pDevMode = Marshal.ReadIntPtr(pInfo);
                    if (pDevMode == IntPtr.Zero) return new byte[0];
                    // dmSize en DEVMODEW: offset 32*2 + 4 = 68; dmDriverExtra en 70.
                    short dmSize = Marshal.ReadInt16(pDevMode, 32 * 2 + 4);
                    short dmDriverExtra = Marshal.ReadInt16(pDevMode, 32 * 2 + 6);
                    int total = dmSize + dmDriverExtra;
                    if (total <= 0) return new byte[0];
                    byte[] buf = new byte[total];
                    Marshal.Copy(pDevMode, buf, 0, total);
                    return buf;
                } finally {
                    Marshal.FreeHGlobal(pInfo);
                }
            } finally {
                ClosePrinter(hPrinter);
            }
        }

        // Restaura el DEVMODE de la impresora usando SetPrinter level 9
        // (per-user defaults). Level 9 NO requiere admin — afecta solo los
        // defaults del usuario actual, que es exactamente lo que las otras
        // apps abren al imprimir. PRINTER_INFO_9 = { LPDEVMODE pDevMode }.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PRINTER_INFO_9 {
            public IntPtr pDevMode;
        }

        static void RestorePrinterDevMode(string printerName, int level, byte[] devmode) {
            if (string.IsNullOrEmpty(printerName) || devmode == null) return;
            if (level != 8 && level != 9) return;

            IntPtr hPrinter;
            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
                Log("OpenPrinter fallo " + Marshal.GetLastWin32Error());
                return;
            }
            try {
                IntPtr pDevMode = IntPtr.Zero;
                if (devmode.Length > 0) {
                    pDevMode = Marshal.AllocHGlobal(devmode.Length);
                    Marshal.Copy(devmode, 0, pDevMode, devmode.Length);
                }
                try {
                    // PRINTER_INFO_8 y _9 ambos = { LPDEVMODE pDevMode }.
                    var info = new PRINTER_INFO_9 { pDevMode = pDevMode };
                    int size = Marshal.SizeOf(typeof(PRINTER_INFO_9));
                    IntPtr pInfo = Marshal.AllocHGlobal(size);
                    try {
                        Marshal.StructureToPtr(info, pInfo, false);
                        if (!SetPrinter(hPrinter, level, pInfo, PRINTER_COMMAND_NONE)) {
                            int err = Marshal.GetLastWin32Error();
                            Log("SetPrinter L" + level + " fallo " + err);
                        }
                    } finally {
                        Marshal.FreeHGlobal(pInfo);
                    }
                } finally {
                    if (pDevMode != IntPtr.Zero) Marshal.FreeHGlobal(pDevMode);
                }
            } finally {
                ClosePrinter(hPrinter);
            }
        }

        static void WriteResult(bool ok, string error) {
            Console.Out.WriteLine("OK=" + (ok ? "1" : "0"));
            if (!ok && !string.IsNullOrEmpty(error)) {
                // Sanitizar newlines del mensaje para no romper el formato.
                Console.Out.WriteLine("ERROR=" + error.Replace('\n', ' ').Replace('\r', ' '));
            }
            Console.Out.Flush();
        }
    }
}
