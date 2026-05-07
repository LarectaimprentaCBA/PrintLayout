"""
Parsea un PDF de plantilla PrintLayout.

Formato simple-faz (3 paginas):
  pag 1 (idx 0) -> imprimible. No se parsea aqui, la app la embebe.
  pag 2 (idx 1) -> vectores de cajas de posicionado. Cada drawing -> una celda.
  pag 3 (idx 2) -> vectores de corte. Cada drawing -> una o mas polilineas.

Formato doble-faz (4 paginas):
  pag 1 (idx 0) -> imprimible (lo que va con marcas).
  pag 2 (idx 1) -> vectores de cajas frente.
  pag 3 (idx 2) -> vectores de cajas dorso (por ahora se ignora; las
                    cajas son las mismas posiciones que en frente).
  pag 4 (idx 3) -> vectores de corte.

Coordenadas devueltas: en mm, origen top-left (mismo sistema que PrintLayout
y que pymupdf nativamente). La inversion a bottom-left para el plotter se
hace UNA SOLA VEZ en send_to_plotter.py.

Uso: python parse_template.py <pdf> [--double-sided]
Salida: JSON por stdout.
"""
import json
import math
import sys

import fitz

# 1 punto PDF = 1/72 inch. 1 inch = 25.4 mm.
PT_PER_MM = 72.0 / 25.4

# Cuanto mas chico, mas precision en la curva. 0.05mm es < paso del plotter (0.025mm).
CHORD_LENGTH_MM = 0.05
N_BEZIER_MIN = 8
N_BEZIER_MAX = 256

# Drawings con bbox menor a este tamano se descartan (ruido / lineas degeneradas).
MIN_CELDA_MM = 0.5

# Tolerancia para considerar dos puntos "iguales" al continuar una polilinea.
EPSILON_MM = 1e-4


def pt_to_mm(pt):
    return pt / PT_PER_MM


def parse_pdf(pdf_path, doble_faz=False):
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo abrir el PDF: {e}"}

    n = len(doc)
    if n < 2:
        return {
            "ok": False,
            "error": (
                f"El PDF tiene {n} pagina(s). Se necesitan al menos 2: "
                "pag 1 imprimible, pag 2 celdas."
            ),
        }

    page0 = doc[0]
    page_w_pt = page0.rect.width
    page_h_pt = page0.rect.height
    page_w_mm = pt_to_mm(page_w_pt)
    page_h_mm = pt_to_mm(page_h_pt)

    # Pagina 2: celdas frente.
    page1 = doc[1]
    if (abs(page1.rect.width - page_w_pt) > 0.1
            or abs(page1.rect.height - page_h_pt) > 0.1):
        return {
            "ok": False,
            "error": "Pag 1 y pag 2 tienen tamanios distintos. Deben coincidir.",
        }
    celdas = _extraer_celdas(page1, page_h_pt)

    # Pagina 3 (solo doble-faz): celdas dorso si difieren del frente.
    celdas_dorso = []
    if doble_faz and n >= 3:
        page2 = doc[2]
        if (abs(page2.rect.width - page_w_pt) > 0.1
                or abs(page2.rect.height - page_h_pt) > 0.1):
            return {
                "ok": False,
                "error": "Pag 1 y pag 3 (dorso) tienen tamanios distintos.",
            }
        cd = _extraer_celdas(page2, page_h_pt)
        if cd and not _celdas_iguales(cd, celdas):
            if len(cd) != len(celdas):
                return {
                    "ok": False,
                    "error": (
                        f"Cantidad de cajas en frente ({len(celdas)}) y dorso "
                        f"({len(cd)}) no coincide. Debe ser la misma."
                    ),
                }
            celdas_dorso = cd

    # Decidir en que pagina vienen los cortes:
    # - simple-faz: pag 3 (idx 2). Opcional.
    # - doble-faz: pag 4 (idx 3). Opcional.
    cortes_idx = 3 if doble_faz else 2
    cortes = []
    if n > cortes_idx:
        page_cortes = doc[cortes_idx]
        if (abs(page_cortes.rect.width - page_w_pt) > 0.1
                or abs(page_cortes.rect.height - page_h_pt) > 0.1):
            return {
                "ok": False,
                "error": f"Pag 1 y pag {cortes_idx + 1} (cortes) tienen tamanios distintos.",
            }
        cortes = _extraer_cortes(page_cortes, page_h_pt)

    return {
        "ok": True,
        "pageWidthMm": page_w_mm,
        "pageHeightMm": page_h_mm,
        "pageCount": n,
        "celdas": celdas,
        "celdasDorso": celdas_dorso,
        "cortes": cortes,
    }


def _celdas_iguales(a, b, tol=0.2):
    """Dos listas de celdas iguales si tienen el mismo conjunto de bboxes (orden libre)."""
    if len(a) != len(b):
        return False
    sa = sorted([(round(c["x"] / tol), round(c["y"] / tol),
                  round(c["w"] / tol), round(c["h"] / tol)) for c in a])
    sb = sorted([(round(c["x"] / tol), round(c["y"] / tol),
                  round(c["w"] / tol), round(c["h"] / tol)) for c in b])
    return sa == sb


def _extraer_celdas(page, _page_h_pt):
    """
    Cada drawing en la pagina de celdas representa una caja de posicionado.
    Tomamos su bbox. Corel suele exportar una misma caja como dos drawings
    (fill + stroke); deduplicamos bboxes coincidentes (tolerancia 0.1mm).
    """
    DEDUP_TOL_MM = 0.1
    celdas = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        if rect is None:
            continue
        w_mm = pt_to_mm(rect.width)
        h_mm = pt_to_mm(rect.height)
        if w_mm < MIN_CELDA_MM or h_mm < MIN_CELDA_MM:
            continue
        # pymupdf ya devuelve top-left con Y down: usamos directo.
        x_mm = pt_to_mm(rect.x0)
        y_mm = pt_to_mm(rect.y0)

        duplicado = False
        for c in celdas:
            if (abs(c["x"] - x_mm) < DEDUP_TOL_MM
                    and abs(c["y"] - y_mm) < DEDUP_TOL_MM
                    and abs(c["w"] - w_mm) < DEDUP_TOL_MM
                    and abs(c["h"] - h_mm) < DEDUP_TOL_MM):
                duplicado = True
                break
        if duplicado:
            continue
        celdas.append({"x": x_mm, "y": y_mm, "w": w_mm, "h": h_mm})

    # Ordenar top-down, left-to-right. Tolerancia de 5mm para misma fila.
    celdas.sort(key=lambda c: (round(c["y"] / 5.0), c["x"]))
    for idx, c in enumerate(celdas):
        c["id"] = idx
    return celdas


def _extraer_cortes(page, page_h_pt):
    """
    Cada drawing -> una o mas polilineas (un drawing puede tener varios subpaths).
    Retornamos lista plana de polilineas en mm, top-left.
    """
    cortes = []
    for drawing in page.get_drawings():
        polilineas = _drawing_a_polilineas(drawing)
        cortes.extend(polilineas)
    return cortes


def _drawing_a_polilineas(drawing):
    """
    Convierte items pymupdf en lista de polilineas en mm.

    pymupdf ya da coords top-left (Y down). Mantenemos top-left aqui;
    la inversion a bottom-left (lo que el plotter espera) ocurre solo
    en send_to_plotter.py.

    Items posibles:
      ('l', P0, P1)              -> linea recta
      ('c', P0, P1, P2, P3)      -> Bezier cubico (P0..P3)
      ('re', Rect, orientation)  -> rectangulo (cerrado)
      ('qu', Quad)               -> quad (4 vertices)
    """
    polilineas = []
    actual = []

    def to_mm(p):
        return (pt_to_mm(p.x), pt_to_mm(p.y))

    def flush():
        nonlocal actual
        if len(actual) >= 2:
            polilineas.append(actual)
        actual = []

    def append_si_nuevo(pt_mm):
        if actual and abs(actual[-1][0] - pt_mm[0]) < EPSILON_MM \
                and abs(actual[-1][1] - pt_mm[1]) < EPSILON_MM:
            return
        actual.append(pt_mm)

    items = drawing.get("items", [])
    for item in items:
        op = item[0]
        if op == "l":
            _, p0, p1 = item
            p0_mm = to_mm(p0)
            p1_mm = to_mm(p1)
            if not actual:
                actual.append(p0_mm)
            elif abs(actual[-1][0] - p0_mm[0]) > EPSILON_MM \
                    or abs(actual[-1][1] - p0_mm[1]) > EPSILON_MM:
                # subpath nuevo
                flush()
                actual.append(p0_mm)
            append_si_nuevo(p1_mm)
        elif op == "c":
            _, p0, p1, p2, p3 = item
            p0_mm = to_mm(p0)
            if not actual:
                actual.append(p0_mm)
            elif abs(actual[-1][0] - p0_mm[0]) > EPSILON_MM \
                    or abs(actual[-1][1] - p0_mm[1]) > EPSILON_MM:
                flush()
                actual.append(p0_mm)
            _samplear_bezier(p0, p1, p2, p3, append_si_nuevo)
        elif op == "re":
            _, rect, _orient = item
            flush()
            x0, y0, x1, y1 = rect.x0, rect.y0, rect.x1, rect.y1
            esquinas = [
                (x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0),
            ]
            for px, py in esquinas:
                actual.append((pt_to_mm(px), pt_to_mm(py)))
            flush()
        elif op == "qu":
            _, quad = item
            flush()
            for p in [quad.ul, quad.ur, quad.lr, quad.ll, quad.ul]:
                actual.append((pt_to_mm(p.x), pt_to_mm(p.y)))
            flush()

    flush()
    return polilineas


def _samplear_bezier(p0, p1, p2, p3, append_pt):
    """
    Aproxima un Bezier cubico con segmentos rectos. N adaptativo segun longitud.
    """
    def dist(a, b):
        return math.hypot(a.x - b.x, a.y - b.y)

    chord = dist(p0, p3)
    poly = dist(p0, p1) + dist(p1, p2) + dist(p2, p3)
    largo_pt = (chord + poly) / 2.0
    largo_mm = pt_to_mm(largo_pt)
    n = int(largo_mm / CHORD_LENGTH_MM) + 1
    n = max(N_BEZIER_MIN, min(N_BEZIER_MAX, n))

    for i in range(1, n + 1):
        t = i / n
        u = 1.0 - t
        x = (u * u * u * p0.x
             + 3 * u * u * t * p1.x
             + 3 * u * t * t * p2.x
             + t * t * t * p3.x)
        y = (u * u * u * p0.y
             + 3 * u * u * t * p1.y
             + 3 * u * t * t * p2.y
             + t * t * t * p3.y)
        append_pt((pt_to_mm(x), pt_to_mm(y)))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "uso: parse_template.py <pdf> [--double-sided]"}))
        sys.exit(2)
    pdf_path = sys.argv[1]
    doble_faz = "--double-sided" in sys.argv[2:]
    result = parse_pdf(pdf_path, doble_faz=doble_faz)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
