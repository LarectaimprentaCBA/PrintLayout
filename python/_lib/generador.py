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

HEADER_CON_MARCAS = (
    "IN FSIZE{W},{H} "
    "CMD:32,19000,13000,{m},{m};"
    "CMD:18,1;"
    "CMD:103,0;"
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
                                 blade_offset_mm=BLADE_OFFSET_DEFAULT_MM):
    """
    Modo con marcas de registro (TB26). Para print-and-cut donde imprimis
    la hoja con marcas y el plotter las escanea antes de cortar.

    ancho_pagina_mm / alto_pagina_mm = tamanio de la VENTANA INTERIOR
    delimitada por las marcas L (== hoja_fisica - 2 * margen_marcas).

    margen_marcas_mm = distancia entre el borde de la hoja fisica y la
    marca L mas cercana. Va en el segundo par de CMD:32 (defecto 10mm,
    que es lo que tenian todas las capturas historicas).

    Park final = (W+200, 200) (constante observada).
    """
    W = mm_a_unidades(ancho_pagina_mm)
    H = mm_a_unidades(alto_pagina_mm)
    m = mm_a_unidades(margen_marcas_mm)
    header = HEADER_CON_MARCAS.format(W=W, H=H, m=m)
    movs = generar_movimientos(polilineas_mm)
    park = f" U{W + 200},200"
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
