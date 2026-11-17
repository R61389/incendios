import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Simulador VR de incendios — Parque Nacional Tunari, sector Cercado
 *  Usa los datos reales del proyecto SIM-522 (Grupo 3): la grilla de
 *  elevación/vegetación y una corrida calibrada del autómata celular
 *  (p_h = 0,072, viento del "peor día"), exportadas por export_data.py.
 * ------------------------------------------------------------------ */

const COLORES_CLASE = {
  10: 0x3a5e32, // arbórea (eucalipto/pino) — verde oliva oscuro, real
  20: 0x87954a, // matorral — verde seco
  30: 0xc6a052, // pastizal (pajonal) — dorado seco de época seca
  40: 0xad8550, // cultivo — pardo tierra
  50: 0x8d8579, // zona construida — gris cálido (techos/calles)
  60: 0xa89d89, // roca / suelo desnudo — beige grisáceo
  80: 0x3f7096, // agua — azul profundo
};

/* ---------------------- ruido simple (sin dependencias) ------------------- */
function hashRuido(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function ruidoSuave(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h00 = hashRuido(xi, yi), h10 = hashRuido(xi + 1, yi);
  const h01 = hashRuido(xi, yi + 1), h11 = hashRuido(xi + 1, yi + 1);
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}
function ruidoFBM(x, y) {
  return ruidoSuave(x, y) * 0.55 + ruidoSuave(x * 2.6, y * 2.6) * 0.3 + ruidoSuave(x * 7.1, y * 7.1) * 0.15;
}
const COLOR_EN_LLAMAS = new THREE.Color(0xff6a1a);
const COLOR_QUEMADA = new THREE.Color(0x2a1812);
const COLOR_CORTAFUEGOS = new THREE.Color(0x3a3a3a);

/* ------------------- texturas procedurales del terreno -------------------
 * Sin internet disponible: en vez de imágenes reales, generamos "pasto seco",
 * "roca" y "tierra" con ruido en un canvas. El shader del terreno las mezcla
 * según la pendiente y la altura de cada punto (ver aplicarShaderTerreno). */
function generarTexturaSuelo(tipo) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const paletas = {
    pasto: [[0xb8, 0x8f, 0x45], [0xd9, 0xb0, 0x5e], [0x8f, 0x72, 0x33]],
    roca: [[0x6e, 0x68, 0x60], [0x8a, 0x83, 0x79], [0x4a, 0x46, 0x40]],
    tierra: [[0x6b, 0x4a, 0x2e], [0x8a, 0x61, 0x3c], [0x4a, 0x32, 0x1e]],
  };
  const pal = paletas[tipo];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n1 = ruidoFBM(x * 0.08, y * 0.08);
      const n2 = ruidoFBM(x * 0.35 + 50, y * 0.35 + 50);
      let mezcla = pal[0].map((_, ch) => pal[0][ch] * (1 - n1) + pal[1][ch] * n1);
      mezcla = mezcla.map((v, ch) => v * (1 - n2 * 0.4) + pal[2][ch] * (n2 * 0.4));
      const k = (y * S + x) * 4;
      img.data[k] = mezcla[0]; img.data[k + 1] = mezcla[1]; img.data[k + 2] = mezcla[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function aplicarShaderTerreno(mat, elevMin, elevMax) {
  const tPasto = generarTexturaSuelo('pasto');
  const tRoca = generarTexturaSuelo('roca');
  const tTierra = generarTexturaSuelo('tierra');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tPasto = { value: tPasto };
    shader.uniforms.tRoca = { value: tRoca };
    shader.uniforms.tTierra = { value: tTierra };
    shader.uniforms.uElevMin = { value: elevMin };
    shader.uniforms.uElevMax = { value: elevMax };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSlope;\nvarying float vAltura;\nvarying vec2 vMiUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAltura = (modelMatrix * vec4(transformed, 1.0)).y;\n  vMiUv = uv;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vSlope = 1.0 - abs((modelMatrix * vec4(objectNormal, 0.0)).y);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vSlope;
varying float vAltura;
varying vec2 vMiUv;
uniform sampler2D tPasto;
uniform sampler2D tRoca;
uniform sampler2D tTierra;
uniform float uElevMin;
uniform float uElevMax;`)
      .replace('#include <color_fragment>', `
  {
    float rep = 26.0;
    vec3 bPasto = texture(tPasto, vMiUv * rep).rgb;
    vec3 bTierra = texture(tTierra, vMiUv * rep * 1.6).rgb;
    vec3 bRoca = texture(tRoca, vMiUv * rep * 0.9).rgb;
    float alturaN = clamp((vAltura - uElevMin) / max(0.0001, (uElevMax - uElevMin)), 0.0, 1.0);
    float factorRoca = smoothstep(0.32, 0.62, vSlope) * 0.85 + smoothstep(0.78, 1.0, alturaN) * 0.6;
    factorRoca = clamp(factorRoca, 0.0, 1.0);
    float factorTierra = smoothstep(0.14, 0.34, vSlope) * (1.0 - factorRoca) * 0.8;
    vec3 base = mix(bPasto, bTierra, factorTierra);
    base = mix(base, bRoca, factorRoca);
    diffuseColor.rgb = base;
  }
#include <color_fragment>`);
  };
  mat.customProgramCacheKey = () => 'terrenoShader';
}

const WORLD_SIZE = 60;      // tamaño del terreno en unidades Three.js (metros "escénicos")
const ALTURA_EXAGERA = 1.8; // exageración vertical para que el relieve se note en VR

const state = {
  terreno: null,
  escenarios: {},
  escenarioActual: 'base',
  frameIdx: 0,
  playing: true,
  playSpeed: 2.2, // frames por segundo de animación
  acumulador: 0,
  modoRiesgo: false,
};

const $ = (id) => document.getElementById(id);

const BOOT_LINES = [
  'INICIALIZANDO SISTEMA…',
  'CARGANDO GRILLA DEL SECTOR CERCADO…',
  'LEYENDO ELEVACIÓN Y VEGETACIÓN REAL…',
  'SINCRONIZANDO AUTÓMATA CALIBRADO…',
  'CARGANDO MAPA DE RIESGO (150 CORRIDAS)…',
  'ENLAZANDO CON DRON-01…',
];

async function cargarDatos() {
  let i = 0;
  const bootEl = document.getElementById('bootText');
  const bootTimer = setInterval(() => {
    i = (i + 1) % BOOT_LINES.length;
    if (bootEl) bootEl.textContent = BOOT_LINES[i];
  }, 650);

  const [terreno, base, corta, riesgo] = await Promise.all([
    fetch('./data/terreno.json').then((r) => r.json()),
    fetch('./data/fuego_base.json').then((r) => r.json()),
    fetch('./data/fuego_cortafuegos250.json').then((r) => r.json()),
    fetch('./data/riesgo.json').then((r) => r.json()),
  ]);
  state.terreno = terreno;
  state.escenarios.base = base;
  state.escenarios.cortafuegos250 = corta;
  state.riesgo = riesgo;
  clearInterval(bootTimer);
  if (bootEl) bootEl.textContent = 'SISTEMA LISTO.';
}

/* ---------------------- construcción de la escena ------------------- */

let renderer, scene, camera, controls;
let fireMesh, smokeSystem, fireParticles;
let terrainGeo, terrainColorAttr, terrainColorOriginal;
let lucesIncendio = [];
let combustibleIdx = []; // [{i,j,x,y,z}]
let heightAt; // función (i,j)->altura escénica

let nubes = [];

function crearCieloYLuces() {
  // Cúpula de cielo con degradado (cenit azul pálido -> horizonte cálido de tarde)
  const radioCielo = WORLD_SIZE * 4;
  const geoCielo = new THREE.SphereGeometry(radioCielo, 32, 20);
  const posC = geoCielo.attributes.position;
  const coloresCielo = new Float32Array(posC.count * 3);
  const cZenit = new THREE.Color(0x5f8fc4);
  const cHorizonte = new THREE.Color(0xf6c89a);
  const cBajoHorizonte = new THREE.Color(0xcf9f6e);
  const tmp = new THREE.Color();
  for (let k = 0; k < posC.count; k++) {
    const y = posC.getY(k) / radioCielo; // -1..1
    let t;
    if (y >= 0) { t = Math.pow(1 - y, 1.6); tmp.copy(cZenit).lerp(cHorizonte, t); }
    else { t = Math.pow(1 + y * 3, 1.2); tmp.copy(cBajoHorizonte).lerp(cHorizonte, Math.max(0, t)); }
    coloresCielo[k * 3] = tmp.r; coloresCielo[k * 3 + 1] = tmp.g; coloresCielo[k * 3 + 2] = tmp.b;
  }
  geoCielo.setAttribute('color', new THREE.BufferAttribute(coloresCielo, 3));
  const matCielo = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(geoCielo, matCielo));

  scene.background = new THREE.Color(0xdcb98e);
  // niebla anaranjada-grisácea: simula la calina de humo de un incendio real
  scene.fog = new THREE.FogExp2(0xcdb196, 0.0135);

  const hemi = new THREE.HemisphereLight(0xfff0dd, 0x4a4433, 1.15);
  scene.add(hemi);

  const sol = new THREE.DirectionalLight(0xffecc8, 2.3);
  sol.position.set(-WORLD_SIZE * 0.5, WORLD_SIZE * 0.6, WORLD_SIZE * 0.2); // tarde, sol bajo
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.camera.left = -WORLD_SIZE; sol.shadow.camera.right = WORLD_SIZE;
  sol.shadow.camera.top = WORLD_SIZE; sol.shadow.camera.bottom = -WORLD_SIZE;
  scene.add(sol);

  // resplandor del sol (sprite con degradado radial, sin textura externa)
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,244,214,0.95)');
  g.addColorStop(0.35, 'rgba(255,220,160,0.45)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const solSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false,
  }));
  solSprite.scale.set(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1, 1);
  solSprite.position.copy(sol.position).multiplyScalar(3);
  scene.add(solSprite);

  // nubes simples (sprites con degradado suave), derivando lentamente
  const cNube = document.createElement('canvas'); cNube.width = cNube.height = 128;
  const ctxN = cNube.getContext('2d');
  const gN = ctxN.createRadialGradient(64, 64, 10, 64, 64, 64);
  gN.addColorStop(0, 'rgba(255,250,245,0.85)');
  gN.addColorStop(0.6, 'rgba(255,245,235,0.4)');
  gN.addColorStop(1, 'rgba(255,245,235,0)');
  ctxN.fillStyle = gN; ctxN.fillRect(0, 0, 128, 128);
  const texNube = new THREE.CanvasTexture(cNube);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texNube, transparent: true, depthWrite: false, opacity: 0.8 }));
    const escala = WORLD_SIZE * (0.5 + Math.random() * 0.6);
    s.scale.set(escala * 1.6, escala * 0.7, 1);
    s.position.set((Math.random() - 0.5) * WORLD_SIZE * 3.5, WORLD_SIZE * (0.55 + Math.random() * 0.35), (Math.random() - 0.5) * WORLD_SIZE * 3.5);
    scene.add(s);
    nubes.push({ sprite: s, vel: 0.15 + Math.random() * 0.25 });
  }
}

function actualizarNubes(dt) {
  for (const n of nubes) {
    n.sprite.position.x += n.vel * dt;
    if (n.sprite.position.x > WORLD_SIZE * 2) n.sprite.position.x = -WORLD_SIZE * 2;
  }
}

function construirTerreno() {
  const t = state.terreno;
  const n = t.n;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colores = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const elevRango = Math.max(1, t.elevMax - t.elevMin);

  heightAt = (i, j) => {
    const e = t.elevacion[i][j];
    return ((e - t.elevMin) / elevRango) * (WORLD_SIZE * 0.22) * ALTURA_EXAGERA;
  };

  // La grilla fila=i (norte->sur), col=j (oeste->este); PlaneGeometry recorre
  // filas de -Z a +Z y columnas de -X a +X en el mismo orden de creación.
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      pos.setY(k, heightAt(i, j));
      let clase = t.clase[i][j];
      if (t.lineaCortafuegos250[i][j]) {
        color.copy(COLOR_CORTAFUEGOS);
      } else {
        color.set(COLORES_CLASE[clase] ?? 0x999999);
        // Variación natural tipo "parches" (más real que un color plano por celda)
        const ruido = ruidoFBM(i * 0.14, j * 0.14);
        color.getHSL(hsl);
        hsl.l = Math.min(0.92, Math.max(0.05, hsl.l + (ruido - 0.5) * 0.22));
        hsl.s = Math.min(1, Math.max(0, hsl.s * (0.85 + ruido * 0.3)));
        color.setHSL(hsl.h, hsl.s, hsl.l);
      }
      colores[k * 3] = color.r; colores[k * 3 + 1] = color.g; colores[k * 3 + 2] = color.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: false,
  });
  aplicarShaderTerreno(mat, 0, (WORLD_SIZE * 0.22) * ALTURA_EXAGERA);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  terrainGeo = geo;
  terrainColorAttr = geo.attributes.color;
  terrainColorOriginal = colores.slice();

  // marcador de viviendas (zona urbana) con un leve relieve para que se note desde VR
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (t.clase[i][j] === 10 || t.clase[i][j] === 20 || t.clase[i][j] === 30 || t.clase[i][j] === 40) {
        combustibleIdx.push({ i, j });
      }
    }
  }
}

/* ------------------------- vegetación real (árboles y pasto) ------------------------- */

let arbolMesh, troncoMesh, pastoMesh;
let vegArbolAt, vegPastoAt; // por índice de combustibleIdx: nº de instancia, o -1
let arbolMatOrig = [], pastoMatOrig = []; // para restaurar al retroceder la línea de tiempo
const MAT_CERO = new THREE.Matrix4().makeScale(0, 0, 0);

function texturaHoja() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#000';
  for (const [x1, x2] of [[6, 10], [14, 18], [22, 26]]) {
    ctx.beginPath();
    ctx.moveTo(x1, 32); ctx.quadraticCurveTo((x1 + x2) / 2, 10, x2, 2);
    ctx.quadraticCurveTo((x1 + x2) / 2, 18, x1, 32);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function construirVegetacion() {
  const t = state.terreno;
  const n = t.n;
  vegArbolAt = new Int32Array(combustibleIdx.length).fill(-1);
  vegPastoAt = new Int32Array(combustibleIdx.length).fill(-1);

  // --- árboles: copa (cono) + tronco, uno por celda arbórea (con algo de salteo) ---
  const idxArboles = [];
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    if (t.clase[i][j] === 10 && !t.lineaCortafuegos250[i][j] && Math.random() < 0.92) idxArboles.push(k);
  }
  const copaGeo = new THREE.ConeGeometry(0.42, 1.5, 6);
  copaGeo.translate(0, 0.75, 0);
  const copaMat = new THREE.MeshStandardMaterial({ color: 0x2f4f2a, roughness: 0.95 });
  arbolMesh = new THREE.InstancedMesh(copaGeo, copaMat, idxArboles.length);
  arbolMesh.castShadow = true; arbolMesh.receiveShadow = true;
  arbolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const troncoGeo = new THREE.CylinderGeometry(0.075, 0.1, 0.55, 5);
  troncoGeo.translate(0, 0.28, 0);
  const troncoMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  troncoMesh = new THREE.InstancedMesh(troncoGeo, troncoMat, idxArboles.length);
  troncoMesh.castShadow = true;
  troncoMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const col = new THREE.Color();
  const colorArbol = [0x2f4f2a, 0x3a5e32, 0x27431f];
  for (let a = 0; a < idxArboles.length; a++) {
    const k = idxArboles[a]; vegArbolAt[k] = a;
    const { i, j } = combustibleIdx[k];
    const [cx, cz] = xzDe(i, j);
    const jitter = (WORLD_SIZE / n) * 0.8;
    const x = cx + (Math.random() - 0.5) * jitter, z = cz + (Math.random() - 0.5) * jitter;
    const y = heightAt(i, j);
    const esc = 0.8 + Math.random() * 0.8;
    q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(esc, esc * (0.9 + Math.random() * 0.4), esc));
    arbolMesh.setMatrixAt(a, m); troncoMesh.setMatrixAt(a, m); arbolMatOrig[a] = m.clone();
    col.set(colorArbol[a % colorArbol.length]);
    arbolMesh.setColorAt(a, col);
  }
  arbolMesh.instanceMatrix.needsUpdate = true; troncoMesh.instanceMatrix.needsUpdate = true;
  scene.add(arbolMesh); scene.add(troncoMesh);

  // --- pasto/matorral: mata cruzada (2 planos en X) por celda, con textura de hojas ---
  const idxPasto = [];
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    const c = t.clase[i][j];
    if ((c === 20 || c === 30 || c === 40) && !t.lineaCortafuegos250[i][j] && Math.random() < 0.55) idxPasto.push(k);
  }
  const p1 = new THREE.PlaneGeometry(0.55, 0.42); p1.translate(0, 0.21, 0);
  const p2 = p1.clone(); p2.rotateY(Math.PI / 2);
  const posArr = new Float32Array((p1.attributes.position.count + p2.attributes.position.count) * 3);
  const uvArr = new Float32Array((p1.attributes.uv.count + p2.attributes.uv.count) * 2);
  posArr.set(p1.attributes.position.array, 0); posArr.set(p2.attributes.position.array, p1.attributes.position.array.length);
  uvArr.set(p1.attributes.uv.array, 0); uvArr.set(p2.attributes.uv.array, p1.attributes.uv.array.length);
  const idxArr = new Uint16Array([...p1.index.array, ...p2.index.array.map((v) => v + p1.attributes.position.count)]);
  const pastoGeo = new THREE.BufferGeometry();
  pastoGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  pastoGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  pastoGeo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  pastoGeo.computeVertexNormals();
  const pastoMat = new THREE.MeshStandardMaterial({
    map: texturaHoja(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, vertexColors: true,
  });
  pastoMesh = new THREE.InstancedMesh(pastoGeo, pastoMat, idxPasto.length);
  pastoMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pastoMesh.castShadow = false; pastoMesh.receiveShadow = true;
  const colorPasto = { 20: [0x7c8f3d, 0x6c7f34], 30: [0xb89248, 0xc6a052], 40: [0x9b7640, 0xad8550] };
  for (let a = 0; a < idxPasto.length; a++) {
    const k = idxPasto[a]; vegPastoAt[k] = a;
    const { i, j } = combustibleIdx[k];
    const c = t.clase[i][j];
    const [cx, cz] = xzDe(i, j);
    const jitter = (WORLD_SIZE / n) * 0.85;
    const x = cx + (Math.random() - 0.5) * jitter, z = cz + (Math.random() - 0.5) * jitter;
    const y = heightAt(i, j);
    const esc = 0.7 + Math.random() * 0.7;
    q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(esc, esc, esc));
    pastoMesh.setMatrixAt(a, m); pastoMatOrig[a] = m.clone();
    const paleta = colorPasto[c] || colorPasto[30];
    col.set(paleta[a % paleta.length]);
    pastoMesh.setColorAt(a, col);
  }
  pastoMesh.instanceMatrix.needsUpdate = true;
  scene.add(pastoMesh);
}

let vegCambioArbol = false, vegCambioPasto = false;
/** Oculta (si se quemó) o restaura (si no) la vegetación de una celda. */
function actualizarVegetacionCelda(k, quemada) {
  const a = vegArbolAt[k];
  if (a >= 0) {
    arbolMesh.setMatrixAt(a, quemada ? MAT_CERO : arbolMatOrig[a]);
    troncoMesh.setMatrixAt(a, quemada ? MAT_CERO : arbolMatOrig[a]);
    vegCambioArbol = true;
  }
  const p = vegPastoAt[k];
  if (p >= 0) {
    pastoMesh.setMatrixAt(p, quemada ? MAT_CERO : pastoMatOrig[p]);
    vegCambioPasto = true;
  }
}
function finalizarActualizacionVegetacion() {
  if (vegCambioArbol) { arbolMesh.instanceMatrix.needsUpdate = true; troncoMesh.instanceMatrix.needsUpdate = true; vegCambioArbol = false; }
  if (vegCambioPasto) { pastoMesh.instanceMatrix.needsUpdate = true; vegCambioPasto = false; }
}

function xzDe(i, j) {
  const n = state.terreno.n;
  const x = (j / (n - 1) - 0.5) * WORLD_SIZE;
  const z = (i / (n - 1) - 0.5) * WORLD_SIZE;
  return [x, z];
}

function construirOverlayDeFuego() {
  // InstancedMesh de "columnas" — hoy solo se usa para el mapa de riesgo
  // (barras 3D de probabilidad). El fuego real se dibuja con partículas
  // (ver construirFuego) y el terreno quemado se oscurece sobre la marcha.
  const n = state.terreno.n;
  const tileSize = (WORLD_SIZE / n) * 1.02;
  const geo = new THREE.BoxGeometry(tileSize, 1, tileSize);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: false, emissive: 0x000000, roughness: 0.85, transparent: true,
  });
  fireMesh = new THREE.InstancedMesh(geo, mat, combustibleIdx.length);
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireMesh.castShadow = false;
  fireMesh.visible = false;
  const m = new THREE.Matrix4();
  for (let k = 0; k < combustibleIdx.length; k++) {
    m.makeScale(0.0001, 0.0001, 0.0001);
    fireMesh.setMatrixAt(k, m);
  }
  scene.add(fireMesh);
}

/* -------------------- partículas (fuego y humo) con alpha/tamaño por partícula -------------------- */

function texturaRadial(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [off, col] of stops) g.addColorStop(off, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const texturaHumo = () => texturaRadial([[0, 'rgba(210,205,195,0.55)'], [0.5, 'rgba(160,155,150,0.25)'], [1, 'rgba(160,155,150,0)']]);
const texturaFuego = () => texturaRadial([[0, 'rgba(255,245,200,0.95)'], [0.35, 'rgba(255,150,40,0.85)'], [0.7, 'rgba(255,60,20,0.35)'], [1, 'rgba(255,40,10,0)']]);

/** Material de puntos con alpha y escala POR PARTÍCULA (PointsMaterial normal solo
 * tiene un size/opacity global; aquí se inyectan dos atributos vía onBeforeCompile). */
function materialParticulas(map, colorBase, blending) {
  const mat = new THREE.PointsMaterial({
    size: 1, map, transparent: true, depthWrite: false, sizeAttenuation: true,
    color: colorBase, blending: blending || THREE.NormalBlending,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nattribute float aScale;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = aAlpha;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  return mat;
}

function crearPool(max, map, colorBase, blending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(max), 1));
  geo.setAttribute('aScale', new THREE.BufferAttribute(new Float32Array(max), 1));
  const points = new THREE.Points(geo, materialParticulas(map, colorBase, blending));
  points.frustumCulled = false;
  scene.add(points);
  return {
    points, geo, max, next: 0,
    vel: new Array(max).fill(null).map(() => new THREE.Vector3()),
    life: new Float32Array(max), age: new Float32Array(max),
    tam0: new Float32Array(max), tam1: new Float32Array(max),
  };
}

function construirHumo() {
  smokeSystem = crearPool(500, texturaHumo(), 0xd8d2c8, THREE.NormalBlending);
  smokeSystem.points.material.size = 3.2;
}

function construirFuego() {
  fireParticles = crearPool(900, texturaFuego(), 0xffaa55, THREE.AdditiveBlending);
  fireParticles.points.material.size = 1.6;
}

function emitirEnPool(s, x, y, z, opts) {
  const k = s.next; s.next = (s.next + 1) % s.max;
  const pos = s.geo.attributes.position;
  const o = opts;
  pos.setXYZ(k, x + (Math.random() - 0.5) * o.dx, y + (o.y0 ?? 0), z + (Math.random() - 0.5) * o.dx);
  s.vel[k].set((Math.random() - 0.5) * o.vxz, o.vy0 + Math.random() * o.vy1, (Math.random() - 0.5) * o.vxz + (o.vzSesgo || 0));
  s.life[k] = o.life0 + Math.random() * o.life1;
  s.age[k] = 0;
  s.tam0[k] = o.tam0; s.tam1[k] = o.tam1;
  return k;
}

function emitirHumo(x, y, z, denso) {
  emitirEnPool(smokeSystem, x, y, z, {
    dx: 0.6, y0: 0.4, vxz: 0.15, vy0: 0.9, vy1: 0.4, vzSesgo: -0.3,
    life0: 2.6, life1: 1.6, tam0: 2.2, tam1: denso ? 5.5 : 4.2,
  });
}

function emitirFuego(x, y, z) {
  emitirEnPool(fireParticles, x, y, z, {
    dx: 0.45, y0: 0.1, vxz: 0.5, vy0: 0.6, vy1: 0.9, vzSesgo: 0,
    life0: 0.35, life1: 0.35, tam0: 1.6, tam1: 0.3,
  });
}

function actualizarPool(s, dt) {
  const pos = s.geo.attributes.position;
  const alpha = s.geo.attributes.aAlpha;
  const escala = s.geo.attributes.aScale;
  for (let k = 0; k < s.max; k++) {
    if (s.age[k] >= s.life[k]) { if (alpha.getX(k) !== 0) alpha.setX(k, 0); continue; }
    s.age[k] += dt;
    pos.setXYZ(k, pos.getX(k) + s.vel[k].x * dt, pos.getY(k) + s.vel[k].y * dt, pos.getZ(k) + s.vel[k].z * dt);
    const t = s.age[k] / s.life[k];
    const envolvente = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85; // aparece rápido, se apaga gradual
    alpha.setX(k, Math.max(0, envolvente));
    escala.setX(k, THREE.MathUtils.lerp(s.tam0[k], s.tam1[k], t));
  }
  pos.needsUpdate = true; alpha.needsUpdate = true; escala.needsUpdate = true;
}

function actualizarHumo(dt) { actualizarPool(smokeSystem, dt); }
function actualizarFuego(dt) { actualizarPool(fireParticles, dt); }

/* ------------------- luces dinámicas del incendio (parpadeo) ------------------- */

function construirLucesIncendio() {
  for (let i = 0; i < 3; i++) {
    const luz = new THREE.PointLight(0xff7a2a, 0, 9, 2);
    scene.add(luz);
    lucesIncendio.push(luz);
  }
}

let relojFuego = 0;
function actualizarLucesIncendio(dt) {
  relojFuego += dt;
  const celdas = state.celdasEnLlamas;
  if (!celdas || celdas.length === 0) {
    for (const luz of lucesIncendio) luz.intensity = 0;
    return;
  }
  for (let i = 0; i < lucesIncendio.length; i++) {
    const c = celdas[Math.floor((i / lucesIncendio.length) * celdas.length) % celdas.length];
    const luz = lucesIncendio[i];
    luz.position.set(c.x, c.y + 1.6, c.z);
    const parpadeo = ruidoFBM(relojFuego * 6 + i * 11, i * 7) ;
    luz.intensity = 9 + parpadeo * 10;
  }
}

/* ------------------ emisión continua de fuego/humo por celda activa ------------------ */

function actualizarEmisionFuego(dt) {
  const celdas = state.celdasEnLlamas;
  if (!celdas || celdas.length === 0) return;
  // más celdas en llamas -> más partículas por segundo, con un tope razonable
  const porCelda = Math.min(3, 60 / celdas.length);
  for (const c of celdas) {
    if (Math.random() < porCelda * dt * 6) emitirFuego(c.x, c.y + 0.15, c.z);
    if (Math.random() < 0.06) emitirHumo(c.x, c.y + 0.3, c.z, celdas.length > 40);
  }
}

/* ------------------------- animación del fuego ------------------------ */

function colorRiesgo(p) {
  // mapa de calor simple amarillo->rojo (0..1)
  const c = new THREE.Color();
  c.setHSL(0.14 - 0.14 * Math.min(1, p * 2.2), 0.95, 0.5);
  return c;
}

function aplicarFrame() {
  const esc = state.escenarios[state.escenarioActual];
  const frame = esc.frames[Math.min(state.frameIdx, esc.frames.length - 1)];
  let haQuemadas = 0;
  let llegaBorde = false;
  const n = state.terreno.n;
  const borde = state.terreno.urbano;
  const color = new THREE.Color();

  state.celdasEnLlamas = [];
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    const v = frame[i][j];
    const idxVert = i * n + j;
    if (v === 2 || v === 3) {
      haQuemadas++;
      if (v === 2) {
        const [x, z] = xzDe(i, j);
        const y = heightAt(i, j);
        state.celdasEnLlamas.push({ x, y, z });
      }
      // terreno "quemado": se oscurece in situ (ceniza), sin cubos superpuestos
      color.copy(COLOR_QUEMADA);
      terrainColorAttr.setXYZ(idxVert, color.r, color.g, color.b);
      actualizarVegetacionCelda(k, true);
    } else {
      // restaurar el color original (vegetación/cortafuegos) si no está quemada
      terrainColorAttr.setXYZ(idxVert, terrainColorOriginal[idxVert * 3], terrainColorOriginal[idxVert * 3 + 1], terrainColorOriginal[idxVert * 3 + 2]);
      actualizarVegetacionCelda(k, false);
    }
  }
  terrainColorAttr.needsUpdate = true;
  finalizarActualizacionVegetacion();

  // ¿llegó a una celda vecina de zona urbana?
  for (let k = 0; k < combustibleIdx.length && !llegaBorde; k++) {
    const { i, j } = combustibleIdx[k];
    if (frame[i][j] >= 2) {
      for (let di = -1; di <= 1 && !llegaBorde; di++) {
        for (let dj = -1; dj <= 1 && !llegaBorde; dj++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < n && borde[ii][jj]) llegaBorde = true;
        }
      }
    }
  }

  const ha = haQuemadas * (state.terreno.celda_m ** 2 / 10000);
  const minutos = Math.round(state.frameIdx * (esc.dtMin * esc.pasosGuardadosCada));
  $('statEscenario').textContent = state.escenarioActual === 'base' ? 'SIN INTERVENCIÓN' : 'CORTAFUEGOS 250M';
  $('statHa').textContent = `${ha.toFixed(1)} HA`;
  $('statLlegaLbl').textContent = '¿LLEGA A VIVIENDAS?'; $('statLlega').textContent = llegaBorde ? 'SÍ' : 'NO';
  $('statLlega').classList.toggle('on', llegaBorde);
  $('statTiempo').textContent = `${String(minutos).padStart(2, '0')} MIN`;
  $('timeClock').textContent = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  $('scrub').max = String(esc.frames.length - 1);
  $('scrub').value = String(state.frameIdx);
}

function aplicarMapaDeRiesgo(activar) {
  state.modoRiesgo = activar;
  fireMesh.visible = activar;
  if (!activar) { aplicarFrame(); return; }
  state.celdasEnLlamas = [];
  // Mapa de riesgo real: probabilidad de quema por celda, de 150 corridas de
  // Monte Carlo (mismo criterio que la Figura 8 del informe, cap. 6.1).
  const mapa = state.riesgo.mapa;
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let pmax = 0;
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    if (mapa[i][j] > pmax) pmax = mapa[i][j];
  }
  for (let k = 0; k < combustibleIdx.length; k++) {
    const { i, j } = combustibleIdx[k];
    const p = mapa[i][j];
    const [x, z] = xzDe(i, j);
    const y = heightAt(i, j);
    if (p > 0.02) {
      color.copy(colorRiesgo(p / pmax));
      const alto = 0.3 + 2.2 * (p / pmax);
      m.compose(new THREE.Vector3(x, y + alto / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.85, alto, 0.85));
      fireMesh.setMatrixAt(k, m);
      fireMesh.setColorAt(k, color);
    } else {
      m.makeScale(0.0001, 0.0001, 0.0001);
      fireMesh.setMatrixAt(k, m);
    }
  }
  fireMesh.instanceMatrix.needsUpdate = true;
  if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

  $('statEscenario').textContent = 'MAPA DE RIESGO';
  $('statHa').textContent = `MÁX ${(pmax * 100).toFixed(0)}% PROB.`;
  $('statLlegaLbl').textContent = 'RÉPLICAS'; $('statLlega').textContent = `${state.riesgo.nCorridas}×MC`;
  $('statLlega').classList.remove('on');
  $('statTiempo').textContent = '8H SIN CTRL';
}

/* ------------------------------- UI ----------------------------------- */

function poblarBrujula() {
  const t = state.terreno;
  const needle = document.getElementById('compassNeedle');
  if (needle) needle.setAttribute('transform', `rotate(${t.vientoDirDesde || 0} 28 28)`);
  const deg = document.getElementById('compassDeg');
  if (deg) deg.textContent = `${Math.round(t.vientoDirDesde || 0)}°`;
  const kmh = document.getElementById('compassKmh');
  if (kmh) kmh.textContent = `${(t.vientoKmh ?? 0).toFixed(0)} KM/H`;
}

function wireUI() {
  $('btnBase').addEventListener('click', () => {
    state.escenarioActual = 'base'; state.frameIdx = 0; state.modoRiesgo = false;
    $('btnBase').classList.add('active'); $('btnCortafuegos').classList.remove('active'); $('btnRiesgo').classList.remove('active');
    aplicarFrame();
  });
  $('btnCortafuegos').addEventListener('click', () => {
    state.escenarioActual = 'cortafuegos250'; state.frameIdx = 0; state.modoRiesgo = false;
    $('btnCortafuegos').classList.add('active'); $('btnBase').classList.remove('active'); $('btnRiesgo').classList.remove('active');
    aplicarFrame();
  });
  $('btnRiesgo').addEventListener('click', () => {
    const activar = !state.modoRiesgo;
    $('btnRiesgo').classList.toggle('active', activar);
    aplicarMapaDeRiesgo(activar);
  });
  const setIconoPlay = (reproduciendo) => {
    $('iconPlay').querySelector('use').setAttribute('href', reproduciendo ? '#i-pause' : '#i-play');
  };
  $('btnPlay').addEventListener('click', () => {
    state.playing = !state.playing;
    setIconoPlay(state.playing);
  });
  $('scrub').addEventListener('input', (e) => {
    state.playing = false; setIconoPlay(false);
    state.frameIdx = Number(e.target.value);
    aplicarFrame();
  });
}

/* --------------------------- VR / Cardboard ---------------------------- */

let xrSession = null;

function setTextoVR(texto) {
  const span = $('btnVR').querySelector('span');
  if (span) span.textContent = texto; else $('btnVR').textContent = texto;
  $('btnVR').title = texto;
}

async function entrarEnVR() {
  if (!navigator.xr) return;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    xrSession = session;
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    setTextoVR('Salir de VR');
    session.addEventListener('end', () => {
      xrSession = null;
      setTextoVR('Entrar en VR');
    });
  } catch (err) {
    console.error('No se pudo iniciar la sesión VR:', err);
    setTextoVR('VR no disponible');
    $('btnVR').disabled = true;
  }
}

function setupVR() {
  renderer.xr.enabled = true;
  if (!navigator.xr) {
    setTextoVR('Usa Cardboard manual');
    $('btnVR').disabled = true;
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) { setTextoVR('VR no disponible aquí'); $('btnVR').disabled = true; }
  });
  $('btnVR').addEventListener('click', () => {
    if (xrSession) xrSession.end(); else entrarEnVR();
  });
}

/* --- Modo Cardboard manual (sin WebXR): estéreo + giroscopio del teléfono --- */
let stereoActivo = false;
let orientacion = { alpha: 0, beta: 0, gamma: 0 };

function quaternionDeOrientacion(alpha, beta, gamma, orient) {
  const degtorad = Math.PI / 180;
  const _x = beta ? beta * degtorad : 0;
  const _y = alpha ? alpha * degtorad : 0;
  const _z = gamma ? gamma * degtorad : 0;
  const cX = Math.cos(_x / 2), cY = Math.cos(_y / 2), cZ = Math.cos(_z / 2);
  const sX = Math.sin(_x / 2), sY = Math.sin(_y / 2), sZ = Math.sin(_z / 2);
  const q = new THREE.Quaternion(
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  );
  q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // ejes del mundo
  const orientRad = (orient || 0) * degtorad;
  q.multiply(new THREE.Quaternion(0, 0, -Math.sin(orientRad / 2), Math.cos(orientRad / 2)));
  return q;
}

function onDeviceOrientation(e) {
  orientacion.alpha = e.alpha || 0;
  orientacion.beta = e.beta || 0;
  orientacion.gamma = e.gamma || 0;
}

async function activarStereoManual() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (_) { /* ignorar */ }
  }
  window.addEventListener('deviceorientation', onDeviceOrientation);
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  stereoActivo = true;
  $('fallbackNotice').style.display = 'block';
  document.body.addEventListener('click', salirStereoManual, { once: true });
}

function salirStereoManual() {
  stereoActivo = false;
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  $('fallbackNotice').style.display = 'none';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/* --------------------------------- main ---------------------------------- */

/* ------------------------------- dron térmico (intro) ---------------------------- */

let drone, helices = [], anilloEscaneo;
const introState = {
  activo: true, t: 0,
  padPos: null, destino: null,
  camInicio: null, camFinal: null, targetFinal: null,
};

function facilitarSuave(t) { return t * t * (3 - 2 * t); } // smootherstep simple

function encontrarPadCercaDeUrbano() {
  const t = state.terreno; const n = t.n; const [ii, jj] = t.ignicion;
  let mejor = [ii, jj], mejorD = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (t.urbano[i][j]) {
        const d = (i - ii) ** 2 + (j - jj) ** 2;
        if (d < mejorD) { mejorD = d; mejor = [i, j]; }
      }
    }
  }
  return mejor;
}

function construirDron() {
  drone = new THREE.Group();
  const matCuerpo = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.4, metalness: 0.55 });
  const matCuerpoClaro = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.3, metalness: 0.6 });
  const matHelice = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.92 });
  const matAcento = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.4, metalness: 0.3 });

  // cuerpo: base + "nariz" achatada para dar forma aerodinámica
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.58), matCuerpo);
  cuerpo.position.set(0, 0, -0.02);
  drone.add(cuerpo);
  const tapa = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 8, 1, false, 0, Math.PI), matCuerpoClaro);
  tapa.rotation.z = Math.PI / 2; tapa.rotation.y = Math.PI / 2;
  tapa.position.set(0, 0.08, -0.02);
  drone.add(tapa);
  const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), matCuerpo);
  antena.position.set(-0.1, 0.16, 0.05);
  drone.add(antena);

  // gimbal de 3 ejes con la cámara térmica
  const aroGimbal = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 16), matCuerpoClaro);
  aroGimbal.rotation.x = Math.PI / 2;
  aroGimbal.position.set(0, -0.14, 0.12);
  drone.add(aroGimbal);
  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.2, metalness: 0.4 }));
  gimbal.position.set(0, -0.14, 0.12);
  drone.add(gimbal);
  const lenteTermico = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0x552200, roughness: 0.15, metalness: 0.6 }));
  lenteTermico.position.set(0, -0.18, 0.18);
  lenteTermico.rotation.x = -Math.PI / 2.3;
  drone.add(lenteTermico);

  // luces de navegación: blanca al frente, roja atrás (convención real de aviación)
  const luzFrontal = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  luzFrontal.position.set(0, 0.03, 0.28);
  drone.add(luzFrontal);
  const luz = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2b2b }));
  luz.position.set(0, 0.07, -0.27);
  drone.add(luz);
  drone.userData.luz = luz;

  const esquinas = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sx, sz] of esquinas) {
    const ox = sx * 0.42, oz = sz * 0.42;
    const brazo = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.6, 8), matCuerpo);
    brazo.position.set(ox / 2, 0.015, oz / 2);
    brazo.rotation.z = Math.PI / 2;
    brazo.rotation.y = -Math.atan2(oz, ox);
    drone.add(brazo);
    // pata/tren de aterrizaje
    const pata = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 5), matCuerpo);
    pata.position.set(ox * 0.82, -0.12, oz * 0.82);
    pata.rotation.z = sx * 0.18; pata.rotation.x = -sz * 0.18;
    drone.add(pata);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.08, 10), matCuerpo);
    motor.position.set(ox, 0.05, oz);
    drone.add(motor);
    const anilloMotor = new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.006, 6, 12), matAcento);
    anilloMotor.position.set(ox, 0.015, oz);
    anilloMotor.rotation.x = Math.PI / 2;
    drone.add(anilloMotor);
    // disco de "desenfoque" de la hélice girando + 2 aspas finas encima
    const disco = new THREE.Mesh(new THREE.CircleGeometry(0.23, 20), new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    disco.rotation.x = -Math.PI / 2; disco.position.set(ox, 0.098, oz);
    drone.add(disco);
    const grupoHelice = new THREE.Group();
    grupoHelice.position.set(ox, 0.1, oz);
    for (let b = 0; b < 2; b++) {
      const aspa = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.006, 0.032), matHelice);
      aspa.rotation.y = b * Math.PI / 2;
      grupoHelice.add(aspa);
    }
    drone.add(grupoHelice);
    helices.push(grupoHelice);
  }
  drone.scale.setScalar(1.7);
  drone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  scene.add(drone);

  // anillo de "escaneo térmico" que se usa al llegar a destino
  anilloEscaneo = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  anilloEscaneo.rotation.x = -Math.PI / 2;
  scene.add(anilloEscaneo);
}

function construirPad(pos) {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.2, 0.12, 20),
    new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.8 }),
  );
  base.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
  base.receiveShadow = true;
  scene.add(base);
  const marca = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb04d }),
  );
  marca.rotation.x = -Math.PI / 2;
  marca.position.copy(pos).add(new THREE.Vector3(0, 0.13, 0));
  scene.add(marca);
}

function iniciarIntro(camInicioSugerida, camFinal, targetFinal) {
  const [pi, pj] = encontrarPadCercaDeUrbano();
  const [px, pz] = xzDe(pi, pj);
  const py = heightAt(pi, pj);
  introState.padPos = new THREE.Vector3(px, py, pz);

  const [ix, iz] = xzDe(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  const iy = heightAt(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  introState.destino = new THREE.Vector3(ix, iy + WORLD_SIZE * 0.1, iz);

  introState.camFinal = camFinal.clone();
  introState.targetFinal = targetFinal.clone();

  construirDron();
  construirPad(introState.padPos);
  drone.position.copy(introState.padPos).add(new THREE.Vector3(0, 0.08, 0));

  const dirPad = introState.padPos.clone().sub(introState.destino).setY(0).normalize();
  camera.position.copy(introState.padPos).add(dirPad.multiplyScalar(3.2)).add(new THREE.Vector3(0, 1.6, 0));
  camera.lookAt(introState.padPos.clone().add(new THREE.Vector3(0, 0.5, 0)));

  $('introCaption').style.display = 'flex';
  $('btnSkipIntro').style.display = 'block';
}

function finalizarIntro() {
  introState.activo = false;
  camera.position.copy(introState.camFinal);
  controls.target.copy(introState.targetFinal);
  controls.enabled = true;
  controls.update();
  $('introCaption').style.display = 'none';
  $('btnSkipIntro').style.display = 'none';
  document.getElementById('hud').classList.add('visible');
  $('stats').classList.add('visible');
  $('brand').classList.add('visible');
  $('compass').classList.add('visible');
  aplicarFrame();
}

function saltarIntro() {
  introState.t = 999;
  if (drone) { drone.position.copy(introState.destino); }
  finalizarIntro();
}

function actualizarIntro(dt) {
  if (!introState.activo) return;
  introState.t += dt;
  const t = introState.t;
  const girarHelices = (vel) => { for (const h of helices) h.rotation.y += vel * dt; };

  if (t < 1.1) {
    // despegando: hélices acelerando, cámara fija mirando el dron
    girarHelices(THREE.MathUtils.lerp(2, 55, Math.min(1, t / 1.1)));
    $('introCaption').querySelector('.capTxt').textContent = 'DRON-01: SISTEMA EN LÍNEA, ARMANDO ROTORES…';
  } else if (t < 2.0) {
    girarHelices(55);
    const u = facilitarSuave((t - 1.1) / 0.9);
    drone.position.y = introState.padPos.y + 0.08 + u * 1.6;
    $('introCaption').querySelector('.capTxt').textContent = 'DRON-01: DESPEGUE EN CURSO, ALT +1.6M…';
  } else if (t < 6.2) {
    girarHelices(55);
    const u = facilitarSuave((t - 2.0) / 4.2);
    const p = new THREE.Vector3().lerpVectors(
      introState.padPos.clone().add(new THREE.Vector3(0, 1.68, 0)),
      introState.destino, u,
    );
    p.y += Math.sin(u * Math.PI) * (WORLD_SIZE * 0.07); // arco de vuelo
    const anterior = drone.position.clone();
    drone.position.copy(p);
    const avance = p.clone().sub(anterior);
    if (avance.lengthSq() > 1e-6) drone.rotation.y = Math.atan2(avance.x, avance.z);
    drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, -Math.min(0.18, avance.length() * 2), 0.2);

    const detras = p.clone().sub(introState.destino).setY(0);
    if (detras.lengthSq() < 0.01) detras.set(0, 0, 1);
    detras.normalize().multiplyScalar(4.2);
    camera.position.lerp(p.clone().add(detras).add(new THREE.Vector3(0, 2.1, 0)), 0.12);
    camera.lookAt(p);
    $('introCaption').querySelector('.capTxt').textContent = `DRON-01: RUMBO AL FOCO, VIENTO ${Math.round(state.terreno.vientoDirDesde)}°…`;
  } else if (t < 7.8) {
    girarHelices(38);
    drone.position.copy(introState.destino);
    drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, 0, 0.1);
    const u = (t - 6.2) / 1.6;
    anilloEscaneo.position.set(introState.destino.x, introState.destino.y - WORLD_SIZE * 0.095, introState.destino.z);
    const esc = 1 + u * 2.5;
    anilloEscaneo.scale.set(esc, esc, esc);
    anilloEscaneo.material.opacity = Math.sin(Math.min(1, u) * Math.PI) * 0.8;
    camera.position.lerp(introState.destino.clone().add(new THREE.Vector3(2.6, 2.0, 3.4)), 0.07);
    camera.lookAt(introState.destino);
    $('introCaption').querySelector('.capTxt').textContent = 'DRON-01: CÁMARA TÉRMICA ACTIVA, ESCANEANDO…';
  } else if (t < 9.4) {
    girarHelices(30);
    const u = facilitarSuave((t - 7.8) / 1.6);
    camera.position.lerp(introState.camFinal, 0.09);
    const miraActual = introState.destino.clone().lerp(introState.targetFinal, u);
    camera.lookAt(miraActual);
    anilloEscaneo.material.opacity *= 0.9;
    $('introCaption').style.opacity = String(1 - u);
  } else {
    finalizarIntro();
  }
}

/* --------------------------------------------------------------------------------- */

async function main() {
  await cargarDatos();

  const app = $('app');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);

  crearCieloYLuces();
  construirTerreno();
  construirVegetacion();
  construirOverlayDeFuego();
  construirHumo();
  construirFuego();
  construirLucesIncendio();
  wireUI();
  setupVR();
  poblarBrujula();

  // Encuadre inicial: mirando hacia el punto de ignición, desde una posición elevada.
  const [ix, iz] = xzDe(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  const iy = heightAt(state.terreno.ignicion[0], state.terreno.ignicion[1]);
  camera.position.set(ix + WORLD_SIZE * 0.28, iy + WORLD_SIZE * 0.22, iz + WORLD_SIZE * 0.34);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(ix, iy + 1, iz);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = WORLD_SIZE * 1.3;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  controls.enabled = false; // se habilita cuando termina la intro del dron

  const camFinalIntro = camera.position.clone();
  const targetFinalIntro = controls.target.clone();
  iniciarIntro(null, camFinalIntro, targetFinalIntro);
  $('btnSkipIntro').addEventListener('click', saltarIntro);

  $('btnStereo').addEventListener('click', () => { if (!stereoActivo) activarStereoManual(); });

  aplicarFrame();
  $('loading').style.display = 'none';

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.1, clock.getDelta());

    if (introState.activo) {
      actualizarIntro(dt);
    } else if (state.playing && !state.modoRiesgo) {
      state.acumulador += dt;
      const esc = state.escenarios[state.escenarioActual];
      if (state.acumulador > 1 / state.playSpeed) {
        state.acumulador = 0;
        state.frameIdx = (state.frameIdx + 1) % esc.frames.length;
        aplicarFrame();
      }
    }
    actualizarHumo(dt);
    actualizarFuego(dt);
    actualizarNubes(dt);
    if (!introState.activo && !state.modoRiesgo) {
      actualizarEmisionFuego(dt);
      actualizarLucesIncendio(dt);
    }

    if (!renderer.xr.isPresenting) {
      if (!introState.activo) controls.update();
      if (stereoActivo) {
        camera.quaternion.copy(quaternionDeOrientacion(orientacion.alpha, orientacion.beta, orientacion.gamma, window.orientation || 0));
        const w = window.innerWidth / 2, h = window.innerHeight;
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        renderer.setViewport(w, 0, w, h); renderer.setScissor(w, 0, w, h);
        renderer.render(scene, camera);
        renderer.setScissorTest(false);
        return;
      }
    }
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error(err);
  $('loading').innerHTML = `<div style="color:#ff8a8a">Error cargando el simulador: ${err.message}</div>`;
});
