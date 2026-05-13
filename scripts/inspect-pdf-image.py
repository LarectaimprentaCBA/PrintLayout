"""Inspecciona la primera imagen embebida en un PDF, muestra:
- tamano y color space declarado
- muestreo de pixeles en distintas zonas (esquinas + centro)
- si el blanco snappeado de PrintLayout llego a (255,255,255) o esta corrido.

Uso: python inspect-pdf-image.py <ruta.pdf>
"""
import sys
import fitz

def main():
    if len(sys.argv) < 2:
        print("Uso: python inspect-pdf-image.py <ruta.pdf>")
        sys.exit(1)
    pdf_path = sys.argv[1]
    doc = fitz.open(pdf_path)
    print(f"PDF: {pdf_path}")
    print(f"Paginas: {doc.page_count}")
    print()

    for page_idx in range(doc.page_count):
        page = doc[page_idx]
        images = page.get_images(full=True)
        print(f"--- Pagina {page_idx + 1}: {len(images)} imagen(es) embebida(s) ---")
        for img_idx, info in enumerate(images):
            xref = info[0]
            base = doc.extract_image(xref)
            ext = base.get("ext")
            colorspace = base.get("colorspace")
            cs_name = base.get("cs-name", "?")
            data = base["image"]
            print(f"  Imagen {img_idx+1} (xref {xref}): ext={ext}, colorspace={colorspace}, cs-name={cs_name}, bytes={len(data)}")
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.colorspace and pix.colorspace.name != "DeviceRGB":
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                w, h = pix.width, pix.height
                print(f"    Decodificada: {w}x{h} colorspace={pix.colorspace.name} n={pix.n} alpha={pix.alpha}")
                samples_buf = pix.samples
                stride = pix.stride
                n = pix.n

                def get(x, y):
                    off = y * stride + x * n
                    r = samples_buf[off]
                    g = samples_buf[off+1] if n >= 3 else r
                    b = samples_buf[off+2] if n >= 3 else r
                    return r, g, b

                samples = [
                    (0, 0, "top-left"),
                    (w-1, 0, "top-right"),
                    (0, h-1, "bot-left"),
                    (w-1, h-1, "bot-right"),
                    (w//2, 5, "top-mid"),
                    (5, h//2, "left-mid"),
                    (w-6, h//2, "right-mid"),
                    (w//2, h-6, "bot-mid"),
                    (w//2, h//2, "center"),
                ]
                for x, y, name in samples:
                    r, g, b = get(x, y)
                    print(f"    {name:10} ({x:5},{y:5}): R={r} G={g} B={b}")
                pure_white = 0
                near_white = 0
                other = 0
                step = max(1, w // 200)
                for y in range(0, h, step):
                    for x in range(0, w, step):
                        r, g, b = get(x, y)
                        if r == 255 and g == 255 and b == 255:
                            pure_white += 1
                        elif min(r, g, b) >= 250:
                            near_white += 1
                        else:
                            other += 1
                total = pure_white + near_white + other
                if total:
                    print(f"    Sampleo (cada {step}px): pure_white={pure_white} ({pure_white*100//total}%), near_white={near_white} ({near_white*100//total}%), other={other} ({other*100//total}%)")
            except Exception as exc:
                print(f"    Error decodificando: {exc}")
        print()
    # Tambien verificar si el PDF declara output intent / color profile
    print("--- Catalog metadata ---")
    catalog = doc.pdf_catalog()
    cat = doc.xref_object(catalog, compressed=False)
    if "OutputIntent" in cat:
        print("  Tiene /OutputIntents")
    else:
        print("  Sin /OutputIntents")
    doc.close()

if __name__ == "__main__":
    main()
