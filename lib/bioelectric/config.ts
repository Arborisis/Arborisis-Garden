// Seuils configurables de l'analyse bioélectrique. Tous surchargeables par
// variable d'environnement pour pouvoir affiner sans redéploiement de code.

function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const BIO_CONFIG = {
  // --- Acquisition (défauts indicatifs; le firmware reste maître de sa cadence) ---
  defaultSampleRateHz: num("BIO_SAMPLE_RATE_HZ", 128),
  defaultWindowSeconds: num("BIO_WINDOW_SECONDS", 4),

  // --- Détection d'évènements environnementaux (multi-stimuli) ---
  // Chaque stimulus = pas (step) significatif d'une variable du Pico env sur une
  // fenêtre glissante de stimulusWindowMin minutes. L'arrosage est le cas
  // historique (saut d'humidité du sol); les autres canaux sont bidirectionnels.
  stimulusWindowMin: num("BIO_STIMULUS_WINDOW_MIN", 20),
  wateringMoistureJumpPct: num("BIO_WATERING_JUMP_PCT", 8), // arrosage: Δ humidité sol ↑
  lightStepLogRatio: num("BIO_LIGHT_STEP_LOGRATIO", 0.8), // |Δ ln(lux+1)| (lever/coucher/lampe)
  tempStepC: num("BIO_TEMP_STEP_C", 3), // |Δ T° air ou sol| en °C
  humidityStepPct: num("BIO_HUMIDITY_STEP_PCT", 12), // |Δ humidité air| en points
  pressureStepHpa: num("BIO_PRESSURE_STEP_HPA", 6), // |Δ pression| (fronts météo)
  // Compat. ascendante: ancien nom de fenêtre d'arrosage (= stimulusWindowMin).
  wateringWindowMin: num("BIO_WATERING_WINDOW_MIN", 20),

  // --- Détection de réaction (corrélation de l'activité bio autour de T) ---
  baselineWindowMin: num("BIO_BASELINE_WINDOW_MIN", 30), // fenêtre avant l'évènement
  responseWindowMin: num("BIO_RESPONSE_WINDOW_MIN", 60), // fenêtre après l'évènement
  minSamplesPerWindow: num("BIO_MIN_SAMPLES", 3), // fenêtres bio minimales de chaque côté
  reactionRatioThreshold: num("BIO_REACTION_RATIO", 1.3), // responseRms / baselineRms (réaction = écart bidirectionnel)

  // --- Analyse de couplage environnement ↔ activité bioélectrique ---
  // Corrélation décalée (lag) entre chaque variable d'environnement et l'indice
  // d'activité bio: identifie quelles données pilotent le signal et avec quel retard.
  couplingLookbackHours: num("BIO_COUPLING_LOOKBACK_H", 168), // historique analysé (7 j)
  couplingMatchToleranceMin: num("BIO_COUPLING_MATCH_MIN", 15), // appariement bio↔env le + proche
  couplingMinPairs: num("BIO_COUPLING_MIN_PAIRS", 12), // paires minimales pour une corrélation fiable
  couplingLagsMin: "0,15,30,60,120", // retards testés (env précède bio), minutes

  // --- Normalisation de l'activité ---
  // Nombre de fenêtres récentes utilisées pour estimer la baseline RMS (médiane)
  // de la plante, et facteur de saturation (activité = 1 à activitySaturation×baseline).
  activityBaselineCount: num("BIO_ACTIVITY_BASELINE_N", 50),
  activitySaturationFactor: num("BIO_ACTIVITY_SATURATION", 4),
} as const;

export type BioConfig = typeof BIO_CONFIG;
