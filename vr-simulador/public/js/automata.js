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

  function simular({ ignicionI, ignicionJ, vientoMs, dirDesde, humedadPct, maxPasos, estadoInicial, guardarCada = 4, onProgreso }) {
    const phEfectivo = Math.min(1, Math.max(0, parametros.pH * factorHumedad(humedadPct)));
    const base = estadoInicial || COMBUSTIBLE;
    const E = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) E[k] = base[k] ? 1 : 0;
    const R = new Int16Array(N * N);
    const igK = ignicionI * N + ignicionJ;
    E[igK] = 2;
    R[igK] = TAU[igK];

    const Pk = matricesProbabilidad(vientoMs, dirDesde, phEfectivo);
    const saltos = probSaltos(vientoMs, dirDesde);

    const cuadros = [E.slice()];
    let estado = E, radio = R;
    for (let paso_ = 0; paso_ < maxPasos; paso_++) {
      const [E2, R2] = paso(estado, radio, Pk, saltos);
      estado = E2; radio = R2;
      if ((paso_ + 1) % guardarCada === 0) cuadros.push(estado.slice());
      let hayFuego = false;
      for (let k = 0; k < N * N; k++) { if (estado[k] === 2) { hayFuego = true; break; } }
      if (onProgreso && paso_ % 8 === 0) onProgreso(paso_ / maxPasos);
      if (!hayFuego) break;
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

  return { simular, N, COMBUSTIBLE, phEfectivoDe: (h) => Math.min(1, Math.max(0, parametros.pH * factorHumedad(h))) };
}
