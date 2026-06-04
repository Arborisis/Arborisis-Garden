export type BioActivitySummary = {
  latestActivityIndex: number | null;
  meanActivityIndex24h: number | null;
  windows24h: number;
  qualityOkRatio: number;
  lastReadingAt: string | null;
};

export type BioReactionSummary = {
  total: number;
  reactedCount: number;
  lastReaction: {
    eventAt: string;
    eventType: string;
    responseRatio: number;
    latencyMin: number | null;
    confidence: number;
    reacted: boolean;
  } | null;
  // Réactivité par type de stimulus (arrosage, lumière, température, ...).
  byStimulus: BioStimulusStat[];
};

export type BioStimulusStat = {
  eventType: string;
  events: number;
  reactedCount: number;
  reactedRatio: number;
  avgResponseRatio: number;
  avgLatencyMin: number | null;
};

// Couplage environnement ↔ activité bioélectrique (corrélation décalée).
export type BioCouplingSummary = {
  dominant: {
    channel: string;
    label: string;
    correlation: number;
    lagMin: number;
    confidence: number;
  } | null;
  channels: {
    channel: string;
    label: string;
    correlation: number;
    lagMin: number;
    confidence: number;
  }[];
};

export type BioSummary = {
  hasDevice: boolean;
  activity: BioActivitySummary;
  responses: BioReactionSummary;
  coupling: BioCouplingSummary;
  // Résumé FR injecté dans le prompt LLM (insights / agent).
  text: string;
};
