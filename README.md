# ⛳ Golf Analytics

App web para analizar los tiros de tu monitor de lanzamiento (Rapsodo MLM y similares).
Cargas los archivos `.csv`, y ves analítica completa de tus palos, evolución, patrones de
lanzamiento y comparación contra benchmarks. Optimizada para **iPhone y iPad** (se puede
instalar como app desde Safari).

## Qué incluye

- **Resumen**: visión de toda tu bolsa, distancias de carry por palo con **análisis de gapping** (solapes y huecos entre palos), tabla con ventana de juego (P25–P75), consistencia, comparación vs referencia y **récords personales**.
- **Por palo**: métricas detalladas (carry, ventana de juego, carry "bien golpeado", roll, ball/club speed, smash, eficiencia, launch, apex, dirección de salida, curva en vuelo, dispersión), scatter "vista desde atrás" con **elipses de dispersión** (68%/95%) y **matriz 3×3 de forma de tiro** (pull hook → push slice).
- **Evolución**: cómo cambian tus métricas sesión a sesión, y análisis **dentro de la sesión** (calentamiento / fatiga por tercios).
- **Patrones e insights**: detección automática de fortalezas y áreas a mejorar — separa **dirección de salida** (cara/alineación) de **curva en vuelo** (cara vs trayectoria), forma de tiro dominante, costo del impacto descentrado con tu propia data, solapes/huecos de gapping, fatiga, y tendencias reales entre sesiones (regresión).
- **Filtro de tiros atípicos**: los tops/lecturas erróneas del monitor se excluyen de las estadísticas (configurable en Datos → Ajustes).
- **Cancha**: importa tus rondas reales desde Garmin Golf (script `tools/garmin_golf_export.py`): score vs par, putts, fairways y GIR por ronda, detalle hoyo a hoyo, evolución, y comparación cancha vs rango (¿fallas al mismo lado?).
- **Corto (juego corto y putt)**: registro manual de tus tres ejercicios de la cancha de práctica — vuelta al putting green (fecha, green: Valle 1 / Valle 10 / Driving, **hoyos del recorrido** y score vs par contando 2 putts/hoyo) y tandas de aproximación desde 10 y 20 pasos (fecha, palo, bolas que quedan en green de N tiros). El putting se analiza en **putts por hoyo**, para que una vuelta de 9 y una de 18 sean comparables. Analiza progresión por green y por distancia, ranking de palos, regularidad entre tandas, tendencias por regresión y compara tus putts por hoyo del putting green con los de tus rondas reales. Cada registro se puede **editar** o eliminar desde el historial.
- **Metas**: define metas por palo (ej. «3 Madera: 50% en calle en los últimos 30 días, solo tiros con carry > 140 yd» o «Hierro 7: 60% con lateral ≤ 15 yd») y sigue tu % de cumplimiento sesión a sesión desde el día en que definiste la meta, contra la línea objetivo.
- **Benchmark**: comparación contra el **hombre de 50 años** con **hándicap 9** o **hándicap 15**: distancia total en campo, dispersión lateral, club speed y smash factor por palo.
- **Datos**: gestionar sesiones, fechas, unidades (yd/mph ↔ m/km·h), mano dominante, y respaldo (exportar/importar).

Tus datos quedan **solo en tu dispositivo** (localStorage del navegador). Nada se sube a internet.

No necesitas cargar ningún CSV para usar **Corto**: desde la pantalla inicial, el botón
«🎯 Registrar juego corto» abre la app directamente en esa pestaña.

## Probar en tu computadora

```bash
cd golf-analytics
python3 -m http.server 8766
# abre http://localhost:8766 en el navegador
```

## Publicarla gratis (para verla en iPhone/iPad)

### Opción A — Netlify Drop (lo más rápido, sin cuenta técnica)
1. Entra a https://app.netlify.com/drop
2. Arrastra **toda la carpeta** `golf-analytics` a la página.
3. Te da una URL pública (ej. `https://algo-random.netlify.app`). Ábrela en Safari.

### Opción B — GitHub Pages
1. Crea un repo en GitHub y sube estos archivos.
2. Settings → Pages → Source: rama `main`, carpeta `/root`.
3. Usa la URL `https://tu-usuario.github.io/tu-repo/`.

## Instalar como app en iPhone/iPad
1. Abre la URL en **Safari**.
2. Toca **Compartir** → **Agregar a inicio**.
3. Se crea un ícono y se abre a pantalla completa como una app nativa.

## Pasar datos entre iPhone y iPad
Cada dispositivo guarda sus propios datos. Para sincronizar: en **Datos → Respaldo**
usa **Exportar respaldo** en un dispositivo e **Importar respaldo** en el otro.

## Formato de CSV esperado
Columnas del Rapsodo MLM (el orden no importa, se detectan por nombre):
`Club Type, Carry Distance, Total Distance, Ball Speed, Launch Angle, Launch Direction, Apex, Side Carry, Club Speed, Smash Factor`.
La fecha de la sesión se intenta leer del nombre del archivo (ej. `..._062826.csv` → 28-06-2026);
si no, se usa la fecha de carga y puedes editarla en **Datos**.

## Archivos
- `index.html` — estructura y navegación
- `styles.css` — estilos (mobile-first)
- `app.js` — parseo CSV, estadística, gráficos, insights
- `benchmarks.js` — datos de referencia (hombre 50 años, hcp 9 / hcp 15)
- `demo.js` — datos de ejemplo
- `manifest.webmanifest`, `icon.svg` — instalación como app

> Los benchmarks son valores referenciales para un hombre de 50 años (hcp 9 y hcp 15).
> Distancia total en campo y dispersión lateral provienen de Arccos / Shot Scope; club speed
> y smash factor de TrackMan / Arccos. La app compara tu **distancia total** (no el carry)
> y tu side carry medio (desvío medio desde el objetivo) contra esas referencias. Sirven como guía de tendencia.
