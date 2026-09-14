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
    margen = float(data.get("markMarginMm", 15))
    # Tipo de marca de registro: 5 = circulos (nuevo default), 0 = L de antes.
    mark_type = int(data.get("markType", generador.MARK_TYPE_CIRCULO))
    blade_offset = float(data.get("bladeOffsetMm",
                                  generador.BLADE_OFFSET_DEFAULT_MM))
    ip = data.get("ip", enviar.IP_DEFAULT)
    puerto = int(data.get("puerto", enviar.PUERTO_DEFAULT))
    dry_run = bool(data.get("dryRun", False))
    # Modo "escribir a archivo": si viene outPath, en vez de enviar por socket
    # guardamos el MISMO payload TB26 como .plt (para cortarlo despues por QR).
    out_path = data.get("outPath")

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

    # Reordenar para eficiencia de recorrido (completar cada "columna" cercana a
    # la entrada antes de avanzar), PERO respetando que un corte INTERNO
    # (contenido dentro de otro) se haga ANTES que el que lo contiene. Ej: el
    # troquel/agujero de una etiqueta va antes que su contorno externo; si se
    # cortara primero el externo, la pieza se suelta de la hoja y el agujero sale
    # mal o no sale. Agrupamos cada corte con su pieza EXTERNA (para no zigzaguear)
    # y dentro de cada grupo van primero los más internos.
    # Round a 1mm para que el jitter de Bezier no altere el orden.
    def _bbox(poly):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return (min(xs), min(ys), max(xs), max(ys))

    def _area(b):
        return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])

    _boxes = [_bbox(p) for p in polilineas_plotter]
    _n = len(polilineas_plotter)
    _T = 0.5  # tolerancia mm para "contenido dentro de"
    _depth = [0] * _n      # cuántas polilíneas lo contienen (más = más interno)
    _root = list(range(_n))  # índice de la pieza EXTERNA que lo contiene (mayor área)
    for i in range(_n):
        bi = _boxes[i]
        ai = _area(bi)
        best_root = i
        best_area = ai
        for j in range(_n):
            if i == j:
                continue
            bj = _boxes[j]
            if (bj[0] <= bi[0] + _T and bj[1] <= bi[1] + _T
                    and bj[2] >= bi[2] - _T and bj[3] >= bi[3] - _T
                    and _area(bj) > ai + 1e-6):
                _depth[i] += 1
                if _area(bj) > best_area:
                    best_area = _area(bj)
                    best_root = j
        _root[i] = best_root

    def _orden_key(i):
        rb = _boxes[_root[i]]                       # posición de la pieza externa
        bi = _boxes[i]
        return (round(rb[0]), round(rb[1]), -_depth[i], round(bi[0]), round(bi[1]))

    _order = sorted(range(_n), key=_orden_key)
    polilineas_plotter = [polilineas_plotter[i] for i in _order]

    try:
        payload = generador.generar_payload_con_marcas(
            polilineas_plotter, plot_w, plot_h,
            margen_marcas_mm=margen,
            blade_offset_mm=blade_offset,
            mark_type=mark_type,
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

    # Modo escribir-a-archivo (.plt en la carpeta del server QR). NO abre TCP:
    # es el MISMO payload que va por socket, guardado tal cual para cortarlo por
    # QR mas tarde. Tiene prioridad sobre socket/dryRun.
    if out_path:
        try:
            out_dir = os.path.dirname(out_path)
            if out_dir:
                os.makedirs(out_dir, exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(payload)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"Escribiendo {out_path}: {e}"}))
            sys.exit(1)
        result["outPath"] = out_path
        print(json.dumps(result))
        return

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
