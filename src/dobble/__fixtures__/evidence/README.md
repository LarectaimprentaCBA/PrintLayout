# Evidencia E2E — posado Dobble sobre plantilla

PDFs reales generados sin tocar diálogos nativos, con el **mismo renderer del motor
(vendor)** y la **misma geometría que `buildDobbleJob`**. Posan el mazo fixture
[`../mazo-n3.receta.json`](../mazo-n3.receta.json) (n=3, 13 cartas, engine 0.4.0)
sobre una plantilla redonda A4 (celda ⌀ 71 mm, margen de corte 3 mm → **carta ⌀ 65 mm,
sangrado 3 mm**), 6 por hoja → **3 hojas**.

| Archivo | Fondo de carta |
|---|---|
| `dobble-n3-color.pdf` | color sólido (`#ffe2a8`) |
| `dobble-n3-imagen.pdf` | imagen ([`../fondo-prueba.png`](../fondo-prueba.png)) recortada al círculo + sangrado, detrás de los símbolos |

Cada hoja muestra: la **grilla** posada, los **círculos de corte** (punteado fucsia, ⌀ = ⌀ carta)
y las **marcas L de registro** en las 4 esquinas (a 10 mm del borde).

## Combo Dobble de 3 hojas (camino QR/tarjetas)

`dobble-combo-3hojas.pdf` — combo SINTÉTICO `pages=[A,A,B]` **doble faz** (los PDF reales
los aporta Mariano). **6 páginas** = 3 frentes + 3 dorsos, como produce `buildDoubleSidedPdf`.
Demuestra: **posado multi-hoja** en orden, **FONDO POR HOJA** (frentes 1-2 "FONDO A",
frente 3 "FONDO B" — cada uno con su QR simulado), **doble faz** (dorso compartido en las
celdas `card`, espejado en X, sin fondo), **instrucciones horneadas en el fondo** de la
hoja 3 (no celda) y **caja EN BLANCO** (MVP — la corta/pliega el plotter por QR). El
relleno de caja color/imagen queda para más adelante (fuera del MVP).

## Regenerar

```
npm run test:dobble            # smoke test puro (geometría + grilla + cortes + assignments + combo por rol)
npm run evidence:dobble         # PDFs del posado sobre plantilla redonda (fondo color / imagen)
npm run evidence:dobble-combo   # PDF del combo de 3 hojas (fondo por hoja + roles + caja)
```

> Nota: el export/print/plotter de la app es el pipeline normal de PrintLayout (sin cambios):
> una vez posado, el mazo es una plantilla común + imágenes. Estos PDF son evidencia del
> posado/imposición; el corte físico se valida en el plotter.
