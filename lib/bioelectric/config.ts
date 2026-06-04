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

  // --- Détection d'arrosage à partir des Reading environnementaux ---
  // Un arrosage = saut d'humidité du sol >= wateringMoistureJumpPct sur une
  // fenêtre glissante de wateringWindowMin minutes.
  wateringMoistureJumpPct: num("BIO_WATERING_JUMP_PCT", 8),
  wateringWindowMin: num("BIO_WATERING_WINDOW_MIN", 20),

  // --- Détection de réaction (corrélation de l'activité bio autour de T) ---
  baselineWindowMin: num("BIO_BASELINE_WINDOW_MIN", 30), // fenêtre avant l'évènement
  responseWindowMin: num("BIO_RESPONSE_WINDOW_MIN", 60), // fenêtre après l'évènement
  minSamplesPerWindow: num("BIO_MIN_SAMPLES", 3), // fenêtres bio minimales de chaque côté
  reactionRatioThreshold: num("BIO_REACTION_RATIO", 1.3), // responseRms / baselineRms

  // --- Normalisation de l'activité ---
  // Nombre de fenêtres récentes utilisées pour estimer la baseline RMS (médiane)
  // de la plante, et facteur de saturation (activité = 1 à activitySaturation×baseline).
  activityBaselineCount: num("BIO_ACTIVITY_BASELINE_N", 50),
  activitySaturationFactor: num("BIO_ACTIVITY_SATURATION", 4),
} as const;

export type BioConfig = typeof BIO_CONFIG;
