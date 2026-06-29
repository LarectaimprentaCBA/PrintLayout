# PrintLayout

**Imposición, impresión y corte automatizado para imprentas chicas.**

Una app de escritorio (Windows) que reemplaza la maraña de Corel + Photoshop + Foxit + el software del plotter por **una sola herramienta** pensada para el día a día de una imprenta: cargar fotos, acomodarlas en una hoja, mandar a impresión y cortar — todo en menos de un minuto.

---

## El problema que resuelve

En una imprenta chica el flujo típico para imprimir y cortar tarjetas / Polaroids / stickers es:

1. Diseñar una plantilla en Corel con cajas de posicionado y marcas de corte.
2. Exportar PDF para imprimir.
3. Generar un archivo de corte aparte para mandar al plotter.
4. Cada vez que entra un trabajo nuevo: editar el Corel, reemplazar fotos a mano, recortarlas para que entren en las cajas, exportar PDF de nuevo, alinear, imprimir, cortar.

Eso son **15–30 minutos por trabajo** y un montón de oportunidades para equivocarse: una foto rotada al revés, una cara cortada al medio, marcas de corte que no coinciden con el plotter, una hoja con el tamaño equivocado, copias que se quedaron en el driver y pisan el default del sistema.

PrintLayout elimina esos pasos manuales.

---

## Cómo funciona en la práctica

**Cargás una plantilla** (PDF con 3 páginas: la base imprimible + cajas + cortes vectoriales) o creás una al vuelo desde la app (grilla rápida, por tamaño, por cantidad por hoja).

**Tirás las fotos al sidebar** (drag & drop, copy/paste, o desde un PDF de Corel) y la app:
- Detecta caras y centra el crop alrededor del rostro.
- Rota automáticamente si la foto está al revés respecto a la plantilla.
- Te avisa si una foto no entra y propone soluciones (extender bordes con espejo, replicar, color sólido, 9-slice).

**Asignás las fotos a las celdas** (drag & drop, click, o "Repartir parejo" con un botón).

**Imprimís** — la app abre el diálogo nativo de Windows con tu impresora ya seleccionada, tocás Preferencias del driver si querés, y al imprimir **los cambios del driver no quedan pisados como default del sistema** (igual que hace Adobe Reader, no como Chromium o Electron por defecto).

**Cortás** — un click manda los cortes al plotter por TCP/IP en formato HPGL, con offset de cuchilla configurable.

---

## Funcionalidades destacadas

### Imposición flexible

- **Plantillas con cortes vectoriales**: PDFs con marcas de corte + cajas de posicionado. Se sincronizan entre PCs vía GitHub (todo el equipo ve las mismas).
- **Grilla rápida**: filas × columnas con tamaño de hoja libre, en memoria. Sin necesidad de hacer una plantilla nueva en Corel.
- **Acomodar por tamaño**: indicás "alto = 50 mm" o "ancho = 90 mm", subís fotos, y la app calcula cuántas entran por hoja y cuántas hojas necesita.
- **Acomodar por cantidad**: "quiero 9 copias por hoja al máximo tamaño posible" → la app calcula la grilla óptima.
- **Plantillas con celdas distintas por hoja**: para trabajos multi-página con diferentes layouts.
- **Doble faz**: una plantilla puede tener frente y dorso. El export es un PDF de 2 páginas; el dorso se imprime espejado en X para que al voltear caiga alineado.
- **Carpetas** para agrupar plantillas y un sub-modal tipo file-explorer para encontrarlas rápido.

### Edición de imágenes integrada

- **Detección de caras** con face-api.js — auto-zoom centra el rostro en la celda.
- **Auto-rotate al cargar** si la imagen está en orientación opuesta a la celda.
- **5 métodos de extensión de bordes** para hacer entrar imágenes que son más chicas que la celda:
  - Espejo (mirror)
  - Replicar borde
  - Color sólido (con pipeta para tomar del fondo)
  - 9-slice (centro fijo, 8 sectores estirados)
  - Encoger contenido + rellenar el bleed con cualquiera de los anteriores
- **Recorte manual** (rectangular o forma libre poligonal) con detección automática de bordes para tarjetas con marco uniforme.
- **Sangrado, zona segura y línea de corte** visibles como overlays sobre la celda, con snap automático al corte.
- **Extracción de imágenes desde PDF**: subís un PDF de Corel y la app saca cada imagen embebida (xref único, sin duplicados, con tamaño físico real) para que las puedas usar directo.

### Impresión sin pisar el sistema

- Diálogo nativo de Windows con elección de impresora y copias.
- Si tocás Preferencias del driver (calidad, papel, bandeja, duplex), **esos cambios viven solo en ese trabajo**. No pisan el default del sistema, no afectan al resto de las apps.
- Logrado con un helper nativo (.NET / `System.Windows.Forms.PrintDialog`) + snapshot+restore del DEVMODE global y per-usuario antes y después de cada impresión. Es la misma técnica de Adobe Reader / Word / Notepad.

### Corte automatizado

- Comunicación TCP/IP con el plotter (A3 Max 4 Pro probado; protocolo HPGL estándar).
- Reemplazo del software propietario del plotter (CUTTER / AIDCut) con código propio integrado.
- **Offset de cuchilla configurable** desde la barra superior (persistido por PC).
- **Marcas L de registro** auto-generadas para que el plotter alinee el corte con lo impreso.

### Trabajos guardados (.pljob)

- Cualquier estado (plantilla + imágenes + asignaciones + opciones) se guarda como un archivo `.pljob` donde el usuario quiera (carpeta por cliente, fecha, lo que sea).
- Doble click en un `.pljob` abre la app en ese estado exacto.
- Ctrl+S sobreescribe el mismo archivo.
- Tabs estilo Corel / Photoshop para tener varios trabajos abiertos en simultáneo.
- Auto-save: si la app crashea o cerrás sin guardar, al reabrir tenés todo restaurado.

### Calidad de vida

- **Auto-update** vía GitHub Releases con instalador NSIS firmado (cert self-signed importable a las PCs internas).
- **Sync de plantillas** entre PCs via repo GitHub privado — todo el equipo tiene la misma biblioteca.
- **Undo / Redo** con stack de 50 pasos por tab.
- **Atajos de teclado**: Ctrl+S guardar, Ctrl+O abrir, Ctrl+T nuevo trabajo, Ctrl+W cerrar tab, Ctrl+Tab cambiar tab, Ctrl+1..9 ir a tab N.
- **Drag-to-reorder** de tabs.
- **Right-click menu** en cada tab (renombrar / guardar como / cerrar otras / cerrar todas).
- **Configurar el tamaño físico de hoja** por trabajo, distinto al de la plantilla — para cuando el papel cargado en la impresora no es exactamente el de diseño.
- **Warning antes de cerrar** la app si hay trabajos con cambios sin guardar.

---

## Casos de uso reales

- **Tarjetas personales**: 12 tarjetas (90×50 mm) en una hoja A4 con corte y rebleed.
- **Polaroids** (8×5 cm) o cuadradas (10×14, 9,5×9,5 cm) con marcos de color, fondo, etc.
- **Stickers troquelados** de forma libre con plotter.
- **Fotos para enmarcar**: una sesión de 30 fotos auto-acomodadas en N hojas A3 al máximo tamaño posible respetando aspect ratio.
- **Imprimir tarjetas de un PDF que ya hizo el diseñador**: la app extrae las imágenes del PDF (sin redibujar nada), las reacomoda en una nueva grilla y agrega corte.

---

## Stack técnico

- **Electron 31** (main process + preload + renderer)
- **React 18 + Vite 5 + Tailwind**
- **Python embebido 3.11** (PyMuPDF para parsing de PDF y envío al plotter)
- **C# / .NET 4.x** (`PrintHelper.exe` para impresión en document mode)
- **pdf-lib + pdfjs-dist** (export e import de PDFs)
- **face-api.js** (detección de caras con SSD MobileNetV1)
- **@dnd-kit** (drag and drop)
- **electron-builder** (instalador NSIS + auto-update)
- **electron-updater** (auto-update vía GitHub Releases)

Todo el bundle es **un único instalador `.exe` de ~135 MB** que no requiere instalar Python ni nada más en la PC destino. Doble click → instalada → andando.

---

## Diferenciadores

| Vs. usar Corel + scripts | PrintLayout |
|---|---|
| 15–30 min por trabajo | 1–3 min por trabajo |
| Mover fotos manualmente | Drag & drop o auto-acomodar |
| Recortar caras a mano | Auto-zoom con detección de caras |
| Generar archivo de corte aparte | Un click → al plotter |
| Driver pisa el default del sistema | Document mode aislado |
| Cambios se pierden si crashea | Auto-save + restore al reabrir |

---

## Estado del proyecto

- **Versión actual**: v0.1.28 (mayo 2026).
- **En producción** en La Recta Imprenta (Córdoba, AR) desde mayo 2026.
- Auto-update activo: las PCs se actualizan solas cuando hay release nueva.
- Firma de código self-signed (cert propio importable a las PCs internas para evitar bloqueos del AV).
