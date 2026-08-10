// PrintLayoutHelper — print engine nativo para PrintLayout.
//
// Existencia: webContents.print() de Electron no permite pasar un DEVMODE
// custom; cualquier configuracion que el usuario toque en el dialogo nativo
// que abre Chromium queda como default del sistema. Esto rompia el resto de
// las apps en las PCs del local. Adobe Reader / Word / Notepad usan la API
// DocumentProperties de Win32 sobre un DEVMODE en memoria: las preferencias
// elegidas SOLO viven en ese DEVMODE — el sistema queda intacto. Eso es lo
// que hace este helper.
//
// Modos (MODE=...):
//   print     (default) — imprime las hojas. Acepta DEVMODE_FILE para usar
//                         preferencias guardadas por la app.
//   configure          — abre DocumentProperties sobre una copia en memoria
//                         del DEVMODE del driver, devuelve el DEVMODE
//                         resultante en stdout (DEVMODE_OUT=<base64>).
//                         NO escribe nada al DEVMODE del sistema.
//
// Protocolo: lee key=value de stdin (1 por linea), termina con END=1.
//   MODE=<print|configure>  default print
//   DEVICE=<name>           obligatorio en configure; opcional en print
//   COPIES=<n>              opcional (print)
//   SHOW_DIALOG=<0|1>       default 1 (print) — si 0, silent
//   WIDTH_MM=<float>        ancho hoja en mm (print)
//   HEIGHT_MM=<float>       alto hoja en mm (print)
//   PAGE=<path>             una linea por hoja PNG (print)
//   DEVMODE_FILE=<path>     opcional — bin con DEVMODE guardado.
//                           En print: se aplica al PrinterSettings.
//                           En configure: precarga al abrir DocumentProperties.
//   END=1                   fin de input
//
// Output a stdout, una key=value por linea:
//   OK=1                          ok
//   OK=0 + CANCELED=1             usuario cancelo
//   OK=0 + ERROR=<msg>            error
//   DEVMODE_OUT=<base64>          (configure ok) bytes del DEVMODE resultante
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
        // Cuando se aplica un DEVMODE guardado por la app (preferencias propias
        // del usuario para esa impresora), respetamos su PaperSize/Margins/
        // Orientation en vez de forzar nuestro MakePaperSize sintetico. Esto
        // es lo que el usuario espera: si configuro un papel especifico en
        // Preferencias, ese papel se usa al imprimir.
        static bool _useDevModePaper = false;

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

                string mode = "print";
                string device = null;
                int copies = 1;
                bool showDialog = true;
                string devmodeFile = null;
                string docName = "PrintLayout";

                string line;
                while ((line = Console.In.ReadLine()) != null) {
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = line.Substring(0, eq);
                    string v = line.Substring(eq + 1);
                    if (k == "END") break;
                    else if (k == "MODE") mode = v;
                    else if (k == "DEVICE") device = v;
                    else if (k == "COPIES") int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out copies);
                    else if (k == "SHOW_DIALOG") showDialog = v == "1";
                    else if (k == "WIDTH_MM") float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out _widthMm);
                    else if (k == "HEIGHT_MM") float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out _heightMm);
                    else if (k == "DEVMODE_FILE") devmodeFile = v;
                    else if (k == "DOC_NAME") { if (!string.IsNullOrEmpty(v)) docName = v; }
                    else if (k == "PAGE") PagePaths.Add(v);
                }
                Log("read input: mode=" + mode + " pages=" + PagePaths.Count + " device=" + device + " copies=" + copies + " showDialog=" + showDialog + " devmodeFile=" + devmodeFile);

                if (mode == "configure") {
                    return RunConfigure(device, devmodeFile);
                }

                if (PagePaths.Count == 0) {
                    WriteResult(false, "Sin hojas para imprimir.");
                    return 1;
                }
                if (_widthMm <= 0 || _heightMm <= 0) {
                    WriteResult(false, "Tamano de hoja invalido.");
                    return 1;
                }

                // Si tenemos un DEVMODE guardado para esta impresora, usamos el
                // path CreateDC (raw GDI) que respeta el DEVMODE 100% — paper,
                // calidad, color, bandeja, duplex, todo. PrinterSettings.
                // SetHdevmode de .NET tiene comportamiento erratico segun driver
                // (a veces ignora paper size); este path lo evita.
                if (!string.IsNullOrEmpty(devmodeFile) && File.Exists(devmodeFile) && !string.IsNullOrEmpty(device)) {
                    try {
                        byte[] dm = File.ReadAllBytes(devmodeFile);
                        return PrintViaCreateDC(device, dm, copies, docName);
                    } catch (Exception dmEx) {
                        Log("CreateDC path fallo: " + dmEx.Message + " — cayendo a PrintDocument");
                    }
                }

                var doc = new PrintDocument();
                doc.DocumentName = docName;
                doc.OriginAtMargins = false;
                doc.PrintPage += OnPrintPage;
                doc.QueryPageSettings += OnQueryPageSettings;

                if (!string.IsNullOrEmpty(device)) {
                    doc.PrinterSettings.PrinterName = device;
                }
                if (copies > 0) doc.PrinterSettings.Copies = (short)copies;

                // Aplicar DEVMODE guardado si existe — esto setea paper/calidad/
                // color/duplex/etc. del job sin tocar el DEVMODE del sistema.
                // PrinterSettings.SetHdevmode pisa Copies y PrinterName
                // internamente — los re-aplicamos despues.
                bool devModeApplied = false;
                if (!string.IsNullOrEmpty(devmodeFile) && File.Exists(devmodeFile)) {
                    try {
                        byte[] dm = File.ReadAllBytes(devmodeFile);
                        ApplyDevModeToPrinterSettings(doc.PrinterSettings, dm);
                        Log("DEVMODE aplicado desde " + devmodeFile + " (" + dm.Length + "b)");
                        // Re-pisar copies + printer name por si SetHdevmode los movio
                        if (!string.IsNullOrEmpty(device)) doc.PrinterSettings.PrinterName = device;
                        if (copies > 0) doc.PrinterSettings.Copies = (short)copies;
                        devModeApplied = true;
                    } catch (Exception dmEx) {
                        Log("DEVMODE load fallo: " + dmEx.Message);
                    }
                }

                _useDevModePaper = devModeApplied;
                if (devModeApplied) {
                    // Respetar la PaperSize/Margins/Orientation que vienen del
                    // DEVMODE configurado. DefaultPageSettings se inicializa
                    // automaticamente desde PrinterSettings al accederlo despues
                    // de SetHdevmode — pero forzamos margins 0 (PrintLayout
                    // dibuja sin sangria propia).
                    doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                    PaperSize dps = doc.DefaultPageSettings.PaperSize;
                    Log("usando PaperSize del DEVMODE: "
                        + (dps != null ? dps.PaperName + " " + dps.Width + "x" + dps.Height : "<null>")
                        + " landscape=" + doc.DefaultPageSettings.Landscape);
                } else {
                    // Sin DEVMODE custom: forzamos el tamano del template como
                    // source of truth (comportamiento original).
                    doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                    doc.DefaultPageSettings.PaperSize = MakePaperSize();
                    doc.DefaultPageSettings.Landscape = false;
                }

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

        // ---------------- PRINT via CreateDC (con DEVMODE custom) ----------------
        // Bypaseamos PrintDocument para evitar el roundtrip via PrinterSettings,
        // que segun driver puede no aplicar paper size / bandeja del DEVMODE
        // guardado. CreateDC le pasa el DEVMODE directo al spooler — el driver
        // imprime con exactamente esas opciones.
        static int PrintViaCreateDC(string deviceName, byte[] devmode, int copiesOverride, string docName) {
            if (devmode == null || devmode.Length == 0) {
                WriteResult(false, "DEVMODE vacio para CreateDC.");
                return 1;
            }

            // Sobreescribir dmCopies en el DEVMODE para reflejar la eleccion
            // del usuario en el modal. Offset 86 (despues de dmDeviceName[32]*2 +
            // dmSpecVersion(2) + dmDriverVersion(2) + dmSize(2) + dmDriverExtra(2)
            // + dmFields(4) + dmOrientation(2) + dmPaperSize(2) + dmPaperLength(2)
            // + dmPaperWidth(2) + dmScale(2) = 86).
            byte[] dm = (byte[])devmode.Clone();
            if (copiesOverride > 0 && dm.Length >= 92) {
                try {
                    short c = (short)Math.Min(copiesOverride, 999);
                    dm[86] = (byte)(c & 0xff);
                    dm[87] = (byte)((c >> 8) & 0xff);
                    // Setear DM_COPIES en dmFields (offset 72).
                    int f = dm[72] | (dm[73] << 8) | (dm[74] << 16) | (dm[75] << 24);
                    f |= DM_COPIES;
                    dm[72] = (byte)(f & 0xff);
                    dm[73] = (byte)((f >> 8) & 0xff);
                    dm[74] = (byte)((f >> 16) & 0xff);
                    dm[75] = (byte)((f >> 24) & 0xff);
                    Log("dmCopies override = " + c);
                } catch (Exception ex) {
                    Log("override copies fallo: " + ex.Message);
                }
            }

            IntPtr pDevMode = Marshal.AllocHGlobal(dm.Length);
            try {
                Marshal.Copy(dm, 0, pDevMode, dm.Length);

                IntPtr hDC = CreateDC("WINSPOOL", deviceName, null, pDevMode);
                if (hDC == IntPtr.Zero) {
                    int err = Marshal.GetLastWin32Error();
                    WriteResult(false, "CreateDC fallo (err=" + err + ").");
                    return 1;
                }

                try {
                    var di = new DOCINFO {
                        cbSize = Marshal.SizeOf(typeof(DOCINFO)),
                        lpszDocName = string.IsNullOrEmpty(docName) ? "PrintLayout" : docName,
                        lpszOutput = null,
                        lpszDatatype = null,
                        fwType = 0,
                    };
                    int jobId = StartDoc(hDC, ref di);
                    if (jobId <= 0) {
                        int err = Marshal.GetLastWin32Error();
                        WriteResult(false, "StartDoc fallo (err=" + err + ").");
                        return 1;
                    }

                    // GetDeviceCaps: dimensiones fisicas y offsets de la pagina
                    // en pixeles del driver. El DC tiene origen en el inicio del
                    // area imprimible — para dibujar borde-a-borde, partimos del
                    // negativo del offset.
                    int physW = GetDeviceCaps(hDC, PHYSICALWIDTH);
                    int physH = GetDeviceCaps(hDC, PHYSICALHEIGHT);
                    int offX = GetDeviceCaps(hDC, PHYSICALOFFSETX);
                    int offY = GetDeviceCaps(hDC, PHYSICALOFFSETY);
                    Log("DC: physW=" + physW + " physH=" + physH + " offX=" + offX + " offY=" + offY);

                    using (Graphics g = Graphics.FromHdc(hDC)) {
                        // Importante: el DC de impresora por default tiene
                        // PageUnit=Display (1/100 pulgada), no Pixel. Como
                        // PHYSICALWIDTH/HEIGHT y los offsets vienen en pixeles
                        // del driver, forzamos PageUnit=Pixel para que el
                        // rectangulo represente lo que esperamos.
                        g.PageUnit = GraphicsUnit.Pixel;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.CompositingQuality = CompositingQuality.HighQuality;

                        // NO estirar el diseno a toda la hoja: dibujarlo a su
                        // tamano REAL en mm (respetando el corte) y CENTRARLO en la
                        // hoja fisica. Si la hoja es mas grande, el resto queda en
                        // blanco; si es mas chica, se recorta (solo lo que entra).
                        // LOGPIXELSX/Y = DPI del dispositivo → mm a pixeles reales.
                        int dpiX = GetDeviceCaps(hDC, LOGPIXELSX);
                        int dpiY = GetDeviceCaps(hDC, LOGPIXELSY);
                        if (dpiX <= 0) dpiX = 300;
                        if (dpiY <= 0) dpiY = 300;
                        float targetW = _widthMm / 25.4f * dpiX;
                        float targetH = _heightMm / 25.4f * dpiY;
                        // El DC tiene origen en el area imprimible; -offX/-offY es
                        // la esquina fisica de la hoja. Centramos ahi el diseno.
                        float drawX = (physW - targetW) / 2f - offX;
                        float drawY = (physH - targetH) / 2f - offY;
                        Log("design(px)=" + targetW + "x" + targetH + " dpi=" + dpiX + "x" + dpiY
                            + " at=" + drawX + "," + drawY + " (mm=" + _widthMm + "x" + _heightMm + ")");

                        foreach (string pagePath in PagePaths) {
                            if (StartPage(hDC) <= 0) {
                                Log("StartPage fallo en " + pagePath);
                                continue;
                            }
                            try {
                                byte[] bytes = File.ReadAllBytes(pagePath);
                                using (var ms = new MemoryStream(bytes))
                                using (var img = Image.FromStream(ms)) {
                                    g.DrawImage(img, drawX, drawY, targetW, targetH);
                                }
                            } catch (Exception drawEx) {
                                Log("draw fallo: " + drawEx.Message);
                            } finally {
                                EndPage(hDC);
                            }
                        }

                        EndDoc(hDC);
                    }

                    Console.Out.WriteLine("OK=1");
                    Console.Out.WriteLine("DEVICE=" + deviceName);
                    Console.Out.WriteLine("COPIES=" + (copiesOverride > 0 ? copiesOverride : 1));
                    Console.Out.Flush();
                    return 0;
                } finally {
                    DeleteDC(hDC);
                }
            } finally {
                Marshal.FreeHGlobal(pDevMode);
            }
        }

        // GDI / spooler P/Invoke para el path CreateDC.
        [DllImport("gdi32.dll", EntryPoint = "CreateDCW", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateDC(string lpszDriver, string lpszDevice, string lpszOutput, IntPtr lpInitData);

        [DllImport("gdi32.dll")]
        static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", EntryPoint = "StartDocW", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern int StartDoc(IntPtr hdc, [In] ref DOCINFO lpdi);

        [DllImport("gdi32.dll", SetLastError = true)]
        static extern int EndDoc(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        static extern int StartPage(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        static extern int EndPage(IntPtr hdc);

        [DllImport("gdi32.dll")]
        static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        const int LOGPIXELSX = 88;
        const int LOGPIXELSY = 90;
        const int PHYSICALWIDTH = 110;
        const int PHYSICALHEIGHT = 111;
        const int PHYSICALOFFSETX = 112;
        const int PHYSICALOFFSETY = 113;
        const int DM_COPIES = 0x00000100;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DOCINFO {
            public int cbSize;
            [MarshalAs(UnmanagedType.LPWStr)] public string lpszDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string lpszOutput;
            [MarshalAs(UnmanagedType.LPWStr)] public string lpszDatatype;
            public int fwType;
        }

        // ---------------- CONFIGURE mode ----------------
        // Abre el dialogo Preferencias del driver sobre una copia en memoria
        // del DEVMODE. Las elecciones del usuario se aplican SOLO al DEVMODE
        // resultante — el del sistema queda como estaba.
        static int RunConfigure(string deviceName, string devmodeFile) {
            if (string.IsNullOrEmpty(deviceName)) {
                WriteResult(false, "Falta DEVICE para configurar.");
                return 1;
            }

            byte[] inputDm = null;
            if (!string.IsNullOrEmpty(devmodeFile) && File.Exists(devmodeFile)) {
                try { inputDm = File.ReadAllBytes(devmodeFile); }
                catch (Exception ex) { Log("read input devmode fallo: " + ex.Message); }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Owner fantasma TopMost — sin esto el dialog puede aparecer detras
            // de la ventana de Electron.
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

            byte[] resultDm = null;
            DocumentPropertiesResult res;
            try {
                res = ShowDocumentProperties(owner.Handle, deviceName, inputDm, out resultDm);
            } finally {
                owner.Close();
                owner.Dispose();
            }

            if (res == DocumentPropertiesResult.Canceled) {
                Console.Out.WriteLine("OK=0");
                Console.Out.WriteLine("CANCELED=1");
                Console.Out.Flush();
                return 2;
            }
            if (res != DocumentPropertiesResult.Ok || resultDm == null) {
                WriteResult(false, "DocumentProperties no devolvio DEVMODE.");
                return 1;
            }

            Console.Out.WriteLine("OK=1");
            Console.Out.WriteLine("DEVMODE_OUT=" + Convert.ToBase64String(resultDm));
            Console.Out.Flush();
            return 0;
        }

        enum DocumentPropertiesResult { Ok, Canceled, Error }

        // DocumentPropertiesW: muestra Preferencias del driver. Si DM_IN_BUFFER
        // esta, parte del DEVMODE proporcionado (asi recordamos la ultima
        // eleccion). Con DM_OUT_BUFFER, escribe el DEVMODE resultante a un
        // buffer que el caller proporciona. fMode = 0 devuelve el size
        // necesario.
        [DllImport("winspool.drv", EntryPoint = "DocumentPropertiesW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern int DocumentProperties(IntPtr hwnd, IntPtr hPrinter, string pDeviceName, IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);

        const int DM_OUT_BUFFER = 2;
        const int DM_IN_PROMPT = 4;
        const int DM_IN_BUFFER = 8;
        const int IDOK = 1;
        const int IDCANCEL = 2;

        static DocumentPropertiesResult ShowDocumentProperties(
            IntPtr ownerHwnd, string deviceName, byte[] inputDm, out byte[] outputDm)
        {
            outputDm = null;
            IntPtr hPrinter;
            if (!OpenPrinter(deviceName, out hPrinter, IntPtr.Zero)) {
                Log("OpenPrinter fallo " + Marshal.GetLastWin32Error());
                return DocumentPropertiesResult.Error;
            }
            try {
                // 1ra llamada: tamano de buffer requerido por el driver.
                int needed = DocumentProperties(ownerHwnd, hPrinter, deviceName, IntPtr.Zero, IntPtr.Zero, 0);
                if (needed <= 0) {
                    Log("DocumentProperties size = " + needed);
                    return DocumentPropertiesResult.Error;
                }

                IntPtr pIn = IntPtr.Zero;
                IntPtr pOut = IntPtr.Zero;
                try {
                    int flags = DM_IN_PROMPT | DM_OUT_BUFFER;
                    // Si tenemos un DEVMODE previo del mismo size, lo pasamos
                    // como input para que el dialog arranque en esas opciones.
                    // Drivers distintos / versiones distintas pueden cambiar el
                    // size — en ese caso, mejor no pasar nada que pasar basura.
                    if (inputDm != null && inputDm.Length == needed) {
                        pIn = Marshal.AllocHGlobal(needed);
                        Marshal.Copy(inputDm, 0, pIn, needed);
                        flags |= DM_IN_BUFFER;
                    }
                    pOut = Marshal.AllocHGlobal(needed);
                    // Cero el buffer para evitar que driver lea basura como
                    // "campos validos" via dmFields antes de poblarlos.
                    for (int i = 0; i < needed; i++) Marshal.WriteByte(pOut, i, 0);

                    int code = DocumentProperties(ownerHwnd, hPrinter, deviceName, pOut, pIn, flags);
                    if (code == IDCANCEL) return DocumentPropertiesResult.Canceled;
                    if (code != IDOK) {
                        Log("DocumentProperties code=" + code + " err=" + Marshal.GetLastWin32Error());
                        return DocumentPropertiesResult.Error;
                    }

                    byte[] buf = new byte[needed];
                    Marshal.Copy(pOut, buf, 0, needed);
                    outputDm = buf;
                    return DocumentPropertiesResult.Ok;
                } finally {
                    if (pIn != IntPtr.Zero) Marshal.FreeHGlobal(pIn);
                    if (pOut != IntPtr.Zero) Marshal.FreeHGlobal(pOut);
                }
            } finally {
                ClosePrinter(hPrinter);
            }
        }

        // Aplica un DEVMODE (bytes) a un PrinterSettings via SetHdevmode.
        // Aloca un HGLOBAL movable con los bytes y se lo pasa; SetHdevmode
        // copia el contenido, asi que despues podemos liberar nuestro handle.
        const uint GMEM_MOVEABLE = 0x0002;

        [DllImport("kernel32.dll")]
        static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        static void ApplyDevModeToPrinterSettings(PrinterSettings settings, byte[] devmode) {
            if (settings == null || devmode == null || devmode.Length == 0) return;
            IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)devmode.Length);
            if (hMem == IntPtr.Zero) return;
            IntPtr ptr = GlobalLock(hMem);
            if (ptr == IntPtr.Zero) { GlobalFree(hMem); return; }
            try {
                Marshal.Copy(devmode, 0, ptr, devmode.Length);
            } finally {
                GlobalUnlock(hMem);
            }
            try {
                settings.SetHdevmode(hMem);
            } catch (Exception ex) {
                Log("SetHdevmode fallo: " + ex.Message);
            } finally {
                // SetHdevmode copia los bytes internamente — el handle ya no
                // se necesita.
                try { GlobalFree(hMem); } catch { }
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
            // Margenes siempre 0 — PrintLayout dibuja exactamente lo que se
            // imprime, sin que el driver agregue su sangria.
            e.PageSettings.Margins = new Margins(0, 0, 0, 0);

            if (_useDevModePaper) {
                // Con DEVMODE custom: respetamos PaperSize/Orientation del
                // driver. e.PageSettings ya hereda de DefaultPageSettings (que
                // a su vez sale del PrinterSettings post-SetHdevmode), asi que
                // no hace falta tocar nada mas.
                return;
            }

            // Sin DEVMODE custom: forzamos PaperSize del template como source
            // of truth. Esto reemplaza el PaperSize del driver — apunta a que
            // PrintLayout maneje el tamano fisico de hoja.
            e.PageSettings.PaperSize = MakePaperSize();
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
                // Igual criterio que el camino CreateDC: NO estirar a la hoja.
                // Dibujar el diseno a su tamano REAL en mm y centrarlo. PageUnit
                // default = Display (1/100 pulgada), por eso mm→1/100" = /25.4*100.
                float targetW = _widthMm / 25.4f * 100f;
                float targetH = _heightMm / 25.4f * 100f;
                float drawX = e.PageBounds.Left + (e.PageBounds.Width - targetW) / 2f;
                float drawY = e.PageBounds.Top + (e.PageBounds.Height - targetH) / 2f;
                e.Graphics.DrawImage(img, drawX, drawY, targetW, targetH);
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
