// Verificador del perfil ICC usando el MOTOR DE COLOR DE WINDOWS (mscms.dll),
// que es el mismo que usan Corel y el resto del sistema.
//
// Convierte una lista de colores sRGB al perfil de salida que se le pase y
// escribe el resultado. Sirve para comprobar, sin imprimir, que lo que Corel le
// va a mandar a la impresora es lo mismo que manda PrintLayout.
//
// Uso:  CmsCheck.exe <perfil-origen.icm> <perfil-destino.icc> <entrada.raw> <salida.raw>
//   entrada.raw / salida.raw = N*3 bytes, R,G,B por color.
//
// Se compila con el csc de .NET Framework (ver helper/build-helper.ps1).

using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class CmsCheck
{
    [StructLayout(LayoutKind.Sequential)]
    private struct PROFILE
    {
        public uint dwType;
        public IntPtr pProfileData;
        public uint cbDataSize;
    }

    private const uint PROFILE_FILENAME = 1;
    private const uint PROFILE_READ = 1;
    private const uint FILE_SHARE_READ = 1;
    private const uint OPEN_EXISTING = 3;
    // OJO: mscms interpreta el buffer al reves de lo que sugiere el nombre.
    // Con BM_RGBTRIPLETS (0x0002) los bytes se leen B,G,R; con BM_BGRTRIPLETS
    // (0x0004) se leen R,G,B, que es como los mandamos. Comprobado: con una
    // tabla identidad el error se cancelaba (doble swap) y con una tabla real
    // aparecia R y B cambiados (rgb(85,170,85) daba [55,163,34] en vez de
    // [34,163,55]).
    private const uint BM_RGBTRIPLETS = 0x0004;
    private const uint INTENT_RELATIVE_COLORIMETRIC = 1;
    private const uint BEST_MODE = 0x0003;

    [DllImport("mscms.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenColorProfileW(ref PROFILE pProfile, uint dwDesiredAccess,
        uint dwShareMode, uint dwCreationMode);

    [DllImport("mscms.dll", SetLastError = true)]
    private static extern bool CloseColorProfile(IntPtr hProfile);

    [DllImport("mscms.dll", SetLastError = true)]
    private static extern IntPtr CreateMultiProfileTransform(IntPtr[] pahProfiles, uint nProfiles,
        uint[] padwIntent, uint nIntents, uint dwFlags, uint indexPreferredCMM);

    [DllImport("mscms.dll", SetLastError = true)]
    private static extern bool DeleteColorTransform(IntPtr hxform);

    [DllImport("mscms.dll", SetLastError = true)]
    private static extern bool TranslateBitmapBits(IntPtr hColorTransform, byte[] pSrcBits,
        uint bmInput, uint dwWidth, uint dwHeight, uint dwInputStride, byte[] pDestBits,
        uint bmOutput, uint dwOutputStride, IntPtr pfnCallBack, IntPtr ulCallbackData);

    private static IntPtr Abrir(string ruta)
    {
        IntPtr mem = Marshal.StringToHGlobalUni(ruta);
        PROFILE pr = new PROFILE
        {
            dwType = PROFILE_FILENAME,
            pProfileData = mem,
            cbDataSize = (uint)((ruta.Length + 1) * 2),
        };
        IntPtr h = OpenColorProfileW(ref pr, PROFILE_READ, FILE_SHARE_READ, OPEN_EXISTING);
        if (h == IntPtr.Zero)
        {
            throw new Exception("No se pudo abrir el perfil '" + ruta + "' (error "
                + Marshal.GetLastWin32Error() + ")");
        }
        return h;
    }

    private static int Main(string[] args)
    {
        if (args.Length < 4)
        {
            Console.Error.WriteLine("Uso: CmsCheck <origen.icm> <destino.icc> <entrada.raw> <salida.raw>");
            return 2;
        }
        IntPtr hSrc = IntPtr.Zero;
        IntPtr hDst = IntPtr.Zero;
        IntPtr hTr = IntPtr.Zero;
        try
        {
            hSrc = Abrir(args[0]);
            hDst = Abrir(args[1]);

            byte[] entrada = File.ReadAllBytes(args[2]);
            if (entrada.Length % 3 != 0) throw new Exception("La entrada no es múltiplo de 3.");
            uint n = (uint)(entrada.Length / 3);
            byte[] salida = new byte[entrada.Length];

            IntPtr[] perfiles = new IntPtr[] { hSrc, hDst };
            uint intent = args.Length > 4 ? uint.Parse(args[4]) : INTENT_RELATIVE_COLORIMETRIC;
            uint flags = args.Length > 5 ? uint.Parse(args[5]) : BEST_MODE;
            uint[] intents = new uint[] { intent };
            hTr = CreateMultiProfileTransform(perfiles, 2, intents, 1, flags, 0);
            if (hTr == IntPtr.Zero)
            {
                throw new Exception("No se pudo crear la transformación de color (error "
                    + Marshal.GetLastWin32Error() + ")");
            }

            // Una sola fila de n píxeles: ancho n, alto 1, 3 bytes por píxel.
            bool ok = TranslateBitmapBits(hTr, entrada, BM_RGBTRIPLETS, n, 1, n * 3,
                salida, BM_RGBTRIPLETS, n * 3, IntPtr.Zero, IntPtr.Zero);
            if (!ok)
            {
                throw new Exception("TranslateBitmapBits falló (error "
                    + Marshal.GetLastWin32Error() + ")");
            }

            File.WriteAllBytes(args[3], salida);
            Console.WriteLine("OK " + n + " colores convertidos por el motor de Windows.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERROR: " + ex.Message);
            return 1;
        }
        finally
        {
            if (hTr != IntPtr.Zero) DeleteColorTransform(hTr);
            if (hDst != IntPtr.Zero) CloseColorProfile(hDst);
            if (hSrc != IntPtr.Zero) CloseColorProfile(hSrc);
        }
    }
}
