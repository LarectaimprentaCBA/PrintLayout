"""
Parsea un PDF de "modelo de rotulo escolar" exportado desde Corel.

Formato (Mariano lo arma en Corel): paginas en grupos de 3, en orden de tamanio
grande -> intermedio -> chico. Cada grupo describe UN tamanio con 3 paginas:
  - pagina ARTE : imagen raster embebida (el fondo, con 1mm de demasia/bleed).
  - pagina CORTE: rectangulo redondeado (contorno, con curvas) — solo para
                  verificar el tamanio; el corte real es fijo, no se genera aca.
  - pagina TEXTO: rectangulo simple (sin curvas) que marca donde va el nombre.
Las 3 paginas de un tamanio comparten sistema de coordenadas (todo centrado y
registrado sobre la misma hoja A4), asi que el corte, el arte y la caja de texto
son concentricos.

Este script NO genera nada: solo EXTRAE, por tamanio:
  - la imagen de arte (se guarda a <out_dir>/<tamanio>.<ext> a full resolucion),
  - un preview PNG chico en base64 para mostrar en la UI,
  - el bbox del arte, del corte y de la caja de texto (mm, origen top-left),
  - la caja de texto RELATIVA al corte (rotulo): {xFromLabelLeft, yFromLabelTop,
    w, h} en mm — que es lo que despues usa el generador.

Mapea los 3 grupos a grande/intermedio/chico por area de corte descendente y
verifica contra los tamanios fijos del sistema (tolerancia ~1mm); si algo no
matchea, lo reporta en "warnings" y en size.matched (no falla).

Uso:  python parse_rotulo_model.py <pdf_path> <out_dir>
Salida: JSON por stdout.
"""
import base64
import json
import os
import sys
import traceback

import fitz

# 1 punto PDF = 1/72 inch. 1 inch = 25.4 mm.
PT_TO_MM = 25.4 / 72.0

# Drawings con lado menor a esto se descartan (ruido / lineas degeneradas).
MIN_LADO_MM = 0.4

# Preview para el editor: PNG max 800px de lado. Thumb chico para la lista.
PREVIEW_MAX_PX = 800
THUMB_MAX_PX = 220

SUPPORTED_DIRECT = {"jpeg", "jpg", "png"}

# Tamanios fijos del sistema (corte, en mm) para verificar el modelo.
# nombre -> (corte_w, corte_h, arte_w, arte_h)
TAMANIOS_FIJOS = {
    "grande":     {"cutW": 60.0, "cutH": 40.0, "artW": 62.0, "artH": 42.0},
    "intermedio": {"cutW": 40.0, "cutH": 20.0, "artW": 42.0, "artH": 22.0},
    "chico":      {"cutW": 40.0, "cutH": 7.0,  "artW": 42.0, "artH": 9.0},
}
ORDEN_TAMANIOS = ["grande", "intermedio", "chico"]
TOLERANCIA_MM = 1.0


def mm(v):
    return round(v * PT_TO_MM, 2)


def rect_area_mm(rect):
    return (rect.width * PT_TO_MM) * (rect.height * PT_TO_MM)


def bbox_mm(rect):
    return {
        "x": mm(rect.x0),
        "y": mm(rect.y0),
        "w": round(rect.width * PT_TO_MM, 2),
        "h": round(rect.height * PT_TO_MM, 2),
    }


def largest_drawing(page):
    """Devuelve (rect, n_curvas) del drawing de mayor area, o (None, 0)."""
    best = None
    best_area = -1.0
    best_curvas = 0
    for d in page.get_drawings():
        rect = d.get("rect")
        if rect is None:
            continue
        w_mm = rect.width * PT_TO_MM
        h_mm = rect.height * PT_TO_MM
        if w_mm < MIN_LADO_MM or h_mm < MIN_LADO_MM:
            continue
        area = w_mm * h_mm
        if area > best_area:
            best_area = area
            best = rect
            best_curvas = sum(1 for it in d.get("items", []) if it and it[0] == "c")
    return best, best_curvas


def image_placement(page):
    """Devuelve (xref, rect) de la imagen mas grande de la pagina, o (None, None)."""
    best_xref = None
    best_rect = None
    best_area = -1.0
    for entry in page.get_images(full=True):
        xref = entry[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for r in rects:
            area = rect_area_mm(r)
            if area > best_area:
                best_area = area
                best_xref = xref
                best_rect = r
    return best_xref, best_rect


def clasificar_grupo(doc, pages):
    """
    Dado un grupo (lista de indices de pagina), decide cual es arte, corte y texto.
      - arte  = pagina con imagen embebida.
      - corte = de las vectoriales, la de MAYOR area (el corte encierra al texto);
                desempate secundario: la que tiene curvas (rect redondeado).
      - texto = la vectorial de menor area.
    Devuelve dict {arte:{xref,rect}, corte:{rect}, texto:{rect}} (rects en pt) o None.
    """
    arte = None
    vectoriales = []  # (rect, curvas, page_idx)
    for idx in pages:
        page = doc[idx]
        xref, irect = image_placement(page)
        if xref is not None and irect is not None:
            if arte is None:
                arte = {"xref": xref, "rect": irect}
                continue
        drect, curvas = largest_drawing(page)
        if drect is not None:
            vectoriales.append((drect, curvas, idx))

    if arte is None or len(vectoriales) < 2:
        return None

    # Ordenar vectoriales por area descendente; la mayor = corte, la menor = texto.
    vectoriales.sort(key=lambda v: v[0].width * v[0].height, reverse=True)
    corte_rect = vectoriales[0][0]
    texto_rect = vectoriales[-1][0]
    return {"arte": arte, "corte": corte_rect, "texto": texto_rect}


def _pix_b64(doc, xref, max_px):
    pix = fitz.Pixmap(doc, xref)
    if pix.colorspace and pix.colorspace.n >= 4:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    max_dim = max(pix.width, pix.height)
    n = 0
    while max_dim > max_px:
        max_dim = (max_dim + 1) // 2
        n += 1
    if n > 0:
        pix.shrink(n)
    png = pix.tobytes("png")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def preview_b64(doc, xref, max_px=PREVIEW_MAX_PX):
    try:
        return _pix_b64(doc, xref, max_px)
    except Exception:
        return ""


def guardar_arte(doc, xref, out_dir, base_name):
    """Guarda la imagen de arte a full resolucion. Devuelve (path, ext, w, h) o None."""
    try:
        info = doc.extract_image(xref)
    except Exception:
        info = None
    if info and info.get("image"):
        raw_ext = (info.get("ext") or "png").lower()
        if raw_ext in SUPPORTED_DIRECT:
            ext = "jpg" if raw_ext == "jpeg" else raw_ext
            img_bytes = info["image"]
            width = info.get("width") or 0
            height = info.get("height") or 0
            path = os.path.join(out_dir, base_name + "." + ext)
            with open(path, "wb") as f:
                f.write(img_bytes)
            return path, ext, width, height
    # Fallback: rasterizar a PNG.
    try:
        pix = fitz.Pixmap(doc, xref)
        if pix.colorspace and pix.colorspace.n >= 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        img_bytes = pix.tobytes("png")
        path = os.path.join(out_dir, base_name + ".png")
        with open(path, "wb") as f:
            f.write(img_bytes)
        return path, "png", pix.width, pix.height
    except Exception:
        return None


def parse(pdf_path, out_dir):
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo abrir el PDF: {e}"}

    n = len(doc)
    warnings = []
    if n < 3:
        return {"ok": False, "error": "El PDF tiene menos de 3 paginas. Se esperan grupos de 3 (arte, corte, texto)."}

    n_grupos = n // 3
    if n % 3 != 0:
        warnings.append(f"El PDF tiene {n} paginas; se esperan multiplos de 3. Se leen los primeros {n_grupos} grupos.")

    grupos = []
    for g in range(n_grupos):
        pages = [g * 3, g * 3 + 1, g * 3 + 2]
        clasif = clasificar_grupo(doc, pages)
        if clasif is None:
            warnings.append(f"Grupo {g + 1} (paginas {pages[0] + 1}-{pages[2] + 1}): no se reconocieron arte+corte+texto; se omite.")
            continue
        corte_bbox = bbox_mm(clasif["corte"])
        grupos.append({
            "clasif": clasif,
            "corteBbox": corte_bbox,
            "corteArea": corte_bbox["w"] * corte_bbox["h"],
        })

    if not grupos:
        doc.close()
        return {"ok": False, "error": "No se pudo reconocer ningun tamanio en el PDF."}

    # Ordenar por area de corte descendente -> grande, intermedio, chico.
    grupos.sort(key=lambda gr: gr["corteArea"], reverse=True)

    sizes = {}
    for i, gr in enumerate(grupos):
        nombre = ORDEN_TAMANIOS[i] if i < len(ORDEN_TAMANIOS) else f"extra{i}"
        clasif = gr["clasif"]
        arte_rect = clasif["arte"]["rect"]
        xref = clasif["arte"]["xref"]
        corte = bbox_mm(clasif["corte"])
        arte = bbox_mm(arte_rect)
        texto = bbox_mm(clasif["texto"])

        # Caja de texto relativa al corte (rotulo).
        text_box = {
            "xFromLabelLeft": round(texto["x"] - corte["x"], 2),
            "yFromLabelTop": round(texto["y"] - corte["y"], 2),
            "w": texto["w"],
            "h": texto["h"],
        }

        # Guardar arte + preview.
        saved = guardar_arte(doc, xref, out_dir, nombre)
        arte_out = None
        if saved:
            path, ext, wpx, hpx = saved
            arte_out = {
                "path": path,
                "ext": ext,
                "wPx": wpx,
                "hPx": hpx,
                "previewB64": preview_b64(doc, xref, PREVIEW_MAX_PX),
                "thumbB64": preview_b64(doc, xref, THUMB_MAX_PX),
            }

        # Verificacion contra tamanios fijos.
        matched = True
        expected = TAMANIOS_FIJOS.get(nombre)
        if expected:
            if (abs(corte["w"] - expected["cutW"]) > TOLERANCIA_MM
                    or abs(corte["h"] - expected["cutH"]) > TOLERANCIA_MM):
                matched = False
                warnings.append(
                    f"El tamanio {nombre}: corte medido {corte['w']}x{corte['h']}mm "
                    f"no coincide con el esperado {expected['cutW']}x{expected['cutH']}mm."
                )

        sizes[nombre] = {
            "arte": arte_out,
            "arteMm": arte,
            "cutMm": corte,
            "textoMm": texto,
            "textBox": text_box,
            "matched": matched,
            "expected": expected,
        }

    doc.close()
    return {
        "ok": True,
        "pageCount": n,
        "groupCount": len(grupos),
        "sizes": sizes,
        "warnings": warnings,
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Uso: parse_rotulo_model.py <pdf> <out_dir>"}))
        return 0
    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    try:
        result = parse(pdf_path, out_dir)
    except Exception as e:
        result = {"ok": False, "error": str(e), "trace": traceback.format_exc()}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
