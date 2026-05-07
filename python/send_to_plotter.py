"""
Recibe por stdin un JSON con cortes (polilineas en mm) y tamanio de hoja,
genera el payload TCP y lo envia al plotter A3 Max 4 Pro.

Reusa los modulos del proyecto Cutter Propio (generador, enviar).

Input JSON:
{
  "cortes": [[[x_mm, y_mm], ...], ...],
  "pageWidthMm": 297.0,        // ancho de la HOJA fisica (PDF portrait)
  "pageHeightMm": 420.0,       // alto de la HOJA fisica
  "markMarginMm": 10,          // margen entre borde de hoja y marca L
  "ip": "192.168.100.250",     // opcional
  "puerto": 8080,              // opcional
  "dryRun": false              // si true, no abre TCP, solo arma el payload
}

Output: JSON por stdout con resultado.
  { "ok": true, "bytes": 12374, "polilineas": 84 }
  { "ok": false, "error": "..." }

Uso (testing):
  echo '{"cortes":[[[0,0],[10,0],[10,10],[0,10],[0,0]]],"pageWidthMm":100,"pageHeightMm":100,"dryRun":true}' | python send_to_plotter.py
"""
import json
import os
import sys

# generador.py y enviar.py viven en _lib/ adentro del paquete (copiados
# del proyecto Cutter Propio). Asi PrintLayout es autocontenido y no
# depende de paths externos.
_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.join(_HERE, "_lib")
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

import generador  # noqa: E402
import enviar  # noqa: E402


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"JSON invalido: {e}"}))
        sys.exit(1)

    cortes = data.get("cortes", [])
    page_w = data.get("pageWidthMm")
    page_h = data.get("pageHeightMm")
    margen = float(data.get("markMarginMm", 10))
    blade_offset = float(data.get("bladeOffsetMm",
                                  generador.BLADE_OFFSET_DEFAULT_MM))
    ip = data.get("ip", enviar.IP_DEFAULT)
    puerto = int(data.get("puerto", enviar.PUERTO_DEFAULT))
    dry_run = bool(data.get("dryRun", False))

    if not cortes:
        print(json.dumps({"ok": False, "error": "No hay cortes para enviar."}))
        sys.exit(1)
    if page_w is None or page_h is None:
        print(json.dumps({"ok": False, "error": "Falta pageWidthMm o pageHeightMm."}))
        sys.exit(1)

    # Cortes vienen en mm con origen TOP-LEFT respecto al PDF portrait
    # (sistema de coordenadas de la hoja fisica completa).
    #
    # El plotter espera:
    # - La hoja LANDSCAPE (lado largo en X), origen bottom-left.
    # - Que las marcas inferiores del PDF entren primero (X bajo).
    # - Coordenadas relativas a la VENTANA INTERIOR delimitada por las
    #   marcas L (no a la hoja fisica). Esto se logra restando el margen.
    #
    # Transformacion: (x_pdf, y_pdf) -> (x_plot, y_plot) donde
    #   x_plot = (page_h - y_pdf) - margen   (rotacion + traslacion al interior)
    #   y_plot = (page_w - x_pdf) - margen
    # FSIZE = (page_h - 2m, page_w - 2m) = ventana interior landscape.
    plot_w = page_h - 2 * margen
    plot_h = page_w - 2 * margen
    if plot_w <= 0 or plot_h <= 0:
        print(json.dumps({"ok": False,
                          "error": f"Margen {margen}mm es demasiado grande para la hoja {page_w}x{page_h}mm."}))
        sys.exit(1)

    polilineas_plotter = []
    for poly in cortes:
        if len(poly) < 2:
            continue
        rotada = [
            (page_h - y - margen, page_w - x - margen)
            for x, y in poly
        ]
        polilineas_plotter.append(rotada)

    if not polilineas_plotter:
        print(json.dumps({"ok": False, "error": "Polilineas vacias."}))
        sys.exit(1)

    # Reordenar por (X_min, Y_min) en el sistema del plotter para que
    # complete cada "columna" cercana a la entrada antes de avanzar.
    # Round a 1mm para que jitter de Bezier no altere el orden.
    def _orden_key(poly):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return (round(min(xs)), round(min(ys)))

    polilineas_plotter.sort(key=_orden_key)

    try:
        payload = generador.generar_payload_con_marcas(
            polilineas_plotter, plot_w, plot_h,
            margen_marcas_mm=margen,
            blade_offset_mm=blade_offset,
        )
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Generando payload: {e}"}))
        sys.exit(1)

    result = {
        "ok": True,
        "bytes": len(payload),
        "polilineas": len(polilineas_plotter),
        "ip": ip,
        "puerto": puerto,
        "dryRun": dry_run,
    }

    if dry_run:
        # Guardar el payload en un .bin temporal para inspeccion.
        tmp = os.environ.get("TEMP", ".")
        path = os.path.join(tmp, "printlayout_dryrun.bin")
        try:
            with open(path, "wb") as f:
                f.write(payload)
            result["dryRunFile"] = path
        except Exception:
            pass
        print(json.dumps(result))
        return

    try:
        enviar.enviar(payload, ip=ip, puerto=puerto)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Enviando al plotter: {e}"}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
