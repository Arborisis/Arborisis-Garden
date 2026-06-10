/**
 * Registre central des modeles LLM utilises via OpenRouter.
 *
 * Les slugs OpenRouter utilisent des points (ex: anthropic/claude-opus-4.8),
 * pas des tirets comme les IDs de l'API Anthropic directe.
 *
 * Repartition par tache:
 * - agent / vision / calibration: Claude Opus 4.8 (le plus capable, vision
 *   haute resolution, raisonnement long-horizon) — precision maximale.
 * - insights tableau de bord: Claude Sonnet 4.6 (excellent rapport
 *   qualite/latence pour du JSON court, regenere toutes les 4h par plante).
 * - compaction de conversation: Claude Haiku 4.5 (resume simple, frequent).
 */
export const DEFAULT_AGENT_MODEL = "anthropic/claude-opus-4.8";
export const DEFAULT_VISION_MODEL = "anthropic/claude-opus-4.8";
export const DEFAULT_INSIGHTS_MODEL = "anthropic/claude-sonnet-4.6";
export const DEFAULT_COMPACT_MODEL = "anthropic/claude-haiku-4.5";

export function resolveAgentModel(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_AGENT_MODEL;
}

export function resolveVisionModel(): string {
  return (
    process.env.OPENROUTER_VISION_MODEL ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_VISION_MODEL
  );
}

export function resolveInsightsModel(): string {
  return process.env.OPENROUTER_INSIGHTS_MODEL || DEFAULT_INSIGHTS_MODEL;
}

export function resolveCompactModel(): string {
  return process.env.OPENROUTER_COMPACT_MODEL || DEFAULT_COMPACT_MODEL;
}

/**
 * Claude Opus 4.7+ et Fable rejettent temperature/top_p/top_k (HTTP 400).
 * On n'envoie le parametre que pour les modeles qui l'acceptent encore.
 */
const NO_SAMPLING_PARAMS = /anthropic\/claude-(opus-4\.[7-9]|opus-[5-9]|fable)/i;

export function samplingParams(model: string, temperature: number): { temperature?: number } {
  return NO_SAMPLING_PARAMS.test(model) ? {} : { temperature };
}

/**
 * Parametre de raisonnement unifie OpenRouter (mappe vers l'adaptive thinking
 * des Claude recents). Active par defaut sur les taches exigeantes (agent,
 * vision, calibration); desactivable via OPENROUTER_REASONING_EFFORT=off.
 */
export function reasoningParams(): { reasoning?: { effort: "low" | "medium" | "high" } } {
  const effort = (process.env.OPENROUTER_REASONING_EFFORT ?? "high").toLowerCase();
  if (effort === "off" || effort === "none" || effort === "0") return {};
  if (effort === "low" || effort === "medium" || effort === "high") {
    return { reasoning: { effort } };
  }
  return { reasoning: { effort: "high" } };
}
