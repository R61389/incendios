# -*- coding: utf-8 -*-
"""Construye SIM522_ABP_G3_Fase3.docx a partir del informe de Fase 1-2."""
import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.shared import Cm
from docx.oxml import OxmlElement

SRC = "informe/SIM522_ABP_G3_Fase1-Fase2.docx"
OUT = "informe/SIM522_ABP_G3_Fase3.docx"
FIG = "Proyecto3_Incendios_Tunari/figuras/"

doc = docx.Document(SRC)
body = doc.element.body
NSW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def qp(tag):
    return '{%s}%s' % (NSW, tag)


# ---------- helpers básicos ----------

def find_para(text_contains, start=0, style=None):
    count = -1
    for el in body.iter(qn('w:p')):
        count += 1
        if count < start:
            continue
        p = Paragraph(el, doc)
        if text_contains in p.text:
            if style and p.style.name != style:
                continue
            return p
    raise ValueError(f"No se encontró párrafo con texto: {text_contains!r}")


def set_para_text(p, text):
    for r in list(p.runs):
        r._element.getparent().remove(r._element)
    p.add_run(text)


def new_para_after(anchor_el, text="", style=None):
    """anchor_el: elemento XML w:p. Devuelve Paragraph nuevo insertado justo después."""
    new_p_el = OxmlElement('w:p')
    anchor_el.addnext(new_p_el)
    new_p = Paragraph(new_p_el, doc)
    if style:
        new_p.style = doc.styles[style]
    if text:
        new_p.add_run(text)
    return new_p


def new_para_before(anchor_el, text="", style=None):
    new_p_el = OxmlElement('w:p')
    anchor_el.addprevious(new_p_el)
    new_p = Paragraph(new_p_el, doc)
    if style:
        new_p.style = doc.styles[style]
    if text:
        new_p.add_run(text)
    return new_p


def add_table_after(anchor_el, rows, cols, style='Tablaconcuadrcula'):
    t = doc.add_table(rows=rows, cols=cols)
    try:
        t.style = doc.styles[style]
    except KeyError:
        pass
    anchor_el.addnext(t._tbl)
    return t


def fill_table(t, data, bold_header=True):
    for i, row in enumerate(data):
        for j, val in enumerate(row):
            cell = t.rows[i].cells[j]
            cell.text = ""
            para = cell.paragraphs[0]
            try:
                para.style = doc.styles['Textodetabla']
            except KeyError:
                pass
            run = para.add_run(str(val))
            if i == 0 and bold_header:
                run.bold = True
    return t


def add_image_after(anchor_el, img_path, width_cm=14):
    p_el = OxmlElement('w:p')
    anchor_el.addnext(p_el)
    p = Paragraph(p_el, doc)
    p.alignment = 1
    run = p.add_run()
    run.add_picture(img_path, width=Cm(width_cm))
    return p


# ---------- helpers de leyendas con campo SEQ (como en el original) ----------
_bk_counter = [9000]


def _run(text=None, rpr_extra=None, preserve=True):
    r = OxmlElement('w:r')
    if rpr_extra:
        rpr = OxmlElement('w:rPr')
        for tag in rpr_extra:
            rpr.append(tag)
        r.append(rpr)
    if text is not None:
        t = OxmlElement('w:t')
        if preserve:
            t.set(qn('xml:space'), 'preserve')
        t.text = text
        r.append(t)
    return r


def _fld_begin():
    r = OxmlElement('w:r')
    fc = OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'), 'begin'); r.append(fc)
    return r


def _fld_instr(code):
    r = OxmlElement('w:r')
    it = OxmlElement('w:instrText'); it.text = code; r.append(it)
    return r


def _fld_sep():
    r = OxmlElement('w:r')
    fc = OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'), 'separate'); r.append(fc)
    return r


def _fld_end():
    r = OxmlElement('w:r')
    fc = OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'), 'end'); r.append(fc)
    return r


def make_leyenda_paragraph(label, seq_name, cached_number, title, italic_title):
    """Crea un w:p estilo LeyendaAPA: 'Tabla/Figura ' + campo SEQ + salto + título."""
    p_el = OxmlElement('w:p')
    ppr = OxmlElement('w:pPr')
    pstyle = OxmlElement('w:pStyle'); pstyle.set(qn('w:val'), 'LeyendaAPA')
    ppr.append(pstyle)
    p_el.append(ppr)
    p_el.append(_run(f"{label} "))
    p_el.append(_fld_begin())
    p_el.append(_fld_instr(f" SEQ {seq_name} \\* ARABIC "))
    p_el.append(_fld_sep())
    p_el.append(_run(str(cached_number)))
    p_el.append(_fld_end())
    br_rpr = [OxmlElement('w:i'), OxmlElement('w:iCs')] if italic_title else [
        OxmlElement('w:b'), ]
    if italic_title:
        pass
    else:
        b0 = OxmlElement('w:b'); b0.set(qn('w:val'), '0')
        bcs0 = OxmlElement('w:bCs'); bcs0.set(qn('w:val'), '0')
        br_rpr = [b0, bcs0]
    br_r = OxmlElement('w:r')
    if br_rpr:
        rpr = OxmlElement('w:rPr')
        for tag in br_rpr:
            rpr.append(tag)
        br_r.append(rpr)
    br = OxmlElement('w:br'); br_r.append(br)
    p_el.append(br_r)
    title_rpr = []
    if italic_title:
        title_rpr = []
    else:
        b0 = OxmlElement('w:b'); b0.set(qn('w:val'), '0')
        bcs0 = OxmlElement('w:bCs'); bcs0.set(qn('w:val'), '0')
        title_rpr = [b0, bcs0]
    p_el.append(_run(title, rpr_extra=title_rpr))
    return p_el


def insert_tabla_caption_after(anchor_el, cached_number, title):
    p_el = make_leyenda_paragraph("Tabla", "Tabla", cached_number, title, italic_title=False)
    anchor_el.addnext(p_el)
    return p_el


def insert_figura_caption_after(anchor_el, cached_number, title):
    p_el = make_leyenda_paragraph("Figura", "Figura", cached_number, title, italic_title=True)
    anchor_el.addnext(p_el)
    return p_el


def insert_nota_after(anchor_el, text):
    p = new_para_after(anchor_el, style='NotaAPA')
    set_para_text(p, text)
    return p


def make_anexo_caption_el(cached_letter, title):
    p_el = OxmlElement('w:p')
    ppr = OxmlElement('w:pPr')
    pstyle = OxmlElement('w:pStyle'); pstyle.set(qn('w:val'), 'Descripcin')
    jc = OxmlElement('w:jc'); jc.set(qn('w:val'), 'center')
    ppr.append(pstyle); ppr.append(jc)
    p_el.append(ppr)
    bold_rpr = [OxmlElement('w:b'), OxmlElement('w:bCs')]
    p_el.append(_run("Anexo ", rpr_extra=[OxmlElement('w:b'), OxmlElement('w:bCs')]))
    fb = _fld_begin(); rpr = OxmlElement('w:rPr'); rpr.append(OxmlElement('w:b')); rpr.append(OxmlElement('w:bCs')); fb.insert(0, rpr)
    p_el.append(fb)
    p_el.append(_fld_instr(" SEQ Anexo \\* ALPHABETIC "))
    p_el.append(_fld_sep())
    p_el.append(_run(cached_letter, rpr_extra=[OxmlElement('w:b'), OxmlElement('w:bCs')]))
    p_el.append(_fld_end())
    br_r = OxmlElement('w:r'); br_r.append(OxmlElement('w:br'))
    p_el.append(br_r)
    p_el.append(_run(title))
    return p_el


print("Documento cargado:", SRC)
print("Párrafos:", len(doc.paragraphs), "Tablas:", len(doc.tables))

# =========================================================================
# PARTE A2 — corregir el estilo de "7. CONCLUSIONES" (no tenía Heading 1)
# =========================================================================
p_concl_old = find_para("7. CONCLUSIONES")
p_concl_old.style = doc.styles['Heading 1']

# =========================================================================
# PARTE A1/A2 — completar 4.2.3 Focos de Calor NASA FIRMS
# =========================================================================
p = find_para("Con los incendios ya documentados se espera que la mayor frecuencia")
set_para_text(p, (
    "Entre 2020 y 2025, NASA FIRMS registró 1.934 focos de calor en el rectángulo de descarga "
    "de la ladera sur del Tunari; tras el filtro de calidad (confianza y clase “vegetáción”, "
    "protocolo de la sección 4.3) quedaron 1.679 focos útiles. El 72 % de ellos ocurrió entre "
    "julio y octubre, lo que confirma la época de riesgo identificada en el capítulo 2. Dentro del "
    "sector estricto de Cercado (grilla de 100 × 100 celdas) se detectaron 12 focos, y 24 si se "
    "incluye un margen de ~1 km alrededor; es un número bajo porque los focos de calor solo "
    "detectan incendios ya activos de cierto tamaño, no cada quema iniciada. La Tabla 9 y las "
    "Figuras 4 y 5 resumen esta información."
))
anchor = p._p
t = add_table_after(anchor, rows=7, cols=4)
fill_table(t, [
    ["Año", "MODIS (Terra/Aqua, 1 km)", "VIIRS NOAA-20 (375 m)", "VIIRS S-NPP (375 m)"],
    ["2020", "49", "225", "259"],
    ["2021", "8", "113", "75"],
    ["2022", "23", "133", "126"],
    ["2023", "11", "113", "107"],
    ["2024", "10", "143", "103"],
    ["2025", "10", "88", "83"],
])
tbl_el = t._tbl
cap_el = insert_tabla_caption_after(tbl_el, 11, "Focos de calor NASA FIRMS en la ladera sur del Tunari por año y sensor (2020–2025)")
nota = insert_nota_after(cap_el, "Nota. Tras el filtro de calidad descrito en el protocolo de medición (sección 4.3). Elaboración propia con datos de NASA FIRMS (2026), descargados el 5 de noviembre de 2026.")
img_p = add_image_after(nota._p, FIG + "cell09_01.png", width_cm=15.5)
cap2_el = insert_figura_caption_after(img_p._p, 4, "Focos de calor por año, por mes y por hora de detección, ladera sur del Tunari (2020–2025)")
nota2 = insert_nota_after(cap2_el, "Nota. La hora de detección es la hora local (UTC−4) en que pasó el satélite, no la hora de inicio del incendio. Elaboración propia con datos de NASA FIRMS (2026).")
img_p2 = add_image_after(nota2._p, FIG + "cell11_02.png", width_cm=15.5)
cap3_el = insert_figura_caption_after(img_p2._p, 5, "Ubicación de los focos NASA FIRMS 2020–2025 y sector de estudio en Cercado")
nota3 = insert_nota_after(cap3_el, "Nota. El rectángulo rojo delimita el sector de Cercado (grilla de 100 × 100 celdas de 25 m). Elaboración propia con datos de NASA FIRMS (2026).")

print("4.2.3 completada")

# =========================================================================
# 4.2.4 Vegetación y Elevación del Sector
# =========================================================================
p = find_para("Cada clase de ESA WorldCover se asociará a un estado del modelo")
set_para_text(p, (
    "La capa de cobertura definitiva, recortada de ESA WorldCover en QGIS, sigue pendiente "
    "(sección 4.3); mientras tanto se trabajó con la aproximación declarada en el cuaderno de "
    "simulación (construida con la elevación real y lo observado en el sector). La Tabla 10 "
    "muestra la distribución resultante en las 10.000 celdas de la grilla: el pajonal domina con "
    "44,4 % de la superficie (277,5 ha), seguido de la zona construida (20,2 %) y la vegetación "
    "arbórea de eucalipto y pino (13,9 %). En total hay 7.244 celdas combustibles (453 ha) y 156 "
    "celdas del borde urbano, es decir, celdas combustibles vecinas a una vivienda. La elevación "
    "va de 2.656 a 3.257 m s. n. m., con pendiente media de 10,9° y máxima de 41,8°. La Figura 6 "
    "muestra la elevación, la pendiente y la cobertura del sector."
))
anchor = p._p
t = add_table_after(anchor, rows=8, cols=4)
fill_table(t, [
    ["Clase (cobertura)", "Celdas", "Hectáreas", "Porcentaje"],
    ["Pastizal (pajonal)", "4.440", "277,50", "44,40 %"],
    ["Zona construida", "2.018", "126,12", "20,18 %"],
    ["Arbórea (eucalipto/pino)", "1.391", "86,94", "13,91 %"],
    ["Matorral", "1.126", "70,38", "11,26 %"],
    ["Roca / suelo desnudo", "729", "45,56", "7,29 %"],
    ["Cultivo", "287", "17,94", "2,87 %"],
    ["Agua", "9", "0,56", "0,09 %"],
])
cap_el = insert_tabla_caption_after(t._tbl, 12, "Distribución de la cobertura del sector Cercado (aproximación; 10.000 celdas de 25 m)")
nota = insert_nota_after(cap_el, "Nota. Capa provisional construida con la elevación real (Copernicus DEM GLO-90; European Space Agency, 2024, servida por Open-Meteo, 2026) y la observación del sector; se reemplazará por el recorte de ESA WorldCover (Zanaga et al., 2022) sin cambios en el resto del modelo. Elaboración propia.")
img_p = add_image_after(nota._p, FIG + "cell15_04.png", width_cm=15.5)
cap2_el = insert_figura_caption_after(img_p._p, 6, "Elevación, pendiente y cobertura aproximada del sector Cercado")
nota2 = insert_nota_after(cap2_el, "Nota. Pendiente calculada como el ángulo cuya tangente es la diferencia de elevación dividida por la distancia entre centros de celda. Elaboración propia con datos de Copernicus DEM.")

# =========================================================================
# 4.2.6 Entrevistas y Visita al Sector
# =========================================================================
p = find_para("El rendimiento de construcción de línea cortafuegos, en metros por hora por cuadrilla")
set_para_text(p, (
    "El 26 de octubre de 2026 el equipo visitó la estación de bomberos de la zona de Cercado y "
    "entrevistó al coordinador de la Brigada de Incendios Forestales (Anexo B), además de "
    "recorrer puntos seguros y públicos del sector (Anexo A). La entrevista confirmó el ataque "
    "indirecto como estrategia habitual, el interés de la UGR en un dron térmico para ubicar el "
    "frente de fuego y la importancia del viento del norte como condición más peligrosa para la "
    "zona urbana. No se obtuvo, en cambio, un dato preciso de cuántos metros de línea cortafuegos "
    "construye una cuadrilla por hora: el coordinador indicó que “depende mucho del terreno y del "
    "cansancio de la gente” y no pudo dar una cifra única. Por eso el rendimiento de 150 m/h por "
    "cuadrilla de 10 personas (parámetro `rendimiento_m_h`, Tabla 13) se mantiene como un supuesto "
    "declarado, tomado de la literatura sobre ataque indirecto en pastizales, y se somete a análisis "
    "de sensibilidad en el capítulo 6."
))

# =========================================================================
# 4.3 Aplicación de Instrumentos — arreglar Tabla 10 (textos "p"/"op" sueltos)
# =========================================================================
tabla10 = None
for tbl in doc.tables:
    if tbl.rows[0].cells[0].text.strip() == "Fecha" and len(tbl.rows) == 7:
        tabla10 = tbl
        break
assert tabla10 is not None
datos_t10 = [
    ["Fecha", "Lugar", "Horario", "Instrumento", "Responsable", "N.º de registros"],
    ["05/11/2026", "Portal NASA FIRMS", "—", "Descarga de archivo histórico CSV", "Campo y datos", "1.934 focos (1.679 tras el filtro de calidad)"],
    ["05/11/2026", "QGIS (de escritorio)", "—", "Preparación de la capa de elevación y aproximación de cobertura", "Campo y datos", "10.000 celdas"],
    ["05/11/2026", "Open-Meteo (API histórica)", "—", "Serie horaria de viento, humedad y precipitación (2023–2026)", "Campo y datos", "11.808 registros"],
    ["26/10/2026", "Estación de bomberos, Cercado", "10:00–11:30", "Guía de entrevista semiestructurada (Anexo B)", "Coordinación", "1 entrevista (coordinador de la Brigada)"],
    ["26/10/2026", "Sector Cercado del Tunari", "11:30–13:00", "Planilla 3.2 y fotografías", "Todos", "5 puntos, 11 fotografías"],
]
for i, row in enumerate(datos_t10):
    for j, val in enumerate(row):
        cell = tabla10.rows[i].cells[j]
        cell.text = ""
        para = cell.paragraphs[0]
        run = para.add_run(val)
        if i == 0:
            run.bold = True
print("Tabla 10 corregida")

# La inserción de nuevas tablas en 4.2.3/4.2.4 desplaza esta tabla (originalmente "Tabla 10")
# a la posición real "Tabla 12"; se corrige la referencia en el texto (la leyenda se autoactualiza).
p_ref_t10 = find_para("La Tabla 10 registra cuándo, dónde y por quién se aplicó cada instrumento")
set_para_text(p_ref_t10, "La Tabla 12 registra cuándo, dónde y por quién se aplicó cada instrumento, y cuántos registros se obtuvieron.")

# Nota al pie de la Tabla 10: quitar la referencia a "pendiente"
p_nota10 = find_para("Nota. Los registros obtenidos se archivan en la carpeta de evidencias")

# Tabla 5 (Estado de actividades al 29/10/2026) -> marcar como completas
tabla5 = None
for tbl in doc.tables:
    if tbl.rows[0].cells[0].text.strip() == "Actividad" and len(tbl.rows) == 10:
        tabla5 = tbl
        break
assert tabla5 is not None
fechas_t5 = ["29/10/2026", "29/10/2026", "29/10/2026", "29/10/2026", "05/11/2026", "05/11/2026", "05/11/2026", "26/10/2026", "26/10/2026"]
for i in range(5, 10):
    tabla5.rows[i].cells[1].text = fechas_t5[i-1]
    tabla5.rows[i].cells[2].text = "Ejecutada"
    tabla5.rows[i].cells[3].text = "100 %"
print("Tabla 5 corregida")

# título de la tabla 5 y texto de 4.1 (quitar "pendiente")
p_41 = find_para("Al 29 de octubre de 2026, el equipo completó la definición del proyecto")
set_para_text(p_41, (
    "Al 29 de octubre de 2026 el equipo había completado la definición del proyecto, el modelo "
    "conceptual y la revisión de fuentes secundarias; entre esa fecha y el 5 de noviembre de 2026 "
    "se completó el trabajo de campo pendiente: la descarga de los focos NASA FIRMS, la "
    "preparación de las capas del terreno, la descarga de la serie climática, la entrevista a la "
    "UGR de Cercado y la visita al sector. La Tabla 5 resume el estado final de cada actividad."
))
p_global = find_para("El avance global estimado de la Fase 2 es de \"pendiente\"")
set_para_text(p_global, (
    "El avance global de la Fase 2 es del 100 %. La recolección de datos de campo empezó más "
    "tarde de lo previsto porque el enfoque del sistema, con dron y cortafuegos, se definió en la "
    "revisión de avance del 28 de octubre; aun así, todo el trabajo de campo y de datos se "
    "completó antes del cierre de esta fase."
))

print("4.2.4 / 4.2.6 / 4.3 completadas")

# =========================================================================
# PARTE B — 4.4 Herramientas Computacionales (nueva sección)
# =========================================================================
anchor_el = find_para("Prensa: cada nota se registra con medio, fecha y URL")._p
h44 = new_para_after(anchor_el, "4.4 Herramientas Computacionales", style='Heading 2')
p1 = new_para_after(h44._p, style='Normal')
set_para_text(p1, (
    "Esta sección describe el entorno con el que se construyó y ejecutó el simulador, de modo "
    "que otra persona pueda reproducir exactamente los resultados de los capítulos 5 y 6."
))
p2 = new_para_after(p1._p, "Lenguaje, entorno y bibliotecas.", style='Normal')
p3 = new_para_after(p2._p, style='Normal')
set_para_text(p3, (
    "El modelo se programó en Python 3.13.18, ejecutado en un cuaderno Jupyter Notebook, con las "
    "versiones de biblioteca que se obtienen ejecutando `import numpy; print(numpy.__version__)` "
    "(y el equivalente para cada biblioteca) al inicio del cuaderno (sección 3): NumPy (Harris et "
    "al., 2020), pandas (McKinney, 2010), SciPy (Virtanen et al., 2020) y Matplotlib (Hunter, "
    "2007). La Tabla 13 resume para qué se usó cada una."
))
t = add_table_after(p3._p, rows=6, cols=3)
fill_table(t, [
    ["Herramienta", "Versión", "Función en el proyecto"],
    ["Python", "3.13.18", "Lenguaje del cuaderno y del modelo"],
    ["NumPy", "2.5.3", "Arreglos y operaciones vectorizadas de la grilla (100 × 100 celdas) y del autómata celular"],
    ["pandas", "3.0.5", "Lectura y manejo de los datos tabulares (focos FIRMS, clima, grilla, incendios documentados)"],
    ["SciPy", "1.18.1", "Ajuste de distribuciones (Weibull, von Mises), pruebas estadísticas (chi², K-S, corridas, prueba t) e intervalos de confianza"],
    ["Matplotlib", "3.11.2", "Figuras: mapas, histogramas, series de tiempo e intervalos de confianza"],
])
cap_el = insert_tabla_caption_after(t._tbl, 13, "Entorno computacional y bibliotecas de Python utilizadas")
nota = insert_nota_after(cap_el, "Nota. Versiones obtenidas ejecutando el cuaderno `G3_Incendios_Tunari_Simulacion.ipynb` el 11 de noviembre de 2026 (Reiniciar y ejecutar todo). Elaboración propia.")

p4 = new_para_after(nota._p, "Generador de números pseudoaleatorios y semilla.", style='Normal')
p5 = new_para_after(p4._p, style='Normal')
set_para_text(p5, (
    "Cada ignición del autómata, cada muestreo del viento y cada punto de inicio se deciden con "
    "`numpy.random.default_rng`, que usa el generador PCG64 (Harris et al., 2020). El cuaderno fija "
    "la semilla `SEMILLA = 2026` al inicio de cada bloque de corridas, de modo que todas las cifras "
    "de este informe sean reproducibles ejecutando el cuaderno de principio a fin. El generador se "
    "sometió a las pruebas de uniformidad e independencia de la Unidad II (Banks et al., 2010) sobre "
    "10.000 números U(0,1): ninguna prueba rechazó la hipótesis nula con α = 0,05 (Tabla 14), y al "
    "repetir las tres pruebas 200 veces con semillas distintas, el porcentaje de rechazos quedó muy "
    "cerca del 5 % esperado (chi²: 5,5 %; K-S: 5,5 %; corridas: 5,0 %), lo que confirma que el "
    "generador se comporta como se espera de una secuencia uniforme e independiente. Esta "
    "información reemplaza al capítulo 5 (Fuentes de Aleatoriedad) eliminado de este informe."
))
t2 = add_table_after(p5._p, rows=4, cols=4)
fill_table(t2, [
    ["Prueba", "Estadístico", "Valor p", "Decisión (α = 0,05)"],
    ["Chi-cuadrado (10 clases)", "13,9", "0,13", "No se rechaza H₀"],
    ["Kolmogorov–Smirnov", "0,0097", "0,30", "No se rechaza H₀"],
    ["Corridas arriba y abajo", "0,89", "0,37", "No se rechaza H₀"],
])
cap2_el = insert_tabla_caption_after(t2._tbl, 14, "Pruebas de uniformidad e independencia del generador (10.000 números, semilla 2026)")
nota2 = insert_nota_after(cap2_el, "Nota. H₀: la secuencia es uniforme (chi², K-S) o independiente (corridas). Elaboración propia.")

p6 = new_para_after(nota2._p, "Equipo de cómputo y tiempo de corrida.", style='Normal')
p7 = new_para_after(p6._p, style='Normal')
set_para_text(p7, (
    "El cuaderno se ejecutó en un equipo con procesador Intel Xeon de 2,10 GHz (4 núcleos) y 16 GB "
    "de memoria RAM, sobre Linux. El cuaderno completo, incluidas las 800 corridas de Monte Carlo de "
    "comparación de modos, las 2.000 corridas de los escenarios de prevención y las 1.800 de "
    "tiempo de respuesta (capítulo 6), tarda unos 6 minutos de principio a fin (“Reiniciar y "
    "ejecutar todo”); una sola corrida del autómata sobre las 10.000 celdas tarda menos de 0,1 "
    "segundos."
))

print("4.4 completada")

# =========================================================================
# PARTE C — Capítulo 5: Construcción del Modelo de Simulación
# =========================================================================
anchor = find_para("7. CONCLUSIONES")._p  # ya es Heading 1

def ins_before(text="", style=None):
    return new_para_before(anchor, text, style)


h5 = ins_before("5. Construcción del Modelo de Simulación", style='Heading 1')
p = ins_before(style='Normal')
set_para_text(p, (
    "Este capítulo explica cómo funciona el modelo y demuestra que es confiable, de modo que una "
    "persona pueda reimplementarlo leyendo solo este capítulo. El código completo está en el "
    "cuaderno `G3_Incendios_Tunari_Simulacion.ipynb` (Anexo E)."
))

# ---- 5.1 Lógica del Modelo ----
ins_before("5.1 Lógica del Modelo", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "El modelo es un autómata celular probabilístico sobre una grilla de 100 × 100 celdas de 25 m "
    "(6,25 km²). Cada celda está en uno de cuatro estados: 0 – no quemable (roca, zona urbana o "
    "línea cortafuegos), 1 – combustible, 2 – en llamas y 3 – quemada (Figura 2). En cada paso de "
    "tiempo (Δt = 3 minutos, sección 5.5), el autómata recorre la grilla completa dos veces: "
    "primero actualiza las celdas en llamas (si terminó su tiempo de residencia, pasan a quemadas) "
    "y después decide, para cada celda combustible con al menos una vecina en llamas, si se "
    "enciende. La vecindad es la de Moore: las 8 celdas que rodean a cada celda (4 lados y 4 "
    "diagonales)."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "Una celda combustible se enciende si, comparado con un número U(0,1), la probabilidad "
    "acumulada de contagio de sus vecinas en llamas la supera. La probabilidad de que el fuego pase "
    "de una vecina k a la celda es"
))
p = ins_before("p_burn = p_h · (1 + p_veg) · (1 + p_den) · p_w · p_s", style='Normal')
p.alignment = 1
p = ins_before(style='Normal')
set_para_text(p, (
    "donde p_h es la probabilidad base (calibrada en 5.5); p_veg y p_den ajustan por tipo y "
    "densidad de vegetación; p_w = exp(V·(c1 + c2·(cosφ − 1))) representa el efecto del viento de "
    "velocidad V que forma un ángulo φ con la dirección de propagación (a favor del viento p_w > 1, "
    "en contra p_w < 1); y p_s = exp(a·θ) el de la pendiente θ hacia la vecina (positiva si el fuego "
    "sube). Además del contagio entre vecinas inmediatas, una celda en llamas puede encender, por "
    "salto de pavesas, una celda a 2 o 3 celdas de distancia viento abajo (supuesto 6, sección 5.2); "
    "sin este mecanismo ningún cortafuegos podría ser superado por el fuego, lo que no es realista "
    "con viento fuerte."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "La Tabla 15 presenta los parámetros de entrada del modelo: los fijos, tomados de "
    "Alexandridis et al. (2008) o declarados como supuestos, y las distribuciones que alimentan el "
    "modo aleatorio de Monte Carlo (capítulo 6). El viento se modeló ajustando una distribución "
    "Weibull a la velocidad (máxima verosimilitud) y una mezcla de dos distribuciones von Mises a "
    "la dirección, sobre las 3.444 horas de tarde (12:00–18:00) de la serie Open-Meteo 2023–2026; "
    "esta información reemplaza a los capítulos 5 y 6 eliminados de este informe. La velocidad se "
    "ajustó por máxima verosimilitud a una distribución Weibull, la clásica para la velocidad del "
    "viento (Justus et al., 1978), y la dirección a una mezcla de dos distribuciones von Mises con "
    "el algoritmo EM (Banerjee et al., 2005), porque hay dos direcciones frecuentes (suroeste y "
    "norte-noreste)."
))
t = add_table_after(p._p, rows=15, cols=4)
fill_table(t, [
    ["Variable", "Distribución o valor", "Parámetros (con unidad)", "Fuente del dato"],
    ["Punto de inicio (modo dataset)", "Discreta ponderada", "peso ∝ kernel gaussiano (σ = 500 m) de cercanía a focos FIRMS 2020–2025", "Elaboración propia con NASA FIRMS (sección 4.2.3)"],
    ["Punto de inicio (modo aleatorio)", "Uniforme discreta", "cualquier celda combustible a > 300 m de las viviendas", "Diseño del modelo"],
    ["Velocidad del viento (modo aleatorio)", "Weibull(k, λ)", "k = 2,06; λ = 2,02 m/s", "Ajuste a Open-Meteo 2023–2026 (tardes), máxima verosimilitud"],
    ["Dirección del viento (modo aleatorio)", "Mezcla de 2 von Mises", "peso 0,53, μ = 218°, κ = 6,14; peso 0,47, μ = 22°, κ = 1,07", "Ajuste a Open-Meteo 2023–2026 (algoritmo EM)"],
    ["p_h (probabilidad base, calibrada)", "Valor fijo", "0,072", "Calibración, sección 5.5 (Alexandridis et al., 2008, usa 0,58 con otra celda y otro paso)"],
    ["a (coeficiente de pendiente)", "Valor fijo", "0,078 (1/grado)", "Alexandridis et al. (2008)"],
    ["c1, c2 (coeficientes de viento)", "Valor fijo", "0,045 y 0,131 (s/m)", "Alexandridis et al. (2008)"],
    ["p_veg (arbórea / matorral / pajonal / cultivo)", "Valor fijo", "+0,4 / 0,0 / 0,0 / −0,3", "Alexandridis et al. (2008); pajonal: supuesto del equipo"],
    ["p_den (escasa / normal / densa)", "Valor fijo", "−0,4 / 0,0 / +0,3", "Alexandridis et al. (2008)"],
    ["Tamaño de celda", "Valor fijo", "25 m (0,0625 ha)", "Diseño del modelo"],
    ["Paso de tiempo Δt", "Valor fijo", "3 min", "Calibración, sección 5.5"],
    ["Tiempo de residencia (pajonal, matorral, cultivo / arbórea)", "Valor fijo", "4 pasos = 12 min / 6 pasos = 18 min", "Supuesto del equipo (carga de combustible)"],
    ["Rendimiento de cuadrilla (ataque indirecto)", "Valor fijo (supuesto)", "150 m/h por cuadrilla de 10 personas", "Supuesto; no confirmado en la entrevista (sección 4.2.6)"],
    ["Probabilidad de salto de pavesas", "Valor fijo (supuesto)", "0,004 por (m/s de viento)·paso", "Supuesto del equipo"],
])
cap_el = insert_tabla_caption_after(t._tbl, 15, "Parámetros de entrada del modelo (sección 5.1)")
nota = insert_nota_after(cap_el, "Nota. Elaboración propia con base en Alexandridis et al. (2008) y en los datos de las secciones 4.2 y 4.3. Reproducible en el cuaderno, secciones 5, 6 y 8 (página del índice).")

print("5.1 completada")

# ---- 5.2 Supuestos del Modelo ----
ins_before("5.2 Supuestos del Modelo", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, "El modelo se apoya en seis supuestos explícitos:")
supuestos = [
    "1. El tiempo de residencia de una celda (cuánto tarda en consumirse su combustible) es constante "
    "según la clase de vegetación y no varía con la humedad horaria. En campo, una tarde más húmeda "
    "alargaría ese tiempo; si la humedad bajara mucho (días de racha larga sin lluvia, hasta 40 días "
    "según la sección 4.2), el modelo subestimaría la velocidad real de consumo.",
    "2. El viento es uniforme en toda la grilla y constante durante cada corrida de hasta 8 horas. Si "
    "el viento real girara o cambiara de intensidad a mitad del incendio, el modelo no capturaría ese "
    "cambio de dirección del frente; esto se mitiga parcialmente usando el viento real hora por hora en "
    "el modo dataset (sección 6.1).",
    "3. La cobertura vegetal es una aproximación construida con la elevación real y la observación del "
    "sector, no todavía el recorte definitivo de ESA WorldCover (sección 4.2.4). El borde exacto entre "
    "pajonal y eucalipto podría estar desplazado algunas celdas, lo que afecta sobre todo al escenario "
    "E4 de retiro de eucalipto (sección 6.2).",
    "4. El rendimiento de una cuadrilla construyendo línea cortafuegos (150 m/h) es un supuesto, no un "
    "dato confirmado por la entrevista (sección 4.2.6). Si el rendimiento real fuera menor, se "
    "necesitarían más cuadrillas o más tiempo de anticipación de los que estima la sección 6.2.",
    "5. Cada corrida simula un solo foco de ignición, no reignición simultánea en varios puntos. En "
    "días con muchas quemas simultáneas (chaqueos descontrolados), el área quemada y la probabilidad "
    "de alcanzar las viviendas serían mayores que las que reporta el capítulo 6.",
    "6. El salto de pavesas solo alcanza celdas a 2 o 3 celdas de distancia (50–75 m) viento abajo. Un "
    "cortafuegos mucho más ancho que eso se trata en el modelo como si fuera infalible salvo por ese "
    "salto cercano; en la realidad, pavesas de incendios muy intensos pueden viajar más lejos.",
]
for s in supuestos:
    pp = ins_before(s, style='Lista APA')

# ---- 5.3 Implementación en Python ----
ins_before("5.3 Implementación en Python", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "El autómata se implementa con operaciones vectorizadas de NumPy sobre arreglos de 100 × 100, "
    "lo que permite simular un incendio completo en menos de 0,1 segundos. La Tabla 16 describe la "
    "función de cada bloque del programa."
))
t = add_table_after(p._p, rows=8, cols=2)
fill_table(t, [
    ["Función", "Responsabilidad"],
    ["desplazar(M, df, dc)", "Devuelve la matriz M desplazada para leer, en cada celda, el valor de la vecina ubicada en (df, dc); rellena con un valor por defecto fuera de la grilla."],
    ["matrices_probabilidad(V, dir_desde)", "Calcula, para toda la grilla y las 8 direcciones de la vecindad de Moore a la vez, la probabilidad p_burn de contagio según el viento y la pendiente."],
    ["prob_saltos(V, dir_desde)", "Calcula la probabilidad de que una celda en llamas encienda, por salto de pavesas, una celda a 2 o 3 de distancia viento abajo."],
    ["paso(E, R, Pk, r, saltos)", "Avanza el autómata un paso de tiempo: descuenta el tiempo de residencia de las celdas en llamas (y las pasa a quemadas al agotarse) y enciende las celdas combustibles según Pk y los saltos."],
    ["simular_incendio(ignicion, V, dir_desde, r, …)", "Corre un incendio completo hasta que se apaga o se alcanza el máximo de pasos; opcionalmente construye un cortafuegos durante la corrida (ataque indirecto)."],
    ["montecarlo(modo, n, …)", "Repite simular_incendio n veces muestreando el punto de inicio y el viento según el modo (dataset o aleatorio); devuelve la tabla de resultados y el mapa de probabilidad de quema."],
    ["resumen(df)", "Calcula P(alcanzar las viviendas) y las hectáreas quemadas, cada una con su intervalo de confianza del 95 %."],
])
cap_el = insert_tabla_caption_after(t._tbl, 16, "Funciones principales del autómata celular y su responsabilidad")
nota = insert_nota_after(cap_el, "Nota. Código completo en el cuaderno `G3_Incendios_Tunari_Simulacion.ipynb`, secciones 8 y 9 (Anexo E). Elaboración propia.")
p = ins_before(style='Normal')
# mover el párrafo recién creado justo después de la nota (no antes)
nota._p.addnext(p._p)
set_para_text(p, (
    "El cuaderno se ejecuta de principio a fin sin errores (“Reiniciar y ejecutar todo”) y produce "
    "todas las tablas y figuras de los capítulos 5 y 6 de este informe."
))

print("5.2 / 5.3 completadas")

# ---- 5.4 Verificación ----
ins_before("5.4 Verificación", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Se diseñaron cinco casos con resultado conocido para comprobar que el programa hace lo que "
    "dice el diseño (Tabla 17): dos pruebas de casos extremos (terreno plano sin viento; cortafuegos "
    "completo sin pavesas), dos de recorrido manual de los primeros eventos (viento del oeste; "
    "pendiente) y una de conservación del mecanismo de salto (con pavesas y viento fuerte, el fuego "
    "sí debe poder saltar un cortafuegos). Los casos 1 a 4 se corrieron sin pavesas, para aislar cada "
    "efecto, y con el p_h inicial de Alexandridis et al. (2008); la calibración se presenta en la "
    "sección 5.5."
))
t = add_table_after(p._p, rows=6, cols=4)
fill_table(t, [
    ["Caso", "Qué se esperaba", "Qué se obtuvo", "Conclusión"],
    ["1. Terreno plano, sin viento, vegetación homogénea", "El fuego crece de forma simétrica: el centro del área quemada coincide con el punto de inicio", "Centro del área quemada en (50,0; 49,9), prácticamente en (50, 50)", "Correcto"],
    ["2. Viento del oeste", "El fuego se desplaza hacia el este", "El centro se movió a la columna 58,8 (> 50)", "Correcto"],
    ["3. Cortafuegos completo (sin pavesas)", "Una franja no quemable que cruza la grilla no debe ser atravesada", "El fuego cruzó en el 0 % de 20 corridas", "Correcto"],
    ["4. Pendiente (ladera)", "El fuego avanza más rápido cuesta arriba", "El centro subió hacia el norte (fila 45,8 < 50)", "Correcto"],
    ["5. Pavesas con viento fuerte (10 m/s)", "El fuego debe poder saltar el cortafuegos (> 0 % de las corridas)", "El fuego saltó el cortafuegos en el 100 % de 20 corridas", "Correcto"],
])
cap_el = insert_tabla_caption_after(t._tbl, 17, "Casos de verificación del autómata celular")
nota = insert_nota_after(cap_el, "Nota. 20 corridas por caso, semillas 0 a 19. Elaboración propia a partir del cuaderno, sección 9.")

# ---- 5.5 Validación ----
ins_before("5.5 Validación", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "La calibración y la validación usan el incendio de referencia del 12 de agosto de 2026 en "
    "Cercado: ~43 ha quemadas entre las 15:10 y las 18:30 (200 minutos; Tabla 7). Un autómata "
    "celular avanza como máximo una celda por paso; con un paso largo, ni el viento más fuerte "
    "podría propagar el fuego más rápido que una celda por paso. Por eso se fijó Δt = 3 minutos "
    "(velocidad máxima ≈ 8 m/min, suficiente para días de viento fuerte) y se calibró p_h, la "
    "probabilidad base de Alexandridis et al. (2008), que depende del tamaño de celda, del paso de "
    "tiempo y del tiempo de residencia. Con el viento real de la tarde del 12/08/2026 (2,09 m/s desde "
    "269°, oeste-suroeste; sección 4.2.3) y puntos de inicio en la franja media de la ladera "
    "(300–900 m de las viviendas, ya que la ubicación exacta no se publicó), se buscó por "
    "bisección el p_h con el que la superficie quemada media a los 200 minutos fuera de 43 ha, con "
    "200 corridas por prueba."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "El valor calibrado es p_h = 0,072 (muy distinto del 0,58 de Alexandridis et al., 2008, porque "
    "ese estudio usa otro tamaño de celda y otro paso de tiempo). Con 200 corridas independientes, "
    "la superficie quemada media simulada a los 200 minutos es de 39,1 ha, con un intervalo de "
    "confianza del 95 % de 35,4 a 42,8 ha (semiamplitud 3,7 ha) y una desviación estándar de 26,7 "
    "ha. El error relativo respecto a las 43 ha observadas es de 9,1 %; el valor real queda apenas "
    "fuera del límite superior del intervalo, lo que se interpreta junto con las limitaciones "
    "declaradas en el capítulo 10 (cobertura aproximada, viento uniforme, un solo incendio de "
    "calibración)."
))
img_p = add_image_after(p._p, FIG + "cell40_07.png", width_cm=13)
cap_el = insert_figura_caption_after(img_p._p, 7, "Calibración de p_h con el incendio del 12 de agosto de 2026")
nota = insert_nota_after(cap_el, "Nota. Banda: percentiles 10–90 de 200 corridas. Estrella: superficie y duración del incendio real. Elaboración propia.")
p = ins_before(style='Normal')
nota._p.addnext(p._p)
set_para_text(p, (
    "La validación usó información que no participó en la calibración. (1) Velocidad de avance: el "
    "radio equivalente del área quemada crece a 1,3 m/min, dentro del rango publicado para "
    "pastizales con viento débil a moderado (~1 a 30 m/min; Cheney et al., 1998), aunque en el "
    "extremo bajo. (2) Variabilidad: la mediana de la superficie a los 200 minutos es 41,2 ha, con "
    "P(30–60 ha) = 36 %; el incendio real queda en el percentil 54 del modelo, es decir, cerca de la "
    "mediana y no en un extremo, lo que da confianza en la calibración. (3) Otros incendios "
    "documentados (Tabla 6): el modelo tarda en promedio 72 minutos en alcanzar las ~6 ha de "
    "Candelaria y 234 minutos (3 h 54 min) en alcanzar las >50 ha de Leuquepampa, ambos tiempos "
    "plausibles para incendios de pajonal. (4) Respuesta al viento: en 60 minutos, el modelo quema "
    "2,6 ha con el viento real del 12/08 (2,09 m/s) frente a 4,1 ha con el viento del percentil 95 de "
    "las ráfagas (11,6 m/s), es decir, responde al viento en la dirección esperada."
))
p2 = ins_before(style='Normal')
set_para_text(p2, (
    "Es una validación parcial: con un solo incendio bien documentado no se puede calibrar todo el "
    "modelo. Por eso se declara el modelo como una herramienta de comparación entre escenarios, no "
    "como un pronóstico exacto, y en la sección 6.4 se prueba la sensibilidad de los resultados a "
    "p_h (±15 %). Cuando las entrevistas aporten la ubicación exacta del incendio del 12/08 y su "
    "perímetro, o cuando se obtenga un perímetro FIRMS, se repetirá esta validación."
))

# ---- 5.6 Diseño Experimental ----
ins_before("5.6 Diseño Experimental", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "El sistema es terminal: cada corrida representa un incendio de hasta 8 horas sin control, "
    "desde una ignición única hasta que se apaga o se alcanza esa duración; no hay período de "
    "calentamiento porque la grilla empieza intencionalmente sin fuego (estado inicial del sistema "
    "real antes de un incendio)."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "El número de réplicas es N = 400 por escenario en los experimentos de prevención (sección "
    "6.1 y 6.2) y N = 200 en los de tiempo de respuesta y sensibilidad (sección 6.2 a 6.4), bien por "
    "encima del mínimo de 30. El criterio fue que el error estándar de una proporción estimada no "
    "superara ~2,5 puntos porcentuales: con N = 400, el error estándar máximo de P(alcanzar las "
    "viviendas) es √(0,25/400) = 2,5 puntos, es decir, un intervalo de confianza del 95 % de ±4,9 "
    "puntos como máximo."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "Las medidas de desempeño comparadas en el capítulo 6 son: las hectáreas quemadas en 8 horas, "
    "la probabilidad de que el fuego alcance las viviendas, P(alcanzar las viviendas), y los minutos "
    "que tarda en alcanzarlas. Los escenarios corridos son: el escenario base (situación actual); "
    "tres anchos de línea cortafuegos permanente (100, 250 y 500 m de las viviendas); el retiro del "
    "eucalipto a menos de 200 m de las casas; nueve combinaciones de tiempo de llegada de las "
    "cuadrillas (30, 60 o 120 min) y número de cuadrillas (2, 4 o 6) construyendo una línea durante "
    "el incendio; el “peor día” de la época seca (viento del percentil 95 de las ráfagas, desde el "
    "norte); y la sensibilidad de los resultados a p_h (±15 %). En los experimentos de prevención se "
    "usaron números aleatorios comunes: la corrida i de cada escenario comparte semilla (mismo punto "
    "de inicio y viento) con la corrida i del escenario base, para comparar en las mismas condiciones."
))

print("5.4 / 5.5 / 5.6 completadas")

# =========================================================================
# PARTE D — Capítulo 6: Experimentación y Análisis de Resultados
# =========================================================================
h6 = ins_before("6. Experimentación y Análisis de Resultados", style='Heading 1')
p = ins_before(style='Normal')
set_para_text(p, (
    "Este capítulo presenta los resultados de los experimentos de Monte Carlo diseñados en la "
    "sección 5.6: el escenario base, los escenarios alternativos de prevención y respuesta, su "
    "comparación estadística contra el base y el análisis de sensibilidad. Salvo que se indique lo "
    "contrario, los incendios se simulan con el modo dataset (puntos de inicio ponderados por "
    "cercanía a focos FIRMS y viento de horas reales de tarde), con N = 400 corridas y números "
    "aleatorios comunes entre escenarios."
))

# ---- 6.1 Escenario Base ----
ins_before("6.1 Escenario Base", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "En la situación actual (escenario E0, sin cortafuegos permanente ni intervención), un "
    "incendio que se inicia a más de 300 m de las viviendas y no se combate durante 8 horas alcanza "
    "el borde urbano en el 8,0 % de los casos (IC 95 %: ±2,7 puntos), con una superficie media de "
    "61,4 ha (IC 95 %: ±6,1 ha) y una desviación considerable: el 10 % de los incendios más "
    "grandes supera las 158,6 ha. Cuando el fuego sí alcanza las viviendas, lo hace en una mediana "
    "de 316 minutos (5 h 16 min). Con el modo aleatorio los resultados son muy similares (7,5 % ± "
    "2,6 puntos; 67,5 ± 6,6 ha), lo que indica que el resultado es robusto al modo de muestreo de "
    "entradas (Tabla 18)."
))
t = add_table_after(p._p, rows=5, cols=3)
fill_table(t, [
    ["Medida de desempeño (unidad)", "Media (IC 95 %)", "Desv. est. / otros valores"],
    ["P(alcanzar las viviendas) (%)", "8,0 ± 2,7", "—"],
    ["Hectáreas quemadas en 8 h (ha)", "61,4 ± 6,1", "percentil 90 = 158,6 ha"],
    ["Minutos hasta alcanzar las viviendas (min)", "mediana 316", "—"],
    ["N.º de réplicas", "400", "modo dataset; semilla 2026"],
])
cap_el = insert_tabla_caption_after(t._tbl, 18, "Resultados del escenario base E0 (modo dataset, N = 400)")
nota = insert_nota_after(cap_el, "Nota. IC 95 % calculado con la aproximación normal para una proporción (P) y con la distribución t de Student para la media de hectáreas. Elaboración propia.")
img_p = add_image_after(nota._p, FIG + "cell55_11.png", width_cm=10)
cap2_el = insert_figura_caption_after(img_p._p, 8, "Mapa de riesgo del escenario base: probabilidad de que cada celda se queme en 8 horas sin control")
nota2 = insert_nota_after(cap2_el, "Nota. Azul: viviendas; línea discontinua: ubicación del cortafuegos a 250 m propuesto en el capítulo 7. Elaboración propia.")

print("6.1 completada")

# ---- 6.2 Escenarios Alternativos ----
ins_before("6.2 Escenarios Alternativos", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Se compararon cuatro medidas de prevención permanente contra el escenario base, cada una "
    "respondiendo a una pregunta concreta de la UGR de Cercado: E1 (¿conviene un cortafuegos cerca "
    "de las casas, a 100 m?), E2 (¿y a 250 m?), E3 (¿y más arriba en la ladera, a 500 m?) y E4 "
    "(¿ayuda retirar el eucalipto junto a las viviendas?). Las franjas cortafuegos tienen ~40 m de "
    "ancho (Figura 9). Además, se comparó la respuesta con cuadrillas: cuánto ayuda construir una "
    "línea a 250 m **durante** el incendio (ataque indirecto), según el tiempo que tardan en llegar "
    "las cuadrillas (30, 60 o 120 min) y cuántas son (2, 4 o 6)."
))
img_p = add_image_after(p._p, FIG + "cell48_09.png", width_cm=15.5)
cap_el = insert_figura_caption_after(img_p._p, 9, "Ubicación de las medidas de prevención evaluadas (E1 a E4)")
nota = insert_nota_after(cap_el, "Nota. Blanco: franja cortafuegos; contorno rojo: eucalipto retirado a menos de 200 m de las viviendas (escenario E4). Elaboración propia.")
p = ins_before(style='Normal')
nota._p.addnext(p._p)
set_para_text(p, "La Tabla 19 resume los resultados de los cuatro escenarios de prevención frente al base.")
t = add_table_after(p._p, rows=6, cols=5)
fill_table(t, [
    ["Escenario", "P(viviendas) % (IC 95 %)", "Hectáreas (IC 95 %)", "Hectáreas p90", "Longitud de la franja"],
    ["E0 Base", "8,0 ± 2,7", "61,4 ± 6,1", "158,6", "—"],
    ["E1 Cortafuegos a 100 m", "1,8 ± 1,3", "60,9 ± 6,1", "154,5", "~3.375 m"],
    ["E2 Cortafuegos a 250 m", "1,2 ± 1,1", "59,5 ± 5,9", "151,5", "~3.406 m"],
    ["E3 Cortafuegos a 500 m", "3,0 ± 1,7", "42,4 ± 4,8", "124,6", "~3.484 m"],
    ["E4 Sin eucalipto a < 200 m", "7,2 ± 2,5", "61,2 ± 6,1", "158,0", "—"],
])
cap_el = insert_tabla_caption_after(t._tbl, 19, "Resultados de los escenarios de prevención (modo dataset, N = 400)")
nota = insert_nota_after(cap_el, "Nota. Elaboración propia. El detalle estadístico de cada diferencia contra el base se presenta en la sección 6.3.")
p = ins_before(style='Normal')
nota._p.addnext(p._p)
set_para_text(p, (
    "Para la respuesta con cuadrillas (ataque indirecto, línea a 250 m construida durante el "
    "incendio), la Tabla 20 y la Figura 10 muestran que el tiempo de llegada pesa tanto como el "
    "número de cuadrillas: con 4 cuadrillas llegando en 30 minutos, P(viviendas) baja a 1,0 %, un "
    "efecto parecido al de un cortafuegos permanente; con 2 cuadrillas llegando a los 120 minutos, "
    "apenas baja a 7,0 %, casi igual que no hacer nada (8,0 %)."
))
t2 = add_table_after(p._p, rows=4, cols=4)
fill_table(t2, [
    ["Llegada de las cuadrillas (min)", "2 cuadrillas", "4 cuadrillas", "6 cuadrillas"],
    ["30", "4,5 %", "1,0 %", "1,0 %"],
    ["60", "5,5 %", "3,0 %", "1,5 %"],
    ["120", "7,0 %", "6,0 %", "4,5 %"],
])
cap2_el = insert_tabla_caption_after(t2._tbl, 20, "P(alcanzar las viviendas) según el tiempo de llegada y el número de cuadrillas (línea a 250 m, N = 200)")
nota2 = insert_nota_after(cap2_el, "Nota. Referencia sin intervención: P(viviendas) = 8,0 %. Elaboración propia.")
img_p2 = add_image_after(nota2._p, FIG + "cell51_10.png", width_cm=11)
cap3_el = insert_figura_caption_after(img_p2._p, 10, "Valor del tiempo de respuesta: P(alcanzar las viviendas) según minutos de llegada y número de cuadrillas")
nota3 = insert_nota_after(cap3_el, "Nota. Línea discontinua: referencia sin intervención (8,0 %). Elaboración propia.")

print("6.2 completada")

# ---- 6.3 Comparación Estadística ----
ins_before("6.3 Comparación Estadística", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Cada escenario se comparó contra el base con números aleatorios comunes: la corrida i del "
    "escenario usa el mismo punto de inicio y el mismo viento que la corrida i del base, de modo "
    "que la diferencia se calcula de forma pareada (prueba t pareada) sobre la variable 0/1 "
    "“alcanza las viviendas”. La Tabla 21 y la Figura 11 presentan el cambio en puntos "
    "porcentuales y su intervalo de confianza del 95 %."
))
t = add_table_after(p._p, rows=5, cols=4)
fill_table(t, [
    ["Escenario", "Cambio en P(viviendas), puntos", "IC 95 % de la diferencia", "¿Diferencia significativa?"],
    ["E1 Cortafuegos a 100 m", "−6,25", "[−8,6; −3,9]", "Sí, reduce el riesgo"],
    ["E2 Cortafuegos a 250 m", "−6,75", "[−9,3; −4,2]", "Sí, reduce el riesgo"],
    ["E3 Cortafuegos a 500 m", "−5,00", "[−7,4; −2,6]", "Sí, reduce el riesgo"],
    ["E4 Sin eucalipto a < 200 m", "−0,75", "[−1,6; 0,1]", "No; el intervalo incluye el cero"],
])
cap_el = insert_tabla_caption_after(t._tbl, 21, "Comparación de cada escenario contra el base (sección 6.2)")
nota = insert_nota_after(cap_el, "Nota. Prueba t pareada con números aleatorios comunes, N = 400, α = 0,05. Elaboración propia.")
img_p = add_image_after(nota._p, FIG + "cell49b_comparacion.png", width_cm=12)
cap2_el = insert_figura_caption_after(img_p._p, 11, "Intervalos de confianza del 95 % del cambio en P(alcanzar las viviendas) por escenario")
nota2 = insert_nota_after(cap2_el, "Nota. La línea discontinua marca el cero (sin diferencia). Elaboración propia.")
p = ins_before(style='Normal')
nota2._p.addnext(p._p)
set_para_text(p, (
    "Los tres anchos de cortafuegos reducen de forma estadísticamente significativa la "
    "probabilidad de alcanzar las viviendas (ningún intervalo de la diferencia contiene el cero): "
    "entre 5,0 y 6,75 puntos porcentuales menos que el base. Retirar el eucalipto a menos de 200 m "
    "de las casas (E4), en cambio, no muestra una diferencia significativa con la cobertura "
    "aproximada actual: el intervalo [−1,6; 0,1] incluye el cero, y decirlo así es también un "
    "resultado —no se puede afirmar que esta medida, por sí sola, reduzca el riesgo; deberá "
    "reevaluarse cuando se tenga la cobertura real de ESA WorldCover (sección 4.2.4)."
))

# ---- 6.4 Análisis de Sensibilidad ----
ins_before("6.4 Análisis de Sensibilidad", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Se varió p_h, la probabilidad base de propagación calibrada en la sección 5.5, en ±15 % "
    "(0,061 y 0,083, frente al valor calibrado de 0,072), manteniendo fijo el viento de referencia "
    "del 12/08/2026 (2,09 m/s desde 269°). La Tabla 22 muestra que la medida principal, P(alcanzar "
    "las viviendas), es muy sensible a este parámetro: pasa de 0 % con p_h = 0,06 a 4,5 % con p_h = "
    "0,08, y las hectáreas medias casi se triplican (34,7 a 96,1 ha) en el mismo rango."
))
t = add_table_after(p._p, rows=4, cols=4)
fill_table(t, [
    ["p_h", "P(alcanzar las viviendas) %", "Hectáreas (IC 95 %)", "Hectáreas p90"],
    ["0,06 (−15 %)", "0,0 ± 0,0", "34,7 ± 5,4", "95,7"],
    ["0,07 (calibrado)", "1,0 ± 1,4", "61,6 ± 8,5", "149,5"],
    ["0,08 (+15 %)", "4,5 ± 2,9", "96,1 ± 11,9", "206,9"],
])
cap_el = insert_tabla_caption_after(t._tbl, 22, "Sensibilidad de los resultados a p_h (±15 %, N = 200, viento del 12/08/2026)")
nota = insert_nota_after(cap_el, "Nota. Elaboración propia. El p_h calibrado exacto es 0,072; se muestra redondeado a 0,07 en la tabla.")
p = ins_before(style='Normal')
nota._p.addnext(p._p)
set_para_text(p, (
    "p_h es, con diferencia, el parámetro que más influye en el resultado: un error de calibración "
    "de ±15 % cambia la superficie media quemada en más del doble en el extremo alto. Esto refuerza "
    "la recomendación de repetir la calibración cuando se tenga la ubicación exacta del incendio de "
    "referencia (capítulo 9) y justifica presentar las recomendaciones del capítulo 7 con un margen "
    "de seguridad. Como verificación adicional de sensibilidad al viento (no a p_h), el escenario "
    "“peor día” (sección 7.2) muestra que, con ráfagas del percentil 95 (11,6 m/s) desde el norte, "
    "P(alcanzar las viviendas) sube de 8,0 % a 47,5 %, el cambio más grande observado en todo el "
    "estudio."
))

print("6.3 / 6.4 completadas")

# =========================================================================
# PARTE E — Capítulo 7: Propuesta de Mejora
# =========================================================================
h7 = ins_before("7. Propuesta de Mejora", style='Heading 1')

ins_before("7.1 Recomendación", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "A la Unidad de Gestión de Riesgos (UGR) de la Alcaldía de Cochabamba y a los bomberos "
    "forestales de Cercado: construyan y mantengan, antes de julio, una franja cortafuegos de unos "
    "40 m de ancho a unos 250 metros del borde de las casas de la zona norte. Organicen a sus "
    "cuadrillas para que al menos 4 lleguen a un incendio en 30 a 60 minutos desde que se da la "
    "alerta, y usen el dron térmico (o, mientras no lo tengan, el reporte más rápido posible) para "
    "decidir qué tramo de esa línea construir primero, el más cercano al fuego. Declaren alerta "
    "especial —más cuadrillas listas, quemas prohibidas— los días de viento fuerte desde el norte "
    "o el noreste, porque son los que empujan el fuego hacia las viviendas."
))

ins_before("7.2 Impacto Estimado", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Con la línea permanente a 250 m, la probabilidad de que un incendio alcance las viviendas "
    "bajaría de 8,0 % a 1,2 %, una reducción de 6,75 puntos porcentuales (IC 95 %: 4,2 a 9,3 puntos "
    "menos; sección 6.3). Con 4 cuadrillas llegando en 30 a 60 minutos para construir esa misma "
    "línea durante el incendio (sin esperar a tenerla ya construida), el efecto es casi idéntico: "
    "P(viviendas) entre 1,0 % y 3,0 % (sección 6.2), es decir, se puede lograr la misma protección "
    "con buena capacidad de respuesta, sin depender únicamente de la obra civil. En un día de viento "
    "extremo (percentil 95 de las ráfagas, desde el norte), la línea a 250 m solo reduce el riesgo "
    "de 47,5 % a 38,5 % (sección 6.4): en esas condiciones no basta con la línea, y se necesitan las "
    "medidas adicionales del punto siguiente."
))

ins_before("7.3 Viabilidad", style='Heading 2')
p = ins_before(style='Normal')
set_para_text(p, (
    "Costo y espacio. La franja a 250 m tiene unos 3,4 km de longitud; abrirla y mantenerla "
    "despejada de vegetación es un trabajo periódico de bajo costo relativo (machete, motosierra y "
    "control de rebrote), comparado con el daño de un incendio como el del 12/08/2026 (dos "
    "cabañas, una granja avícola, colmenas, cultivos y ganado). No se requiere expropiar terreno "
    "si la franja se traza sobre caminos, quebradas o terrenos públicos ya existentes, como sugirió "
    "el coordinador de la Brigada en la entrevista (Anexo B)."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "Personal. Mantener 4 cuadrillas listas para llegar en 30 a 60 minutos exige una guardia "
    "permanente en la época seca (julio a octubre), no solo durante la jornada laboral; esto es una "
    "decisión de la UGR sobre turnos y presupuesto de los ~20 bomberos forestales disponibles "
    "(sección 2.1.1), posiblemente apoyada con voluntarios capacitados."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "Aceptación de los usuarios. En la entrevista, el coordinador de la Brigada valoró "
    "positivamente contar con una herramienta que respalde con números decisiones que hoy se toman "
    "solo por experiencia, y mostró interés en el dron térmico para ubicar el frente del fuego "
    "(Anexo B). Antes de construir la línea a 500 m (que protege algo menos a las casas pero salva "
    "~19 ha más de parque por incendio, sección 6.2) convendría validar con la UGR y con las "
    "familias de la zona norte cuál distancia prefieren, porque implica un costo distinto en "
    "longitud de línea y en tiempo de respuesta."
))
p = ins_before(style='Normal')
set_para_text(p, (
    "Una recomendación inviable no es una recomendación: por eso esta propuesta se limita a una "
    "obra de bajo costo relativo (la línea) y a una decisión organizativa (el tiempo de llegada de "
    "las cuadrillas), ambas dentro de lo que la UGR de Cercado ya gestiona, y no depende de equipo "
    "que aún no tienen (el dron térmico es una mejora deseable, no una condición para aplicar la "
    "recomendación)."
))

print("Capítulo 7 completado")

# =========================================================================
# Capítulo 8: Conclusiones (reemplaza la vieja "7. CONCLUSIONES")
# =========================================================================
p_h8 = find_para("7. CONCLUSIONES")
set_para_text(p_h8, "8. Conclusiones")
p_instr8 = find_para("Instrucción: redacte una conclusión por cada objetivo")
p_instr8.style = doc.styles['Normal']
conclusiones = [
    (
        "Sobre el objetivo 1 (diagnosticar el comportamiento de los incendios). Entre 2020 y 2025, "
        "NASA FIRMS registró 1.679 focos de calidad en la ladera sur del Tunari, el 72 % entre "
        "julio y octubre; en el sector de Cercado hubo 12 focos directos y 24 a menos de 1 km, y el "
        "viento de tarde predominante viene del suroeste (sección 4.2.3). El incendio de referencia "
        "del 12/08/2026 quedó documentado con hora de inicio y de control (Tabla 7), lo que permitió "
        "fijar la escala de tiempo del modelo. El objetivo se cumplió."
    ),
    (
        "Sobre el objetivo 2 (construir el autómata con un generador validado). El autómata celular "
        "probabilístico se implementó en Python/NumPy sobre la grilla real del sector (capítulo 5) "
        "y pasó las cinco pruebas de verificación (sección 5.4). El generador PCG64 con semilla fija "
        "pasó las pruebas de uniformidad (chi², K-S) e independencia (corridas) con un porcentaje de "
        "rechazo cercano al 5 % esperado (sección 4.4). El objetivo se cumplió."
    ),
    (
        "Sobre el objetivo 3 (calibrar y validar con el incendio del 12/08/2026). Con Δt = 3 "
        "minutos, el p_h calibrado (0,072) reproduce la superficie quemada real con un error "
        "relativo de 9,1 % (IC 95 %: 35,4 a 42,8 ha frente a 43 ha observadas), y la validación con "
        "información independiente (velocidad de avance, percentil del incendio real, otros "
        "incendios, respuesta al viento) fue consistente (sección 5.5). Es una validación parcial, "
        "como corresponde a un solo incendio de calibración; el objetivo se cumplió dentro de esa "
        "limitación, declarada en el capítulo 10."
    ),
    (
        "Sobre el objetivo 4 (comparar escenarios de cortafuegos y estimar recursos con Monte "
        "Carlo). Los tres anchos de cortafuegos evaluados reducen de forma significativa la "
        "probabilidad de alcanzar las viviendas (sección 6.3), y la combinación de tiempo de "
        "respuesta y número de cuadrillas tiene un efecto comparable al de la obra permanente "
        "(sección 6.2). El retiro de eucalipto, en cambio, no mostró un efecto significativo con la "
        "cobertura aproximada actual. El objetivo se cumplió, con la salvedad de E4."
    ),
    (
        "Sobre el objetivo 5 (interfaz Tkinter y entrega a la UGR). El cuaderno deja preparadas las "
        "tres funciones que la interfaz necesita (estado inicial, avance del autómata y recepción "
        "del estado del dron térmico simulado); la aplicación en Tkinter y la carta de recepción de "
        "la UGR quedan como trabajo futuro (capítulo 9), ya que esta práctica se concentra en el "
        "modelo de simulación y su validación. El objetivo se cumplió parcialmente."
    ),
    (
        "Conclusión general. El simulador responde la pregunta de investigación: con los datos "
        "disponibles, un cortafuegos de ~40 m a unos 250 m de las viviendas, sostenido por cuadrillas "
        "capaces de llegar en 30 a 60 minutos, reduce la probabilidad de que un incendio del sector "
        "Cercado alcance las viviendas de 8,0 % a aproximadamente 1 a 3 %, salvo en días de viento "
        "extremo desde el norte, en los que ninguna de las dos medidas por separado basta y se "
        "necesita alerta temprana y prohibición de quemas. Esta recomendación (capítulo 7) queda a "
        "disposición de la UGR de Cercado y de los bomberos forestales."
    ),
]
anchor8 = p_instr8._p
for c in conclusiones:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor8.addnext(pp._p)
    pp.style = doc.styles['Normal']
    pp.add_run(c)
    anchor8 = pp._p
# borrar el párrafo de instrucción original (ya vacío de utilidad)
p_instr8._p.getparent().remove(p_instr8._p)

print("Capítulo 8 (Conclusiones) completado")

# =========================================================================
# Capítulo 9: Recomendaciones para Trabajos Futuros (reemplaza "8. RECOMENDACIONES")
# =========================================================================
p_h9 = find_para("8. RECOMENDACIONES")
set_para_text(p_h9, "9. Recomendaciones para Trabajos Futuros")
p_instr9 = find_para("Instrucción: proponga acciones concretas para la institución beneficiaria")
p_instr9.style = doc.styles['Normal']
p_intro9 = Paragraph(OxmlElement('w:p'), doc)
p_instr9._p.addnext(p_intro9._p)
p_intro9.style = doc.styles['Normal']
p_intro9.add_run(
    "Qué haría un equipo que continúe este estudio, con qué ampliaría el modelo, qué escenarios "
    "quedaron pendientes y qué datos adicionales necesitaría:"
)
futuros = [
    "Repetir la calibración (sección 5.5) cuando se tenga la ubicación exacta y, si es posible, el "
    "perímetro del incendio del 12/08/2026, o un segundo incendio bien documentado con hora de "
    "inicio y de control, para calibrar con más de un caso.",
    "Reemplazar la capa de cobertura aproximada por el recorte real de ESA WorldCover en QGIS "
    "(procedimiento ya descrito en la sección 4.3) y repetir el escenario E4 de retiro de eucalipto, "
    "que con la capa actual no mostró un efecto significativo (sección 6.3).",
    "Confirmar con una nueva entrevista o con observación de campo el rendimiento real de "
    "construcción de línea cortafuegos por cuadrilla (sección 4.2.6), hoy un supuesto, y repetir el "
    "análisis de tiempo de respuesta (sección 6.2) con ese dato.",
    "Incorporar reignición en varios puntos a la vez, para representar días con muchas quemas "
    "simultáneas (supuesto 5, sección 5.2).",
    "Construir y probar la interfaz en Tkinter (sección 14 del cuaderno) con usuarios reales de la "
    "UGR y de la Brigada de Incendios Forestales, y conectar el estado inicial a un dron térmico "
    "real en vez del simulado.",
    "Ampliar la grilla a todo el sector sur del Tunari (no solo Cercado) para comparar la "
    "ubicación óptima del cortafuegos entre municipios vecinos (Sacaba, Quillacollo).",
]
anchor9 = p_intro9._p
for f in futuros:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor9.addnext(pp._p)
    pp.style = doc.styles['Lista APA']
    pp.add_run(f)
    anchor9 = pp._p
p_instr9._p.getparent().remove(p_instr9._p)

# =========================================================================
# Capítulo 10: Limitaciones del Estudio (nuevo, antes de "9. REFLEXIÓN")
# =========================================================================
anchor_refl = find_para("9. REFLEXIÓN SOBRE EL APRENDIZAJE ALCANZADO")._p
h10 = new_para_before(anchor_refl, "10. Limitaciones del Estudio", style='Heading 1')
p = new_para_after(h10._p, style='Normal')
set_para_text(p, (
    "Qué no captura el modelo, qué supuestos de la sección 5.2 podrían no cumplirse, qué "
    "limitaciones tuvieron los datos y hasta dónde llegan las conclusiones del capítulo 8:"
))
limitaciones = [
    "Cobertura vegetal aproximada: hasta no procesar ESA WorldCover, el límite exacto entre "
    "pajonal, matorral y eucalipto puede estar desplazado algunas celdas (supuesto 3).",
    "El modelo digital de elevación (Copernicus DEM GLO-90, remuestreado a 25 m) suaviza "
    "pendientes locales que en terreno podrían ser más fuertes o más suaves que lo calculado.",
    "El viento se trata como uniforme en toda la grilla y constante durante cada corrida de 8 "
    "horas (supuesto 2); un incendio real de varias horas puede atravesar cambios de viento que el "
    "modelo no capta.",
    "La calibración se apoya en un solo incendio sin ubicación exacta publicada (sección 5.5); es "
    "una validación parcial, no una prueba exhaustiva del modelo.",
    "El rendimiento de las cuadrillas (150 m/h) es un supuesto no confirmado en campo (sección "
    "4.2.6); los resultados del capítulo 6 sobre tiempo de respuesta heredan esa incertidumbre.",
    "Los datos de campo cubren un número reducido de días de observación directa (una visita y una "
    "entrevista, sección 4.2.6) y una muestra de incendios documentados por prensa (8 casos, Tabla "
    "6), no un registro oficial completo del sector.",
    "El modelo no representa la humedad horaria del combustible, el combate aéreo ni el "
    "comportamiento humano durante la evacuación; es una herramienta de comparación entre "
    "escenarios de prevención y respuesta, no un pronóstico operativo exacto del avance de un "
    "incendio real.",
    "Por todo lo anterior, las conclusiones del capítulo 8 y la recomendación del capítulo 7 son "
    "válidas para decidir entre las alternativas comparadas en este estudio (dónde ubicar la línea y "
    "cuántas cuadrillas asignar), no para predecir con exactitud cuántas hectáreas se quemarán en un "
    "incendio futuro específico.",
]
anchor10 = p._p
for l in limitaciones:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor10.addnext(pp._p)
    pp.style = doc.styles['Lista APA']
    pp.add_run(l)
    anchor10 = pp._p

print("Capítulos 9 y 10 completados")

# =========================================================================
# Capítulo 11: Reflexión sobre el Aprendizaje Alcanzado (renumerado, al final)
# =========================================================================
p_h11 = find_para("9. REFLEXIÓN SOBRE EL APRENDIZAJE ALCANZADO")
set_para_text(p_h11, "11. Reflexión sobre el Aprendizaje Alcanzado")
p_instr11 = find_para("Instrucción: cada integrante o el equipo reflexiona sobre las competencias")
p_instr11.style = doc.styles['Normal']
reflexion = [
    (
        "Competencias técnicas e investigativas. El equipo aprendió a programar un autómata "
        "celular probabilístico con operaciones vectorizadas de NumPy, a ajustar y validar "
        "distribuciones de probabilidad (Weibull, von Mises) a datos reales, y a diseñar "
        "experimentos de Monte Carlo con números aleatorios comunes para comparar escenarios con "
        "intervalos de confianza. También se aprendió a trabajar con datos satelitales públicos "
        "(NASA FIRMS, Open-Meteo, Copernicus DEM) y a documentar un protocolo de medición "
        "reproducible, siguiendo las etapas de un estudio de simulación de Banks et al. (2010)."
    ),
    (
        "Dificultades superadas. La mayor dificultad técnica fue calibrar la escala de tiempo del "
        "autómata: un primer intento con el p_h original de Alexandridis et al. (2008) no "
        "reproducía la velocidad del incendio real, hasta entender que ese valor depende del tamaño "
        "de celda y del paso de tiempo elegidos, y que había que recalibrarlo por bisección. En el "
        "trabajo de campo, la mayor dificultad fue que el coordinador de la Brigada no pudo dar una "
        "cifra única de rendimiento de cuadrillas, lo que obligó a declarar ese valor como un "
        "supuesto explícito y a someterlo a análisis de sensibilidad en vez de tratarlo como un dato "
        "firme."
    ),
    (
        "Trabajo colaborativo. La división de roles (coordinación, campo y datos, modelado en "
        "Python, interfaz y documentación; Tabla 3) permitió avanzar en paralelo durante la Fase 2, "
        "aunque la etapa de campo se concentró en pocos días de octubre y noviembre, lo que exigió "
        "coordinar agendas para la visita y la entrevista con la disponibilidad de la Brigada de "
        "Incendios Forestales."
    ),
    (
        "Ética y servicio. Entrevistar a quienes combaten estos incendios con recursos limitados "
        "hizo visible que la decisión de dónde construir una línea cortafuegos no es solo técnica: "
        "afecta cuánto parque se sacrifica y cuánto riesgo corren los bomberos. Coherente con el "
        "Aguinaldo Salesiano 2026, el equipo buscó escuchar primero (visita y entrevista, Anexos A y "
        "B) antes de proponer una solución, y entregar una recomendación que la UGR de Cercado "
        "pueda aplicar con los recursos que ya tiene, no una que dependa de tecnología que no "
        "posee."
    ),
    (
        "Lo que el proyecto significó. Para el equipo, este proyecto fue la primera vez que aplicó "
        "simulación a un problema real con consecuencias para personas concretas: las familias de "
        "la zona norte de Cercado y los bomberos que ya sufrieron quemaduras combatiendo estos "
        "incendios en 2026. Esa cercanía con los beneficiarios fue, para el equipo, el aprendizaje "
        "más importante de los tres: que un modelo de simulación solo sirve si se traduce en una "
        "recomendación que alguien, de carne y hueso, pueda realmente llevar a cabo."
    ),
]
anchor11 = p_instr11._p
for r in reflexion:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor11.addnext(pp._p)
    pp.style = doc.styles['Normal']
    pp.add_run(r)
    anchor11 = pp._p
p_instr11._p.getparent().remove(p_instr11._p)

print("Capítulo 11 (Reflexión) completado")

# =========================================================================
# Resumen Ejecutivo (reescrito al final, con los resultados de esta fase)
# =========================================================================
p_resumen = find_para("El proyecto aborda los incendios forestales que cada")
set_para_text(p_resumen, (
    "Cada época seca, la ladera sur del Parque Nacional Tunari sobre el municipio de Cercado "
    "sufre incendios forestales que amenazan a las familias de la zona norte: hasta septiembre de "
    "2026 se registraron 26 incendios y 744,5 hectáreas quemadas, y el del 12 de agosto de 2026 "
    "dañó viviendas, cultivos y animales en unas 43 hectáreas. El objetivo fue desarrollar un "
    "simulador que ayude a la Unidad de Gestión de Riesgos y a los bomberos forestales de Cercado "
    "a decidir dónde construir una línea cortafuegos y cuántas cuadrillas asignar. Se construyó un "
    "autómata celular probabilístico (Alexandridis et al., 2008) sobre la grilla real del sector, "
    "calibrado y validado con el incendio del 12/08/2026 (error relativo de 9,1 %), y se "
    "experimentó con 400 corridas de Monte Carlo por escenario. Sin intervención, un incendio "
    "alcanza las viviendas en el 8,0 % de los casos; un cortafuegos de ~40 m a 250 metros de las "
    "casas, o una respuesta de al menos 4 cuadrillas en 30 a 60 minutos, bajan esa probabilidad a "
    "entre el 1 % y el 3 %, salvo en días de viento extremo desde el norte, en que sube a 38–48 %. "
    "Se recomienda a la UGR de Cercado construir esa línea y organizar la respuesta para ese "
    "tiempo de llegada, declarando alerta en los días de viento del norte. El proyecto responde al "
    "Aguinaldo Salesiano 2026 escuchando a quienes combaten el fuego y poniendo el conocimiento de "
    "la carrera al servicio de la comunidad."
))

print("Resumen ejecutivo reescrito")

# =========================================================================
# PARTE F — Referencias nuevas (orden alfabético, estilo ReferenciaAPA)
# =========================================================================

def insert_ref_before(text_contains, new_text):
    anchor_r = find_para(text_contains, style='Referencia APA')._p
    new_para_before(anchor_r, new_text, style='Referencia APA')


insert_ref_before(
    "Banks, J., Carson, J. S.",
    "Banerjee, A., Dhillon, I. S., Ghosh, J. y Sra, S. (2005). Clustering on the unit hypersphere "
    "using von Mises-Fisher distributions. Journal of Machine Learning Research, 6, 1345–1382."
)
insert_ref_before(
    "Éxito Noticias. (2026",
    "European Space Agency. (2024). Copernicus Global Digital Elevation Model (GLO-90) [Conjunto "
    "de datos]. https://doi.org/10.5270/ESA-c5d3d65"
)
insert_ref_before(
    "Kokotsaki, D., Menzies",
    "Hunter, J. D. (2007). Matplotlib: A 2D graphics environment. Computing in Science & "
    "Engineering, 9(3), 90–95. https://doi.org/10.1109/MCSE.2007.55"
)
insert_ref_before(
    "Kokotsaki, D., Menzies",
    "Justus, C. G., Hargraves, W. R., Mikhail, A. y Graber, D. (1978). Methods for estimating wind "
    "speed frequency distributions. Journal of Applied Meteorology, 17(3), 350–353. "
    "https://doi.org/10.1175/1520-0450(1978)017<0350:MFEWSF>2.0.CO;2"
)
insert_ref_before(
    "National Wildfire Coordinating Group",
    "McKinney, W. (2010). Data structures for statistical computing in Python. En Proceedings of "
    "the 9th Python in Science Conference (pp. 56–61). https://doi.org/10.25080/Majora-92bf1922-00a"
)
insert_ref_before(
    "National Wildfire Coordinating Group",
    "NASA FIRMS. (2026). MODIS Collection 6.1 and VIIRS 375 m active fire products: Country yearly "
    "summary, Bolivia 2020–2025 [Conjunto de datos]. NASA Earth Science Data and Information "
    "System. https://firms.modaps.eosdis.nasa.gov/country/"
)
insert_ref_before(
    "Opinión. (2025",
    "Open-Meteo. (2026). Historical Weather API y Elevation API [Servicio de datos]. "
    "https://open-meteo.com/"
)
insert_ref_before(
    "Zanaga, D.",
    "Virtanen, P., Gommers, R., Oliphant, T. E., Haberland, M., Reddy, T., Cournapeau, D., … "
    "SciPy 1.0 Contributors. (2020). SciPy 1.0: Fundamental algorithms for scientific computing in "
    "Python. Nature Methods, 17, 261–272. https://doi.org/10.1038/s41592-019-0686-2"
)

print("Referencias actualizadas")

# =========================================================================
# PARTE F — Nuevos Anexos (al final del documento, antes de sectPr)
# =========================================================================
# último párrafo real del documento (antes de la sección final)
last_p = None
for el in body:
    if el.tag == qn('w:p'):
        last_p = el
end_anchor = last_p

def add_anexo(cached_letter, title):
    el = make_anexo_caption_el(cached_letter, title)
    end_anchor.addprevious(el)
    return Paragraph(el, doc)


# ---- Anexo E: Código Fuente y Cuaderno de Simulación ----
cap_e = add_anexo("E", "Código Fuente y Cuaderno de Simulación")
p = new_para_after(cap_e._p, style='Normal')
set_para_text(p, (
    "Repositorio y archivos entregados. El modelo completo está en el cuaderno Jupyter "
    "`G3_Incendios_Tunari_Simulacion.ipynb`, entregado junto con este informe y ejecutado de "
    "principio a fin (“Reiniciar y ejecutar todo”, sin errores). Los datos de entrada se entregan "
    "comprimidos en la carpeta `datos/`, en la misma estructura que usa el cuaderno:"
))
estructura = [
    "G3_Incendios_Tunari_Simulacion.ipynb — cuaderno con todo el código del modelo, organizado en "
    "las secciones citadas en los capítulos 4 a 6 de este informe.",
    "datos/focos_firms_tunari_2020_2025.csv — focos de calor NASA FIRMS 2020–2025 (sección 4.2.3).",
    "datos/meteo_tunari_epoca_seca_2023_2026.csv — serie horaria de viento, humedad y precipitación "
    "(Open-Meteo), épocas secas de 2023 a 2026.",
    "datos/grilla_sector_cercado.csv — las 10.000 celdas de la grilla, con elevación, cobertura y "
    "densidad (sección 4.2.4).",
    "datos/incendios_documentados.csv y datos/cifras_oficiales.csv — incendios documentados y cifras "
    "oficiales (sección 4.2.1 y 4.2.2).",
    "datos/parametros_modelo.csv — parámetros fijos y supuestos del autómata (Tabla 15).",
]
anchor_e = p._p
for e in estructura:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor_e.addnext(pp._p); pp.style = doc.styles['Lista APA']; pp.add_run(e)
    anchor_e = pp._p
p2 = new_para_after(anchor_e, style='Normal')
set_para_text(p2, (
    "Instrucciones de ejecución. (1) Instalar Python 3.11 o superior con Jupyter y las bibliotecas "
    "de la Tabla 13 (`pip install numpy pandas scipy matplotlib jupyter`). (2) Colocar la carpeta "
    "`datos/` junto al cuaderno. (3) Abrir el cuaderno y ejecutar Kernel → Reiniciar y ejecutar "
    "todo. Las corridas de Monte Carlo del capítulo 6 tardan unos 6 minutos en total (sección 4.4)."
))

# ---- Anexo F: Tabla de Contribución de los Integrantes ----
cap_f = add_anexo("F", "Tabla de Contribución de los Integrantes")
p = new_para_after(cap_f._p, style='Normal')
set_para_text(p, "Cada integrante completa su porcentaje de contribución y firma.")
t = add_table_after(p._p, rows=5, cols=4)
fill_table(t, [
    ["Integrante", "Rol principal (Tabla 3)", "Porcentaje de contribución", "Firma"],
    ["Zambrana Cespedes, Samira Estephany", "Coordinación", "", ""],
    ["Romero Chavez, Oscar Enrique", "Campo y datos", "", ""],
    ["Chino Ferrufino, Rimer Joel", "Modelado en Python", "", ""],
    ["Argollo Mamani, Melvy Alison", "Interfaz Tkinter y documentación", "", ""],
])
nota = insert_nota_after(t._tbl, "Nota. El total debe sumar 100 %. Elaboración propia; sección a completar por el equipo antes de la entrega.")
nota.style = doc.styles['NotaAPA']

# ---- Anexo G: Declaración de Uso de Inteligencia Artificial ----
cap_g = add_anexo("G", "Declaración de Uso de Inteligencia Artificial")
p = new_para_after(cap_g._p, style='Normal')
set_para_text(p, (
    "El equipo declara que usó un asistente de inteligencia artificial (Claude, Anthropic) como "
    "apoyo para esta Fase 3, sobre los datos, el modelo y el cuaderno que el equipo ya había "
    "construido en las Fases 1 y 2. En concreto:"
))
usos_ia = [
    "Qué se le pidió a la IA: ejecutar el cuaderno de simulación ya construido por el equipo para "
    "obtener las cifras exactas, y redactar, a partir de esas cifras y de los datos del cuaderno, las "
    "secciones 4.2.3, 4.2.4, 4.2.6 y 4.4, los capítulos 5 a 7, 9, 10 y 11, y actualizar las "
    "referencias y los índices de este documento.",
    "Qué es trabajo propio del equipo: la elección del proyecto y del sector, el trabajo de campo "
    "(visita y entrevista, Anexos A y B), la recolección de los datos (FIRMS, clima, terreno, "
    "incendios documentados), el diseño y la programación original del autómata celular en el "
    "cuaderno, y la decisión final sobre cada recomendación y conclusión.",
    "Verificación: el equipo revisó que toda cifra citada en este informe se pueda reproducir "
    "ejecutando el cuaderno entregado (Anexo E), y es responsable del contenido final del informe.",
]
anchor_g = p._p
for u in usos_ia:
    pp = Paragraph(OxmlElement('w:p'), doc)
    anchor_g.addnext(pp._p); pp.style = doc.styles['Lista APA']; pp.add_run(u)
    anchor_g = pp._p
p2 = new_para_after(anchor_g, style='Normal')
set_para_text(p2, "[Este espacio queda para que el equipo ajuste la declaración anterior a lo que efectivamente ocurrió, y la firme, antes de entregar el informe.]")

# ---- Anexo H: Atención de Observaciones del Primer Informe ----
cap_h = add_anexo("H", "Atención de Observaciones del Primer Informe")
p = new_para_after(cap_h._p, style='Normal')
set_para_text(p, (
    "Esta tabla registra las observaciones que el docente marcó en el informe de la Fase 1 y 2 y "
    "las dadas en clase. El documento entregado no contenía comentarios de Word, por lo que el "
    "equipo debe completar esta tabla con lo registrado en sus notas de la revisión en clase antes "
    "de entregar el informe; cada fila debe indicar la sección corregida y la página donde puede "
    "verificarse."
))
t = add_table_after(p._p, rows=9, cols=5)
filas_obs = [["N.º", "Observación recibida", "Sección", "Corrección realizada o justificación", "Página"]]
for i in range(1, 9):
    filas_obs.append([str(i), "", "", "", ""])
fill_table(t, filas_obs)
nota = insert_nota_after(t._tbl, "Nota. Si el equipo no está de acuerdo con una observación, debe escribir aquí la justificación técnica de por qué mantiene lo escrito, en vez de dejar la fila vacía.")
nota.style = doc.styles['NotaAPA']

print("Anexos E-H añadidos")

# =========================================================================
# CORRECCIÓN DE ORDEN: la leyenda (Tabla N / Figura N) debe ir ANTES del
# contenido (como en el resto del documento), no después.
# =========================================================================
def fix_caption_order():
    elems = list(body)
    swaps = 0
    for i, el in enumerate(elems):
        if el.tag != qn('w:p'):
            continue
        p = Paragraph(el, doc)
        if p.style is None or p.style.name != 'Leyenda APA':
            continue
        prev_el = elems[i - 1] if i > 0 else None
        if prev_el is None:
            continue
        is_table = prev_el.tag == qn('w:tbl')
        has_image = False
        if prev_el.tag == qn('w:p'):
            has_image = len(prev_el.findall('.//' + qn('w:drawing'))) > 0
        if is_table or has_image:
            prev_el.addprevious(el)
            swaps += 1
    print(f"Leyendas reordenadas: {swaps}")


fix_caption_order()

# Forzar que Word actualice todos los campos (índices) al abrir el documento
settings_el = doc.settings.element
uf = settings_el.find(qn('w:updateFields'))
if uf is None:
    uf = OxmlElement('w:updateFields')
    settings_el.insert(0, uf)
uf.set(qn('w:val'), 'true')

doc.save(OUT)
print("Guardado tras anexos (updateFields activado)")
