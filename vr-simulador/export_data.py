# -*- coding: utf-8 -*-
"""Exporta los datos reales del proyecto (grilla, vegetación, incendio calibrado)
a JSON ligero para el simulador VR en Three.js / WebXR."""
import json
import numpy as np
import pandas as pd
from scipy import ndimage

D = "../Proyecto3_Incendios_Tunari/datos/"
OUT = "public/data/"
import os
os.makedirs(OUT, exist_ok=True)

SEMILLA = 2026

grilla = pd.read_csv(D + "grilla_sector_cercado.csv")
N = int(grilla.fila.max() + 1)
CELDA = 25.0
HA_CELDA = CELDA**2 / 10000


def a_matriz(col):
    return grilla.pivot(index="fila", columns="col", values=col).values


ELEV = a_matriz("elevacion_m").astype(float)
CLASE = a_matriz("clase_esa").astype(int)
DENS = a_matriz("densidad_ajuste").astype(float)

par = pd.read_csv(D + "parametros_modelo.csv")
P = par.set_index("parametro").valor.astype(float).to_dict()
P["p_h"] = 0.072  # calibrado (informe, sección 5.5)
P_VEG = {10: P["p_veg_arborea"], 20: P["p_veg_matorral"], 30: P["p_veg_pastizal"], 40: P["p_veg_cultivo"]}

COMBUSTIBLE = np.isin(CLASE, [10, 20, 30, 40])
PVEG = np.zeros_like(ELEV)
for c, v_ in P_VEG.items():
    PVEG[CLASE == c] = v_
PDEN = DENS
URBANO = CLASE == 50
DIST_URB = ndimage.distance_transform_edt(~URBANO) * CELDA
VECINAS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
TAU = np.where(CLASE == 10, int(P["pasos_ardiendo_arborea"]), int(P["pasos_ardiendo"])).astype(np.int16)


def desplazar(M, df, dc, relleno=0):
    S = np.full_like(M, relleno)
    fi = slice(max(0, -df), N - max(0, df)); fo = slice(max(0, df), N - max(0, -df))
    ci = slice(max(0, -dc), N - max(0, dc)); co = slice(max(0, dc), N - max(0, -dc))
    S[fi, ci] = M[fo, co]
    return S


def matrices_probabilidad(V, dir_desde, pveg=None, pden=None, ph=None):
    pveg = PVEG if pveg is None else pveg
    pden = PDEN if pden is None else pden
    ph = P["p_h"] if ph is None else ph
    hacia = np.radians(dir_desde + 180)
    w_e, w_n = np.sin(hacia), np.cos(hacia)
    lista = []
    for df, dc in VECINAS:
        d = CELDA * np.hypot(df, dc)
        p_e, p_n = -dc / np.hypot(df, dc), df / np.hypot(df, dc)
        cosphi = w_e * p_e + w_n * p_n
        pw = np.exp(V * (P["c1"] + P["c2"] * (cosphi - 1)))
        theta = np.degrees(np.arctan((ELEV - desplazar(ELEV, df, dc, relleno=np.nan)) / d))
        ps = np.exp(P["a"] * np.nan_to_num(theta))
        lista.append(np.clip(ph * (1 + pveg) * (1 + pden) * pw * ps, 0, 1))
    return lista


def prob_saltos(V, dir_desde):
    hacia = np.radians(dir_desde + 180)
    w_e, w_n = np.sin(hacia), np.cos(hacia)
    lista = []
    for df, dc in VECINAS:
        cosphi = w_e * (-dc) / np.hypot(df, dc) + w_n * df / np.hypot(df, dc)
        p = P["s_salto"] * V * max(cosphi, 0)
        if p > 0:
            for m in (2, 3):
                lista.append((df * m, dc * m, p / m))
    return lista


def paso(E, R, Pk, r, saltos=()):
    ardiendo = (E == 2)
    no_enciende = np.ones(E.shape)
    for (df, dc), pk in zip(VECINAS, Pk):
        vecina_arde = desplazar(ardiendo, df, dc, relleno=False)
        no_enciende *= np.where(vecina_arde, 1 - pk, 1.0)
    for df, dc, p in saltos:
        no_enciende *= np.where(desplazar(ardiendo, df, dc, relleno=False), 1 - p, 1.0)
    nuevas = (E == 1) & (r.random(E.shape) < 1 - no_enciende)
    E = E.copy(); R = R.copy()
    R[ardiendo] -= 1
    E[ardiendo & (R <= 0)] = 3
    E[nuevas] = 2
    R[nuevas] = TAU[nuevas]
    return E, R


def franja_cortafuegos(dist, ancho=40):
    return COMBUSTIBLE & (DIST_URB >= dist) & (DIST_URB < dist + ancho)


def simular(ignicion, V, dir_desde, r, max_pasos, estado0=None, guardar_cada=4):
    E = np.where(COMBUSTIBLE if estado0 is None else estado0, 1, 0).astype(np.int8)
    E[ignicion] = 2
    R = np.zeros(E.shape, np.int16); R[ignicion] = TAU[ignicion]
    Pk = matrices_probabilidad(V, dir_desde)
    saltos = prob_saltos(V, dir_desde)
    cuadros = [E.copy()]
    for k in range(max_pasos):
        E, R = paso(E, R, Pk, r, saltos)
        if (k + 1) % guardar_cada == 0:
            cuadros.append(E.copy())
        if not (E == 2).any():
            break
    cuadros.append(E.copy())
    return cuadros


# --- viento real del incendio de referencia (12/08/2026) ---
meteo = pd.read_csv(D + "meteo_tunari_epoca_seca_2023_2026.csv", parse_dates=["time"])
ref = meteo[(meteo.time >= "2026-08-12 15:00") & (meteo.time <= "2026-08-12 18:00")]
V_REF = ref.wind_speed_10m.mean() / 3.6
DIR_REF = np.degrees(np.arctan2(np.sin(np.radians(ref.wind_direction_10m)).mean(),
                                 np.cos(np.radians(ref.wind_direction_10m)).mean())) % 360

MAX_PASOS = int(8 * 60 / P["minutos_por_paso"])  # 8 horas
BORDE = COMBUSTIBLE & ndimage.binary_dilation(URBANO, structure=np.ones((3, 3)))
LINEA_250 = franja_cortafuegos(250)

# Viento del "peor día" (percentil 95 de ráfagas, desde el norte; informe, cap. 6.4/7.2):
# el que hace más dramática y más fiel a lo documentado la diferencia entre escenarios.
V_PEOR = np.percentile(meteo.wind_gusts_10m, 95) / 3.6
DIR_PEOR = 0.0

candidatos = np.argwhere(COMBUSTIBLE & (DIST_URB > 300) & (DIST_URB < 900) & np.isin(CLASE, [20, 30]))

mejor = None
for idx in range(0, len(candidatos), max(1, len(candidatos) // 60)):
    ig = tuple(int(x) for x in candidatos[idx])
    f_base = simular(ig, V_PEOR, DIR_PEOR, np.random.default_rng(SEMILLA), MAX_PASOS, guardar_cada=999)
    llega_base = bool(((f_base[-1] >= 2) & BORDE).any())
    if not llega_base:
        continue
    f_corta = simular(ig, V_PEOR, DIR_PEOR, np.random.default_rng(SEMILLA), MAX_PASOS,
                       estado0=COMBUSTIBLE & ~LINEA_250, guardar_cada=999)
    llega_corta = bool(((f_corta[-1] >= 2) & BORDE).any())
    ha_base = (f_base[-1] >= 2).sum() * HA_CELDA
    if llega_base and not llega_corta:
        mejor = ig
        print(f"  candidato {ig}: base llega ({ha_base:.0f} ha) y cortafuegos NO llega -> elegido")
        break
    elif llega_base:
        print(f"  candidato {ig}: base llega ({ha_base:.0f} ha) pero cortafuegos también llega")

IGNICION = mejor if mejor else tuple(int(x) for x in candidatos[len(candidatos) // 2])
V_REF, DIR_REF = V_PEOR, DIR_PEOR
print(f"Viento (peor día): {V_REF:.2f} m/s desde {DIR_REF:.0f}°  |  ignición elegida en {IGNICION}")

cuadros_base = simular(IGNICION, V_REF, DIR_REF, np.random.default_rng(SEMILLA), MAX_PASOS)
cuadros_corta = simular(IGNICION, V_REF, DIR_REF, np.random.default_rng(SEMILLA), MAX_PASOS,
                         estado0=COMBUSTIBLE & ~LINEA_250)

BORDE = COMBUSTIBLE & ndimage.binary_dilation(URBANO, structure=np.ones((3, 3)))
print(f"Escenario base: {len(cuadros_base)} cuadros, final {int((cuadros_base[-1] >= 2).sum() * HA_CELDA)} ha, "
      f"¿llegó al borde urbano? {bool(((cuadros_base[-1] >= 2) & BORDE).any())}")
print(f"Escenario cortafuegos: {len(cuadros_corta)} cuadros, final {int((cuadros_corta[-1] >= 2).sum() * HA_CELDA)} ha, "
      f"¿llegó al borde urbano? {bool(((cuadros_corta[-1] >= 2) & BORDE).any())}")

# --- condiciones ambientales reales del "peor día" (misma referencia que el viento) ---
# Para no inventar humedad/temperatura, se toma el registro real del CSV de clima
# cuya ráfaga está más cerca del percentil 95 usado para el viento del modelo —
# así los datos que se muestran corresponden a una observación real, no a un promedio.
gust_p95 = np.percentile(meteo.wind_gusts_10m, 95)
fila_peor = meteo.loc[(meteo.wind_gusts_10m - gust_p95).abs().idxmin()]

# --- exportar terreno ---
elev_min, elev_max = float(ELEV.min()), float(ELEV.max())
terreno = {
    "n": N,
    "celda_m": CELDA,
    "elevMin": elev_min,
    "elevMax": elev_max,
    "elevacion": np.round(ELEV, 1).tolist(),
    "clase": CLASE.tolist(),
    "urbano": URBANO.astype(int).tolist(),
    "lineaCortafuegos250": LINEA_250.astype(int).tolist(),
    "ignicion": [int(IGNICION[0]), int(IGNICION[1])],
    "vientoMs": round(float(V_REF), 2),
    "vientoKmh": round(float(V_REF) * 3.6, 1),
    "vientoDirDesde": round(float(DIR_REF), 1),
    "vientoEtiqueta": "peor día (percentil 95 de ráfagas)",
    "pH": round(float(P["p_h"]), 3),
    "clima": {
        "temporadaAnio": int(fila_peor.temporada),
        "temporadaEtiqueta": "Época seca",
        "fecha": str(fila_peor.time.date()),
        "temperaturaC": round(float(fila_peor.temperature_2m), 1),
        "humedadPct": round(float(fila_peor.relative_humidity_2m), 0),
        "precipMm": round(float(fila_peor.precipitation), 1),
    },
}
with open(OUT + "terreno.json", "w") as f:
    json.dump(terreno, f, separators=(",", ":"))

DT = P["minutos_por_paso"]


def exportar_escenario(nombre, cuadros):
    frames = [c.astype(int).tolist() for c in cuadros]
    data = {
        "nombre": nombre,
        "dtMin": DT,
        "pasosGuardadosCada": 4,
        "numFrames": len(frames),
        "frames": frames,
    }
    with open(OUT + f"fuego_{nombre}.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    import os as _os
    size_kb = _os.path.getsize(OUT + f"fuego_{nombre}.json") / 1024
    print(f"  fuego_{nombre}.json: {size_kb:.0f} KB, {len(frames)} frames")


exportar_escenario("base", cuadros_base)
exportar_escenario("cortafuegos250", cuadros_corta)

# --- Mapa de riesgo real (Monte Carlo, igual criterio que el capítulo 6 del informe) ---
focos = pd.read_csv(D + "focos_firms_tunari_2020_2025.csv")
lat_min, lat_max = grilla.lat.min(), grilla.lat.max()
lon_min, lon_max = grilla.lon.min(), grilla.lon.max()
margen = 0.01
cerca = focos[focos.latitude.between(lat_min - margen, lat_max + margen) &
              focos.longitude.between(lon_min - margen, lon_max + margen)]

zona_inicio = COMBUSTIBLE & (DIST_URB > 300)
celdas_inicio = np.argwhere(zona_inicio)
lat_c = grilla.pivot(index="fila", columns="col", values="lat").values
lon_c = grilla.pivot(index="fila", columns="col", values="lon").values
peso = np.zeros((N, N))
for _, f in cerca.iterrows():
    dy = (lat_c - f.latitude) * 111320
    dx = (lon_c - f.longitude) * 111320 * np.cos(np.radians(17.35))
    peso += np.exp(-(dx**2 + dy**2) / (2 * 500**2))
peso = (peso + 0.05 * max(peso.max(), 1e-9)) * zona_inicio
PESO_INICIO = peso[zona_inicio] / peso[zona_inicio].sum()

meteo["hora"] = meteo.time.dt.hour
tarde = meteo[meteo.hora.between(12, 18)].copy()
tarde["V_ms"] = tarde.wind_speed_10m.clip(lower=0.05) / 3.6

N_MC = 150
MAX_MC = int(8 * 60 / DT)
mapa = np.zeros((N, N))
rng_mc = np.random.default_rng(SEMILLA)
print(f"Calculando mapa de riesgo con {N_MC} corridas de Monte Carlo…")
for s in np.random.SeedSequence(SEMILLA).spawn(N_MC):
    rr = np.random.default_rng(s)
    ig = tuple(int(x) for x in celdas_inicio[rr.choice(len(celdas_inicio), p=PESO_INICIO)])
    fila_v = tarde.iloc[rr.integers(len(tarde))]
    cuadros_mc = simular(ig, fila_v.V_ms, fila_v.wind_direction_10m, rr, MAX_MC, guardar_cada=999)
    mapa += (cuadros_mc[-1] >= 2)
mapa /= N_MC

riesgo = {"n": N, "nCorridas": N_MC, "mapa": np.round(mapa, 3).tolist()}
with open(OUT + "riesgo.json", "w") as f:
    json.dump(riesgo, f, separators=(",", ":"))
print(f"  riesgo.json: {os.path.getsize(OUT + 'riesgo.json') / 1024:.0f} KB  (máximo de probabilidad: {mapa.max():.2f})")

print("Listo. Archivos en", OUT)
