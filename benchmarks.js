/* ============================================================
   Datos de referencia (benchmarks)
   Todos los valores en YARDAS / MPH / PIES (apex).
   Fuentes: promedios públicos tipo TrackMan / Rapsodo.
   Son REFERENCIALES, sirven para comparar tendencias.
   ============================================================ */

const BENCHMARKS = {
  amateur: {
    label: "Aficionado (hombre)",
    desc: "Jugador medio (~14-18 de hándicap)",
    data: {
      driver: { carry: 214, ball: 132, club: 93, smash: 1.42, la: 11 },
      "3w":   { carry: 181, ball: 122, club: 86, smash: 1.42, la: 12.5 },
      "5w":   { carry: 171, ball: 116, club: 83, smash: 1.40, la: 13.5 },
      "7w":   { carry: 160, ball: 110, club: 80, smash: 1.38, la: 15 },
      "3h":   { carry: 165, ball: 113, club: 81, smash: 1.40, la: 13 },
      "4h":   { carry: 158, ball: 108, club: 79, smash: 1.38, la: 14 },
      "5h":   { carry: 150, ball: 104, club: 77, smash: 1.36, la: 15 },
      "3i":   { carry: 160, ball: 107, club: 79, smash: 1.35, la: 11 },
      "4i":   { carry: 153, ball: 104, club: 78, smash: 1.33, la: 12 },
      "5i":   { carry: 146, ball: 100, club: 76, smash: 1.32, la: 13 },
      "6i":   { carry: 137, ball: 95,  club: 74, smash: 1.31, la: 14.5 },
      "7i":   { carry: 128, ball: 90,  club: 72, smash: 1.30, la: 16 },
      "8i":   { carry: 118, ball: 84,  club: 70, smash: 1.28, la: 18 },
      "9i":   { carry: 107, ball: 78,  club: 67, smash: 1.26, la: 20 },
      pw:     { carry: 96,  ball: 70,  club: 64, smash: 1.23, la: 24 },
      gw:     { carry: 83,  ball: 62,  club: 60, smash: 1.20, la: 26 },
      sw:     { carry: 72,  ball: 55,  club: 57, smash: 1.18, la: 28 },
      lw:     { carry: 60,  ball: 47,  club: 53, smash: 1.15, la: 31 }
    }
  },
  pro_senior: {
    label: "Profesional Senior",
    desc: "PGA Tour Champions / Legends Tour (drive ~279 yd total, hierro 7 ~166 yd carry)",
    // Anclado en datos públicos del PGA Tour Champions (circuito senior 50+):
    // driving distance ~279 yd total (≈262 carry) y carry medio de hierro 7 ~166 yd.
    // El resto de la bolsa se interpola con un gapping coherente de nivel tour.
    data: {
      driver: { carry: 262, ball: 168, club: 110, smash: 1.49, la: 11 },
      "3w":   { carry: 240, ball: 158, club: 105, smash: 1.49, la: 10.5 },
      "5w":   { carry: 226, ball: 150, club: 101, smash: 1.48, la: 11.5 },
      "7w":   { carry: 214, ball: 144, club: 98,  smash: 1.47, la: 12.5 },
      "3h":   { carry: 222, ball: 147, club: 99,  smash: 1.48, la: 10.5 },
      "4h":   { carry: 212, ball: 142, club: 97,  smash: 1.47, la: 11.5 },
      "5h":   { carry: 202, ball: 136, club: 94,  smash: 1.46, la: 12.5 },
      "3i":   { carry: 210, ball: 141, club: 97,  smash: 1.45, la: 9.5 },
      "4i":   { carry: 200, ball: 135, club: 95,  smash: 1.44, la: 10.5 },
      "5i":   { carry: 190, ball: 131, club: 93,  smash: 1.43, la: 11.5 },
      "6i":   { carry: 179, ball: 125, club: 91,  smash: 1.41, la: 13.5 },
      "7i":   { carry: 166, ball: 120, club: 89,  smash: 1.39, la: 15.5 },
      "8i":   { carry: 155, ball: 114, club: 86,  smash: 1.37, la: 17.5 },
      "9i":   { carry: 142, ball: 107, club: 83,  smash: 1.35, la: 19.5 },
      pw:     { carry: 130, ball: 99,  club: 80,  smash: 1.31, la: 22.5 },
      gw:     { carry: 115, ball: 89,  club: 75,  smash: 1.27, la: 24.5 },
      sw:     { carry: 100, ball: 79,  club: 71,  smash: 1.24, la: 27.5 },
      lw:     { carry: 84,  ball: 67,  club: 65,  smash: 1.20, la: 30.5 }
    }
  }
};

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
