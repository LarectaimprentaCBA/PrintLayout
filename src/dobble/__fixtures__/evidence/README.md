# Evidencia E2E — posado Dobble sobre plantilla

PDFs reales generados sin tocar diálogos nativos, con el **mismo renderer del motor
(vendor)** y la **misma geometría que `buildDobbleJob`**. Posan el mazo fixture
[`../mazo-n3.receta.json`](../mazo-n3.receta.json) (n=3, 13 cartas, engine 0.3.0)
sobre una plantilla redonda A4 (celda ⌀ 71 mm, margen de corte 3 mm → **carta ⌀ 65 mm,
sangrado 3 mm**), 6 por hoja → **3 hojas**.

| Archivo | Fondo de carta |
|---|---|
| `dobble-n3-color.pdf` | color sólido (`#ffe2a8`) |
| `dobble-n3-imagen.pdf` | imagen ([`../fondo-prueba.png`](../fondo-prueba.png)) recortada al círculo + sangrado, detrás de los símbolos |

Cada hoja muestra: la **grilla** posada, los **círculos de corte** (punteado fucsia, ⌀ = ⌀ carta)
y las **marcas L de registro** en las 4 esquinas (a 10 mm del borde).

## Regenerar

```
npm run test:dobble       # smoke test puro (geometría + grilla + cortes + assignments)
npm run evidence:dobble    # regenera los PDF de esta carpeta (vía Electron printToPDF)
```

> Nota: el export/print/plotter de la app es el pipeline normal de PrintLayout (sin cambios):
> una vez posado, el mazo es una plantilla común + imágenes. Estos PDF son evidencia del
> posado/imposición; el corte físico se valida en el plotter.
