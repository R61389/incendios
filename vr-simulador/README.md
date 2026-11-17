# Simulador VR — Incendios del Tunari (SIM-522, Grupo 3)

Experiencia interactiva en **WebXR** (navegador, sin instalar nada) que muestra,
en 3D y en VR con un visor tipo cardboard, el mismo modelo que está en el
informe y el cuaderno de simulación: el terreno real del sector Cercado y el
incendio calibrado avanzando celda por celda.

## Qué usa de verdad del proyecto

- **Terreno**: elevación y vegetación reales de `grilla_sector_cercado.csv`
  (las mismas 10.000 celdas del informe, Figura 6).
- **Incendio animado**: una corrida real del autómata celular ya calibrado
  (`p_h = 0,072`, informe sección 5.5), con el viento del "peor día" (igual
  criterio que el capítulo 6.4/7.2 del informe) para que la diferencia entre
  escenarios se note. Dos versiones: sin intervención y con el cortafuegos a
  250 m.
- **Mapa de riesgo**: probabilidad real de quema por celda, de 150 corridas
  de Monte Carlo (mismo método que la Figura 8 del informe), mostrado como un
  mapa de calor 3D.

Todo se generó con `export_data.py`, que reimplementa el mismo autómata del
cuaderno `G3_Incendios_Tunari_Simulacion.ipynb` y exporta los resultados a
JSON ligero (carpeta `public/data/`, ~1.3 MB en total).

## Cómo probarlo ahora mismo (en la misma red WiFi)

1. En la computadora, dentro de `vr-simulador/public`:
   ```bash
   python3 -m http.server 8098
   ```
2. Busca la IP local de la computadora (`ipconfig` en Windows, mirar "IPv4").
3. En el celular (misma red WiFi), abre Chrome y entra a:
   `http://<esa-ip>:8098/`
4. Explora con el dedo (arrastrar = rotar, pellizcar = zoom). Elige el
   escenario, dale play, prueba el mapa de riesgo.
5. Para VR: **primero** deja listo el escenario que quieres mostrar, **y recién
   después** toca "Entrar en VR" o "Modo Cardboard manual" y mete el celular
   al visor.

> **Nota importante:** una vez dentro del modo VR (con el visor puesto), los
> botones de la pantalla ya no se pueden tocar — es una limitación normal de
> este tipo de demo simple. Por eso el flujo es: elegir todo primero, entrar a
> VR al final, solo para mirar alrededor.

### Si WebXR no está disponible en el celular

Usa el botón **"Modo Cardboard manual"**: no necesita WebXR, solo el
giroscopio del teléfono. Funciona en casi cualquier Android con Chrome, pero
no corrige la distorsión de los lentes del visor (se ve una imagen estéreo
simple, sin la curva típica de apps VR comerciales).

## Para la Expo: un link permanente con GitHub Pages

Para no depender del WiFi del lugar ni de que tu computadora esté prendida,
conviene publicar esto como un sitio estático:

1. En GitHub, ve a **Settings → Pages** del repositorio.
2. En "Source", elige la rama de este trabajo y la carpeta `/vr-simulador/public`
   (o mueve el contenido de `public/` a la raíz de una rama `gh-pages` si el
   repo no permite elegir subcarpeta).
3. GitHub te da una URL `https://<usuario>.github.io/incendios/...` — esa
   URL es HTTPS, que es requisito para que WebXR funcione.
4. Genera un código QR con esa URL (cualquier generador gratuito) para que la
   gente en la Expo lo escanee con su celular.

## Estructura

```
vr-simulador/
├── export_data.py       # genera los JSON a partir de los datos reales
├── public/
│   ├── index.html
│   ├── js/main.js        # toda la lógica (terreno, fuego, VR, UI)
│   ├── libs/three/       # Three.js vendorizado (funciona sin internet)
│   └── data/*.json       # terreno, dos escenarios de fuego, mapa de riesgo
```

## Próximas mejoras posibles (si quieren seguir puliendo)

- **Corrección de lentes** para el modo Cardboard manual (distorsión de
  barril), para que se vea como una app VR comercial.
- **Interacción dentro del casco**: usar la función `dom-overlay` de WebXR,
  o un botón por "mirada fija" (gaze + temporizador), para cambiar de
  escenario sin salir de VR.
- **Más detalle visual**: textura satelital real sobre el terreno (en vez de
  color plano por clase de vegetación), partículas de fuego con shader
  animado en vez de color estático.
- **Subir a Unity** si en algún momento quieren más fidelidad visual (sombras,
  post-procesado) a costa de tener que instalar una app en vez de abrir un
  link.
