"""
Extrae imagenes raster embebidas en un PDF usando PyMuPDF.

Uso:
  python extract_pdf_images.py <pdf_path> <out_dir>

Salida JSON por stdout:
  {
    "ok": true,
    "images": [
      {
        "xref": int,
        "ext": "jpg" | "png",
        "width": int,
        "height": int,
        "path": "<out_dir>/img_<xref>.<ext>",
        "thumbBase64": "...",   # PNG base64, max 200px de lado
        "placements": int,
        "sizeBytes": int
      },
      ...
    ]
  }

Las imagenes en formatos exoticos (jp2, jb2, etc) se re-renderizan a PNG para
que el navegador las pueda mostrar.

En caso de error:
  { "ok": false, "error": "..." }
"""
import base64
import json
import os
import sys
import traceback

import fitz

THUMB_MAX_PX = 400
SUPPORTED_DIRECT = {"jpeg", "jpg", "png"}


def make_thumb_png(doc, xref):
    pix = fitz.Pixmap(doc, xref)
    if pix.colorspace and pix.colorspace.n >= 4:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    max_dim = max(pix.width, pix.height)
    n = 0
    while max_dim > THUMB_MAX_PX:
        max_dim = (max_dim + 1) // 2
        n += 1
    if n > 0:
        pix.shrink(n)
    return pix.tobytes("png")


def count_placements(doc, xref):
    total = 0
    for page in doc:
        try:
            rects = page.get_image_rects(xref)
            total += len(rects)
        except Exception:
            for entry in page.get_images(full=True):
                if entry[0] == xref:
                    total += 1
    return total


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Uso: extract_pdf_images.py <pdf> <out_dir>"}))
        return 0

    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"No se pudo abrir PDF: {e}"}))
        return 0

    try:
        seen_xrefs = []
        seen_set = set()
        for page in doc:
            for entry in page.get_images(full=True):
                xref = entry[0]
                if xref in seen_set:
                    continue
                seen_set.add(xref)
                seen_xrefs.append(xref)

        results = []
        for xref in seen_xrefs:
            try:
                info = doc.extract_image(xref)
            except Exception:
                continue
            if not info or not info.get("image"):
                continue

            raw_ext = (info.get("ext") or "png").lower()
            if raw_ext in SUPPORTED_DIRECT:
                ext = "jpg" if raw_ext == "jpeg" else raw_ext
                img_bytes = info["image"]
            else:
                try:
                    pix = fitz.Pixmap(doc, xref)
                    if pix.colorspace and pix.colorspace.n >= 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    img_bytes = pix.tobytes("png")
                    ext = "png"
                except Exception:
                    continue

            width = info.get("width") or 0
            height = info.get("height") or 0
            file_name = f"img_{xref}.{ext}"
            file_path = os.path.join(out_dir, file_name)
            with open(file_path, "wb") as f:
                f.write(img_bytes)

            try:
                thumb_bytes = make_thumb_png(doc, xref)
                thumb_b64 = base64.b64encode(thumb_bytes).decode("ascii")
            except Exception:
                thumb_b64 = ""

            placements = count_placements(doc, xref)

            results.append({
                "xref": xref,
                "ext": ext,
                "width": width,
                "height": height,
                "path": file_path,
                "thumbBase64": thumb_b64,
                "placements": placements,
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
