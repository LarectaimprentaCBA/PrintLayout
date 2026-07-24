"""
Renderiza las PIEZAS de un PDF: cada imagen embebida se rinde recortando esa
REGION de la pagina (a `dpi`), de modo que el resultado incluye lo que este
dibujado ENCIMA (texto/logos vectoriales). Resuelve el caso "el PDF trae una
tira de stickers y las imagenes embebidas salen en blanco" porque el fondo
(circulo) es un raster pero el diseno esta en vectorial arriba: extraer el
raster crudo da el circulo vacio; renderizar la region da el sticker completo.

Uso:
  python render_pdf_regions.py <pdf_path> <out_dir> [dpi]

Salida JSON por stdout (mismo shape que extract_pdf_images.py para reusar el
flujo del renderer):
  {
    "ok": true,
    "images": [
      { "xref", "ext":"png", "width", "height", "path",
        "thumbBase64", "placements":1, "placementMm":{w,h}, "sizeBytes" },
      ...
    ]
  }
En error: { "ok": false, "error": "..." }
"""
import base64
import json
import os
import sys
import traceback

import fitz

THUMB_MAX_PX = 400
PT_TO_MM = 25.4 / 72.0
DEFAULT_DPI = 300
MIN_SIDE_PT = 4.0            # rects mas chicos que esto se ignoran (basura)
OVERLAP_MERGE_FRAC = 0.25    # dos rects se funden si se solapan > 25% del menor


def rect_area(r):
    return max(0.0, r.width) * max(0.0, r.height)


def overlap_area(a, b):
    inter = a & b  # interseccion (Rect); vacio => width/height <= 0
    if inter.is_empty or inter.width <= 0 or inter.height <= 0:
        return 0.0
    return inter.width * inter.height


def should_merge(a, b):
    ov = overlap_area(a, b)
    if ov <= 0:
        return False
    smaller = min(rect_area(a), rect_area(b))
    if smaller <= 0:
        return False
    return (ov / smaller) >= OVERLAP_MERGE_FRAC


def cluster_rects(rects):
    # Union-find sobre rects de la MISMA pagina que se solapan lo suficiente.
    n = len(rects)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for i in range(n):
        for j in range(i + 1, n):
            if rects[i][0] != rects[j][0]:
                continue  # distinta pagina
            if should_merge(rects[i][1], rects[j][1]):
                union(i, j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    regions = []
    for members in groups.values():
        page = rects[members[0]][0]
        u = fitz.Rect(rects[members[0]][1])
        for m in members[1:]:
            u |= rects[m][1]  # union de bounding boxes
        regions.append((page, u))
    return regions


def make_thumb_png_from_pixmap(pix):
    max_dim = max(pix.width, pix.height)
    n = 0
    while max_dim > THUMB_MAX_PX:
        max_dim = (max_dim + 1) // 2
        n += 1
    if n > 0:
        pix = fitz.Pixmap(pix)  # copia mutable
        pix.shrink(n)
    return pix.tobytes("png")


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Uso: render_pdf_regions.py <pdf> <out_dir> [dpi]"}))
        return 0

    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    try:
        dpi = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_DPI
    except Exception:
        dpi = DEFAULT_DPI
    dpi = max(72, min(600, dpi))
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"No se pudo abrir PDF: {e}"}))
        return 0

    try:
        rects = []  # [(page_index, fitz.Rect), ...]
        for pno, page in enumerate(doc):
            seen = set()
            for entry in page.get_images(full=True):
                xref = entry[0]
                if xref in seen:
                    continue
                seen.add(xref)
                try:
                    for r in page.get_image_rects(xref):
                        rr = fitz.Rect(r)
                        if rr.width >= MIN_SIDE_PT and rr.height >= MIN_SIDE_PT:
                            rects.append((pno, rr))
                except Exception:
                    continue

        if not rects:
            print(json.dumps({"ok": True, "images": []}))
            return 0

        regions = cluster_rects(rects)
        # Orden de lectura: por fila (y) y despues por columna (x). Toleramos
        # pequenas diferencias de y agrupando en bandas del alto tipico.
        typical_h = sorted(rect_area(r) ** 0.5 for _, r in regions)[len(regions) // 2]
        band = max(1.0, typical_h * 0.5)
        regions.sort(key=lambda pr: (pr[0], round(pr[1].y0 / band), pr[1].x0))

        mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
        results = []
        for idx, (pno, rect) in enumerate(regions):
            page = doc[pno]
            try:
                pix = page.get_pixmap(matrix=mat, clip=rect, alpha=False)
            except Exception:
                continue
            if pix.width <= 0 or pix.height <= 0:
                continue
            img_bytes = pix.tobytes("png")
            file_name = f"region_{idx}.png"
            file_path = os.path.join(out_dir, file_name)
            with open(file_path, "wb") as f:
                f.write(img_bytes)
            try:
                thumb_b64 = base64.b64encode(make_thumb_png_from_pixmap(pix)).decode("ascii")
            except Exception:
                thumb_b64 = ""
            results.append({
                "xref": f"region_{idx}",
                "ext": "png",
                "width": pix.width,
                "height": pix.height,
                "path": file_path,
                "thumbBase64": thumb_b64,
                "placements": 1,
                "placementMm": {
                    "w": round(rect.width * PT_TO_MM, 2),
                    "h": round(rect.height * PT_TO_MM, 2),
                },
                "sizeBytes": len(img_bytes),
            })

        print(json.dumps({"ok": True, "images": results}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
        return 0
    finally:
        try:
            doc.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
