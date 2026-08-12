"""
Generador de payload para el plotter A3 Max 4 Pro.

Formato descubierto por captura de tráfico de AIDCut/CutToolPro.exe:

    IN FSIZE<W>,<H> CMD:32,19000,13000,400,400;CMD:18,1;CMD:103,0;CMD:35,2,1,0;TB26,<W>,<H>
     U-19,20 D-19,20 D-19,40 U-19,40
     <movimientos del trabajo>
     @ @

Unidades: 1 plotter unit = 0.025 mm (1/40 mm).
"""

UNITS_PER_MM = 40

# Headers descubiertos por captura. Los CMD: que aparecen son constantes
# para esta maquina; los que cambian segun el job estan parametrizados.

# CMD:32 lleva el tamaño de la HOJA FÍSICA (primer par) = ventana interior +
# 2*margen. ANTES estaba hardcodeado 19000,13000 (≈Super A3): coincidía de casualidad
# con las hojas Super A3 (Dobble) y andaba, pero con una hoja más chica (ej. A4) el
# plotter cree que la hoja es 475×325mm y el cabezal se mueve como para esa hoja
# gigante (registración corrida/rotada). Verificado contra .plt reales de Corel:
# cartas/Caja (interior 452×302) traen CMD:32 = 472×322 = interior + 20mm.

# CMD:103 = tipo de marca de registro. Descubierto comparando capturas:
#   0 = marcas L (esquineras)      5 = marcas de circulo relleno
# Verificado contra .plt del plugin de Corel con circulos (2026-08-12).
MARK_TYPE_L = 0
MARK_TYPE_CIRCULO = 5

HEADER_CON_MARCAS = (
    "IN FSIZE{W},{H} "
    "CMD:32,{SW},{SH},{m},{m};"
    "CMD:18,1;"
    "CMD:103,{mt};"
    "CMD:35,2,1,0;"
    "TB26,{W},{H} "
)
HEADER_SIN_MARCAS = (
    "IN FSIZE{W},{H} "
    "CMD:32,{W},{H},{a},{b};"
    "CMD:35,2,1,0;"
)

# Blade offset por default cuando no se especifica. Antes estaba hardcoded
# como U-19,20 D-19,20 D-19,40 U-19,40 (= 0.50 mm) por captura historica.
BLADE_OFFSET_DEFAULT_MM = 0.25

FIN_CON_MARCAS = " @ @ "
FIN_SIN_MARCAS = " @ "


def mm_a_unidades(mm: float) -> int:
    return round(mm * UNITS_PER_MM)


def prueba_cuchilla(offset_mm: float = BLADE_OFFSET_DEFAULT_MM) -> str:
    """Trazo previo al corte que el plotter interpreta como configuracion
    del blade offset (la distancia entre el centro de giro del cabezal y
    la punta de la cuchilla; el firmware lo usa para compensar curvas).

    Patron descubierto comparando capturas del plugin de Corel:
        N = round(offset_mm * 40)
        "U-(N-1),N D-(N-1),N D-(N-1),2N U-(N-1),2N"

    Es decir: al inicio del job se manda un "trazo de prueba" cuyo largo
    codifica el offset. No es un movimiento fisico de corte util; es la
    forma en que esta familia de plotters configura el offset.
    """
    n = mm_a_unidades(offset_mm)
    if n < 1:
        n = 1
    return f"U-{n - 1},{n} D-{n - 1},{n} D-{n - 1},{2 * n} U-{n - 1},{2 * n} "


# Compat: algunos tests/scripts viejos importan este nombre. Mantiene el
# valor historico de 0.50 mm para no romperlos. Los entrypoints nuevos
# deben usar prueba_cuchilla(offset_mm).
PRUEBA_CUCHILLA = prueba_cuchilla(0.50)


def generar_movimientos(polilineas_mm):
    """
    polilineas_mm: lista de polilineas. Cada polilinea es una lista de
    (x_mm, y_mm). El formato del plotter es:
        U<start> D<p2> D<p3> ... D<pN> U<pN>
    El U final de cada polilinea es un "subir cuchilla en sitio" que termina
    la figura (sin el U final el plotter no separa figuras correctamente).
    """
    partes = []
    for poly in polilineas_mm:
        if len(poly) < 2:
            continue
        x, y = poly[0]
        partes.append(f"U{mm_a_unidades(x)},{mm_a_unidades(y)}")
        for x, y in poly[1:]:
            partes.append(f"D{mm_a_unidades(x)},{mm_a_unidades(y)}")
        x, y = poly[-1]
        partes.append(f"U{mm_a_unidades(x)},{mm_a_unidades(y)}")
    return " ".join(partes)


def generar_payload_con_marcas(polilineas_mm, ancho_pagina_mm, alto_pagina_mm,
                                 margen_marcas_mm=10,
                                 blade_offset_mm=BLADE_OFFSET_DEFAULT_MM,
                                 mark_type=MARK_TYPE_CIRCULO):
    """
    Modo con marcas de registro (TB26). Para print-and-cut donde imprimis
    la hoja con marcas y el plotter las escanea antes de cortar.

    ancho_pagina_mm / alto_pagina_mm = tamanio de la VENTANA INTERIOR
    delimitada por las marcas (== hoja_fisica - 2 * margen_marcas).

    margen_marcas_mm = distancia entre el borde de la hoja fisica y la
    marca mas cercana. Va en el segundo par de CMD:32.

    mark_type = tipo de marca de registro (CMD:103). MARK_TYPE_CIRCULO (5,
    default nuevo) = circulos rellenos; MARK_TYPE_L (0) = marcas L de antes.

    Park final = (W, 0) (lo que manda el plugin de Corel).
    """
    W = mm_a_unidades(ancho_pagina_mm)
    H = mm_a_unidades(alto_pagina_mm)
    m = mm_a_unidades(margen_marcas_mm)
    # Hoja física = ventana interior + 2*margen (primer par de CMD:32).
    SW = W + 2 * m
    SH = H + 2 * m
    header = HEADER_CON_MARCAS.format(W=W, H=H, SW=SW, SH=SH, m=m, mt=int(mark_type))
    movs = generar_movimientos(polilineas_mm)
    park = f" U{W},0"
    txt = header + prueba_cuchilla(blade_offset_mm) + movs + park + FIN_CON_MARCAS
    return txt.encode("ascii")


def generar_payload_sin_marcas(polilineas_mm, ancho_pagina_mm, alto_pagina_mm,
                                cmd32_a, cmd32_b, park_x, park_y,
                                blade_offset_mm=BLADE_OFFSET_DEFAULT_MM):
    """
    Modo sin marcas. La maquina corta sin escanear nada.
    Args adicionales (cmd32_a, cmd32_b, park_x, park_y) todavia no
    decodificados: por ahora se piden explicitos para que el round-trip
    funcione. Capturando mas jobs sin marcas voy a deducir su formula.
    """
    W = mm_a_unidades(ancho_pagina_mm)
    H = mm_a_unidades(alto_pagina_mm)
    header = HEADER_SIN_MARCAS.format(W=W, H=H, a=cmd32_a, b=cmd32_b)
    movs = generar_movimientos(polilineas_mm)
    park = f" U{park_x},{park_y}"
    txt = header + prueba_cuchilla(blade_offset_mm) + movs + park + FIN_SIN_MARCAS
    return txt.encode("ascii")


# Alias por compatibilidad con tests viejos
def generar_payload(polilineas_mm, ancho_pagina_mm, alto_pagina_mm):
    return generar_payload_con_marcas(polilineas_mm, ancho_pagina_mm, alto_pagina_mm)
