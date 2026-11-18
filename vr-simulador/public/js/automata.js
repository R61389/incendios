/* ------------------------------------------------------------------ *
 * Autómata celular del incendio, portado a JS desde export_data.py
 * (que a su vez reimplementa el notebook G3_Incendios_Tunari_Simulacion).
 * Corre en el navegador para el "modo interactivo": el usuario cambia
 * viento/humedad y puede dibujar su propio cortafuegos, y esto vuelve a
 * simular con los MISMOS coeficientes calibrados (parametros.json) en vez
 * de solo reproducir frames pregrabados.
 *
 * Ajuste nuevo (no estaba en el modelo original de Alexandridis et al.
 * calibrado en el informe): la humedad del aire no forma parte de la
 * fórmula de propagación original, que solo usa viento + pendiente +
 * vegetación. Para que el control de humedad tenga efecto real se agrega
 * un factor simple y declarado sobre p_h — ver `factorHumedad` abajo.
 * ------------------------------------------------------------------ */

const VECINAS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function desplazar(M, df, dc, relleno, N) {
  const S = new Float64Array(N * N).fill(relleno);
  const fiStart = Math.max(0, -df), fiEnd = N - Math.max(0, df);
  const ciStart = Math.max(0, -dc), ciEnd = N - Math.max(0, dc);
  const foStart = Math.max(0, df), coStart = Math.max(0, dc);
  for (let i = fiStart; i < fiEnd; i++) {
    const si = i - fiStart + foStart;
    for (let j = ciStart; j < ciEnd; j++) {
      const sj = j - ciStart + coStart;
      S[i * N + j] = M[si * N + sj];
    }
  }
  return S;
}

export function construirAutomata(terreno, parametros) {
  const N = terreno.n;
  const ELEV = new Float64Array(N * N);
  const CLASE = new Int32Array(N * N);
  const PVEG = new Float64Array(N * N);
  const PDEN = new Float64Array(N * N);
  const COMBUSTIBLE = new Uint8Array(N * N);
  const TAU = new Int16Array(N * N);
  // Borde urbano (igual que BORDE en el cuaderno: celdas combustibles vecinas
  // —vecindad de Moore 3×3— a una celda urbana). Si una celda del borde arde,
  // el fuego "alcanzó las viviendas".
  const BORDE = new Uint8Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      ELEV[k] = terreno.elevacion[i][j];
      const c = terreno.clase[i][j];
      CLASE[k] = c;
      PDEN[k] = terreno.densidadAjuste[i][j];
      const combustible = c === 10 || c === 20 || c === 30 || c === 40;
      COMBUSTIBLE[k] = combustible ? 1 : 0;
      PVEG[k] = parametros.pVeg[String(c)] ?? 0;
      TAU[k] = c === 10 ? parametros.pasosArdiendoArborea : parametros.pasosArdiendo;
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      if (!COMBUSTIBLE[k]) continue;
      for (let di = -1; di <= 1 && !BORDE[k]; di++) {
        for (let dj = -1; dj <= 1 && !BORDE[k]; dj++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < N && jj < N && terreno.urbano[ii][jj]) BORDE[k] = 1;
        }
      }
    }
  }

  function matricesProbabilidad(V, dirDesde, phEfectivo) {
    const hacia = (dirDesde + 180) * Math.PI / 180;
    const wE = Math.sin(hacia), wN = Math.cos(hacia);
    const salida = [];
    for (const [df, dc] of VECINAS) {
      const hip = Math.hypot(df, dc);
      const d = parametros.tamanoCeldaM * hip;
      const pE = -dc / hip, pN = df / hip;
      const cosphi = wE * pE + wN * pN;
      const pw = Math.exp(V * (parametros.c1 + parametros.c2 * (cosphi - 1)));
      const elevVecina = desplazar(ELEV, df, dc, NaN, N);
      const prob = new Float64Array(N * N);
      for (let k = 0; k < N * N; k++) {
        const diff = ELEV[k] - elevVecina[k];
        const theta = Number.isNaN(diff) ? 0 : Math.atan(diff / d) * 180 / Math.PI;
        const ps = Math.exp(parametros.a * theta);
        const p = phEfectivo * (1 + PVEG[k]) * (1 + PDEN[k]) * pw * ps;
        prob[k] = Math.min(1, Math.max(0, p));
      }
      salida.push(prob);
    }
    return salida;
  }

  function probSaltos(V, dirDesde) {
    const hacia = (dirDesde + 180) * Math.PI / 180;
    const wE = Math.sin(hacia), wN = Math.cos(hacia);
    const saltos = [];
    for (const [df, dc] of VECINAS) {
      const hip = Math.hypot(df, dc);
      const cosphi = wE * (-dc / hip) + wN * (df / hip);
      const p = parametros.sSalto * V * Math.max(cosphi, 0);
      if (p > 0) {
        for (const m of [2, 3]) saltos.push([df * m, dc * m, p / m]);
      }
    }
    return saltos;
  }

  function paso(E, R, Pk, saltos) {
    const ardiendo = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) ardiendo[k] = E[k] === 2 ? 1 : 0;
    const noEnciende = new Float64Array(N * N).fill(1);
    for (let v = 0; v < VECINAS.length; v++) {
      const [df, dc] = VECINAS[v];
      const vecinaArde = desplazar(ardiendo, df, dc, 0, N);
      const pk = Pk[v];
      for (let k = 0; k < N * N; k++) {
        if (vecinaArde[k]) noEnciende[k] *= (1 - pk[k]);
      }
    }
    for (const [df, dc, p] of saltos) {
      const vecinaArde = desplazar(ardiendo, df, dc, 0, N);
      for (let k = 0; k < N * N; k++) {
        if (vecinaArde[k]) noEnciende[k] *= (1 - p);
      }
    }
    const E2 = E.slice(), R2 = R.slice();
    for (let k = 0; k < N * N; k++) {
      if (E[k] === 1 && Math.random() < 1 - noEnciende[k]) {
        E2[k] = 2;
        R2[k] = TAU[k];
      }
    }
    for (let k = 0; k < N * N; k++) {
      if (ardiendo[k]) {
        R2[k] -= 1;
        if (R2[k] <= 0) E2[k] = 3;
      }
    }
    return [E2, R2];
  }

  // Ajuste nuevo y declarado: a menor humedad relativa que la de referencia
  // (humedadRefPct, del clima real del "peor día"), más fácil prende el
  // fuego; a mayor humedad, más cuesta. Sensibilidad moderada (±1.5% de
  // p_h por cada punto de humedad de diferencia), para que el control
  // tenga un efecto visible sin volverse absurdo en los extremos.
  function factorHumedad(humedadPct) {
    const ref = parametros.humedadRefPct;
    const k = 0.015;
    return Math.min(2.5, Math.max(0.15, 1 + k * (ref - humedadPct)));
  }

  // Cortafuegos construido durante el incendio (ataque indirecto), igual que
  // simular_incendio(..., linea, t_llegada, cuadrillas, rendimiento) del
  // cuaderno: a partir del minuto de llegada, en cada paso se vuelven no
  // quemables tantas celdas de la línea como permite el rendimiento
  // (cuadrillas × m/h × minutos_por_paso / 60 / tamaño de celda), empezando
  // por el tramo de línea más cercano al fuego.
  function iniciarConstruccionLinea(lineaMask, E) {
    const pendientes = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const k = i * N + j;
        if (lineaMask[k] && E[k] === 1) pendientes.push([i, j]);
      }
    }
    return pendientes;
  }

  function avanzarConstruccionLinea(E, pendientes, construidasPorPaso, acumuladoRef) {
    if (!pendientes.length) return acumuladoRef.v;
    let sumI = 0, sumJ = 0, n = 0;
    for (let k = 0; k < N * N; k++) {
      if (E[k] === 2) { sumI += Math.floor(k / N); sumJ += k % N; n++; }
    }
    if (n === 0) return acumuladoRef.v;
    const fi = sumI / n, fj = sumJ / n;
    pendientes.sort((a, b) => ((a[0] - fi) ** 2 + (a[1] - fj) ** 2) - ((b[0] - fi) ** 2 + (b[1] - fj) ** 2));
    acumuladoRef.v += construidasPorPaso;
    while (acumuladoRef.v >= 1 && pendientes.length) {
      const [i, j] = pendientes.shift();
      acumuladoRef.v -= 1;
      const k = i * N + j;
      if (E[k] === 1) E[k] = 0;
    }
    return acumuladoRef.v;
  }

  function simular({
    ignicionI, ignicionJ, vientoMs, dirDesde, humedadPct, maxPasos, estadoInicial, guardarCada = 4, onProgreso,
    linea, tLlegadaMin, cuadrillas, rendimientoMH, soloResultado = false,
  }) {
    const phEfectivo = Math.min(1, Math.max(0, parametros.pH * factorHumedad(humedadPct)));
    const base = estadoInicial || COMBUSTIBLE;
    const E = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) E[k] = base[k] ? 1 : 0;
    const R = new Int16Array(N * N);
    const igK = ignicionI * N + ignicionJ;
    if (E[igK] !== 1) {
      return soloResultado ? { ha: 0, llegaBorde: false, pasoBorde: null, pasos: 0 } : [];
    }
    E[igK] = 2;
    R[igK] = TAU[igK];

    const Pk = matricesProbabilidad(vientoMs, dirDesde, phEfectivo);
    const saltos = probSaltos(vientoMs, dirDesde);

    const dtMin = parametros.minutosPorPaso;
    let pendientes = null, construidasPorPaso = 0;
    const acumulado = { v: 0 };
    if (linea && cuadrillas > 0) {
      pendientes = iniciarConstruccionLinea(linea, E);
      construidasPorPaso = (cuadrillas * rendimientoMH * dtMin) / 60 / parametros.tamanoCeldaM;
    }

    const cuadros = soloResultado ? null : [E.slice()];
    let estado = E, radio = R;
    let llegaBorde = BORDE[igK] === 1, pasoBorde = llegaBorde ? 0 : null;
    let pasosHechos = 0;
    for (let paso_ = 0; paso_ < maxPasos; paso_++) {
      if (pendientes && tLlegadaMin != null && paso_ * dtMin >= tLlegadaMin) {
        avanzarConstruccionLinea(estado, pendientes, construidasPorPaso, acumulado);
      }
      const [E2, R2] = paso(estado, radio, Pk, saltos);
      estado = E2; radio = R2;
      pasosHechos = paso_ + 1;
      if (!llegaBorde) {
        for (let k = 0; k < N * N; k++) {
          if (estado[k] === 2 && BORDE[k]) { llegaBorde = true; pasoBorde = paso_ + 1; break; }
        }
      }
      if (!soloResultado && (paso_ + 1) % guardarCada === 0) cuadros.push(estado.slice());
      let hayFuego = false;
      for (let k = 0; k < N * N; k++) { if (estado[k] === 2) { hayFuego = true; break; } }
      if (onProgreso && paso_ % 8 === 0) onProgreso(paso_ / maxPasos);
      if (!hayFuego) break;
    }

    if (soloResultado) {
      let haQuemadas = 0;
      for (let k = 0; k < N * N; k++) if (estado[k] >= 2) haQuemadas++;
      const ha = haQuemadas * (parametros.tamanoCeldaM ** 2) / 10000;
      return { ha, llegaBorde, pasoBorde, pasos: pasosHechos };
    }

    cuadros.push(estado.slice());
    // de Uint8Array planos a arrays 2D (mismo formato que fuego_base.json)
    const frames = cuadros.map((cu) => {
      const f = [];
      for (let i = 0; i < N; i++) {
        const fila = new Array(N);
        for (let j = 0; j < N; j++) fila[j] = cu[i * N + j];
        f.push(fila);
      }
      return f;
    });
    return frames;
  }

  // Barrido de Monte Carlo para recomendar cuántas cuadrillas se necesitan:
  // repite simular_incendio con cortafuegos construido durante la corrida
  // (igual que la sección 11.3 del cuaderno) para cada cantidad candidata de
  // cuadrillas, y promedia P(alcanza las viviendas) y hectáreas quemadas. Es
  // un generador: cada yield entrega la fracción de avance (0..1), y el
  // valor final (gen.next().value cuando done) es el array de resultados.
  // Quien lo consuma debe ceder el hilo (setTimeout/rAF) entre llamadas a
  // next() para no congelar la pestaña mientras corre.
  function* recomendarCuadrillasGen({
    ignicionI, ignicionJ, vientoMs, dirDesde, humedadPct, maxPasos, linea,
    tLlegadaMin, rendimientoMH, candidatos, corridas,
  }) {
    const resultados = [];
    const total = candidatos.length * corridas;
    let hechas = 0;
    for (const cuadrillas of candidatos) {
      let llegas = 0, haSum = 0;
      for (let r = 0; r < corridas; r++) {
        const res = simular({
          ignicionI, ignicionJ, vientoMs, dirDesde, humedadPct, maxPasos,
          linea, tLlegadaMin, cuadrillas, rendimientoMH, soloResultado: true,
        });
        if (res.llegaBorde) llegas++;
        haSum += res.ha;
        hechas++;
        yield hechas / total;
      }
      resultados.push({ cuadrillas, pViviendas: llegas / corridas, haMedia: haSum / corridas, corridas });
    }
    return resultados;
  }

  return {
    simular, recomendarCuadrillasGen, N, COMBUSTIBLE, BORDE,
    phEfectivoDe: (h) => Math.min(1, Math.max(0, parametros.pH * factorHumedad(h))),
  };
}
