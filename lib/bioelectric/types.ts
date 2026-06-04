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
};

export type BioSummary = {
  hasDevice: boolean;
  activity: BioActivitySummary;
  responses: BioReactionSummary;
  // Résumé FR injecté dans le prompt LLM (insights / agent).
  text: string;
};
