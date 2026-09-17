/* ============================================================
   Datos de referencia (benchmarks)
   Perfil: HOMBRE DE 50 AÑOS, hándicap 9 y hándicap 15.
   Todos los valores en YARDAS / MPH.

   Fuentes:
   - Distancia TOTAL en campo y dispersión lateral: Arccos y Shot Scope
     (distancias medias reales en cancha, ajustadas a varón de 50 años).
   - Club speed y smash factor: TrackMan y Arccos.

   Cada dato viene como RANGO [min, max]; la app usa el punto medio
   para comparar y muestra el rango como referencia.
   Ball speed se deriva: club speed × smash factor (puntos medios).
   El Lob Wedge no tiene datos de club speed / smash en la fuente.
   ============================================================ */

/* Formato crudo: [distTotal, dispLateral, clubSpeed, smashFactor] */
const BENCH_RAW = {
  hcp9: {
    label: "Hcp 9 (hombre 50 años)",
    desc: "Varón de 50 años con hándicap 9. Distancia total en campo y dispersión lateral (Arccos / Shot Scope); club speed y smash factor (TrackMan / Arccos).",
    data: {
      driver: [[228, 238], 16, [93, 96], [1.45, 1.47]],
      "3w":   [[208, 216], 14, [89, 92], [1.43, 1.45]],
      "5w":   [[188, 196], 12, [85, 88], [1.40, 1.43]],   // Madera 5 / Híbrido 3 (misma fila)
      "3h":   [[188, 196], 12, [85, 88], [1.40, 1.43]],
      "4h":   [[178, 186], 11, [82, 85], [1.38, 1.40]],
      "5i":   [[168, 174], 10, [80, 83], [1.35, 1.37]],
      "6i":   [[156, 162], 9,  [77, 80], [1.32, 1.35]],
      "7i":   [[145, 151], 8,  [74, 77], [1.30, 1.32]],
      "8i":   [[133, 139], 7,  [71, 74], [1.27, 1.29]],
      "9i":   [[121, 127], 6,  [68, 71], [1.24, 1.26]],
      pw:     [[108, 115], 5,  [65, 68], [1.20, 1.23]],
      gw:     [[94, 100],  5,  [62, 65], [1.16, 1.19]],
      aw:     [[94, 100],  5,  [62, 65], [1.16, 1.19]],   // Approach wedge = Gap wedge
      sw:     [[78, 84],   4,  [58, 61], [1.12, 1.15]],
      lw:     [[62, 68],   3,  null,     null]
    }
  },
  hcp15: {
    label: "Hcp 15 (hombre 50 años)",
    desc: "Varón de 50 años con hándicap 15. Distancia total en campo y dispersión lateral (Arccos / Shot Scope); club speed y smash factor (TrackMan / Arccos).",
    data: {
      driver: [[208, 218], 25, [86, 90], [1.40, 1.43]],
      "3w":   [[188, 198], 22, [82, 86], [1.38, 1.41]],
      "5w":   [[172, 182], 19, [78, 82], [1.35, 1.38]],   // Madera 5 / Híbrido 3 (misma fila)
      "3h":   [[172, 182], 19, [78, 82], [1.35, 1.38]],
      "4h":   [[160, 168], 17, [75, 79], [1.32, 1.35]],
      "5i":   [[148, 155], 15, [73, 77], [1.28, 1.31]],
      "6i":   [[138, 145], 14, [70, 74], [1.25, 1.28]],
      "7i":   [[128, 134], 12, [67, 71], [1.22, 1.25]],
      "8i":   [[118, 124], 11, [64, 68], [1.20, 1.22]],
      "9i":   [[108, 114], 10, [61, 65], [1.17, 1.19]],
      pw:     [[96, 103],  8,  [58, 62], [1.14, 1.16]],
      gw:     [[84, 90],   7,  [55, 59], [1.10, 1.13]],
      aw:     [[84, 90],   7,  [55, 59], [1.10, 1.13]],   // Approach wedge = Gap wedge
      sw:     [[70, 76],   6,  [51, 55], [1.05, 1.09]],
      lw:     [[55, 62],   5,  null,     null]
    }
  }
};

/* Expande los rangos crudos a un objeto por palo:
   { total, totalRange, side, club, clubRange, smash, smashRange, ball } */
const BENCHMARKS = Object.fromEntries(Object.entries(BENCH_RAW).map(([key, b]) => {
  const mid = r => (r ? (r[0] + r[1]) / 2 : null);
  const data = Object.fromEntries(Object.entries(b.data).map(([club, [total, side, cs, smash]]) => {
    const clubMid = mid(cs), smashMid = mid(smash);
    return [club, {
      total: mid(total), totalRange: total,
      side,
      club: clubMid, clubRange: cs,
      smash: smashMid, smashRange: smash,
      ball: (clubMid != null && smashMid != null) ? Math.round(clubMid * smashMid * 10) / 10 : null
    }];
  }));
  return [key, { label: b.label, desc: b.desc, data }];
}));
const DEFAULT_BENCHMARK = "hcp15";

/* Texto de un rango de referencia ya convertido a la unidad del usuario */
function benchRange(range, conv, dec = 0) {
  if (!range) return "–";
  return `${fmt(conv(range[0]), dec)}–${fmt(conv(range[1]), dec)}`;
}

/* Smash factor ideal aproximado por palo (para evaluar calidad de golpe) */
const IDEAL_SMASH = {
  driver: 1.50, "3w": 1.48, "5w": 1.47, "7w": 1.46,
  "3h": 1.46, "4h": 1.45, "5h": 1.44,
  "3i": 1.43, "4i": 1.42, "5i": 1.41, "6i": 1.39,
  "7i": 1.38, "8i": 1.36, "9i": 1.34,
  pw: 1.30, gw: 1.27, sw: 1.24, lw: 1.20
};

/* Ventana de launch angle "saludable" por palo (grados) */
const LAUNCH_WINDOW = {
  driver: [10, 17], "3w": [10, 18], "5w": [11, 20], "7w": [12, 22],
  "3h": [10, 19], "4h": [11, 20], "5h": [12, 21],
  "3i": [9, 17], "4i": [10, 18], "5i": [11, 19], "6i": [12, 21],
  "7i": [14, 23], "8i": [16, 26], "9i": [18, 29],
  pw: [22, 34], gw: [24, 36], sw: [26, 40], lw: [28, 42]
};
