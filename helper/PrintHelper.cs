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

                    var res = dlg.ShowDialog();
                    if (res != DialogResult.OK) {
                        Console.Out.WriteLine("OK=0");
                        Console.Out.WriteLine("CANCELED=1");
                        Console.Out.Flush();
                        return 2;
                    }
                    // Despues del dialog, doc.PrinterSettings y doc.DefaultPageSettings
                    // tienen lo que el usuario eligio (incluyendo el DEVMODE custom
                    // que toco en Preferencias del driver). Nada de eso persiste a
                    // los defaults del sistema — eso es la magia de PrintDialog en
                    // modo documento.
                }

                doc.Print();

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
