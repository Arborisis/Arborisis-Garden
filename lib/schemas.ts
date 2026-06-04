import { z } from "zod";

export const telemetrySchema = z.object({
  deviceSerial: z.string().min(2).max(80),
  deviceName: z.string().min(1).max(80).optional(),
  recordedAt: z.string().datetime().optional(),
  firmwareVersion: z.string().max(32).optional(),
  soilMoistureRaw: z.number().int().min(0).max(65535).optional(),
  soilMoisturePct: z.number().min(0).max(100).optional(),
  soilTempC: z.number().min(-40).max(85).optional(),
  airTempC: z.number().min(-40).max(85).optional(),
  airHumidityPct: z.number().min(0).max(100).optional(),
  pressureHpa: z.number().min(300).max(1200).optional(),
  lightLux: z.number().min(0).max(200000).optional(),
  batteryMv: z.number().int().min(0).max(6000).optional(),
  wifiRssi: z.number().int().min(-120).max(0).optional()
});

export type TelemetryPayload = z.infer<typeof telemetrySchema>;

// Fenêtre d'acquisition bioélectrique envoyée par le 2e Pico. Bornes prudentes
// alignées sur telemetrySchema; tous les champs de features sont optionnels car
// le front-end analogique peut être inconnu (mesure relative en comptes bruts).
export const bioelectricSchema = z.object({
  deviceSerial: z.string().min(2).max(80),
  deviceName: z.string().min(1).max(80).optional(),
  recordedAt: z.string().datetime().optional(),
  firmwareVersion: z.string().max(32).optional(),
  sampleRateHz: z.number().int().min(1).max(20000),
  windowSeconds: z.number().min(0.1).max(120),
  sampleCount: z.number().int().min(1).max(200000),
  channel: z.string().max(16).optional(),
  gain: z.number().min(0).max(1_000_000).optional(),
  baselineRaw: z.number().min(0).max(65535).optional(),
  baselineUv: z.number().min(-10_000_000).max(10_000_000).optional(),
  meanUv: z.number().min(-10_000_000).max(10_000_000).optional(),
  rmsUv: z.number().min(0).max(10_000_000).optional(),
  rmsRaw: z.number().min(0).max(65535).optional(),
  stdRaw: z.number().min(0).max(65535).optional(),
  p2pRaw: z.number().min(0).max(65535).optional(),
  minRaw: z.number().min(0).max(65535).optional(),
  maxRaw: z.number().min(0).max(65535).optional(),
  slopeRawPerSec: z.number().min(-1_000_000).max(1_000_000).optional(),
  spikeCount: z.number().int().min(0).max(100000).optional(),
  zeroCrossRate: z.number().min(0).max(20000).optional(),
  bandLowEnergy: z.number().min(0).max(1_000_000_000).optional(),
  bandMidEnergy: z.number().min(0).max(1_000_000_000).optional(),
  bandHighEnergy: z.number().min(0).max(1_000_000_000).optional(),
  qualityFlag: z.enum(["ok", "saturated", "flatline", "noisy", "floating"]).optional(),
  waveform: z.array(z.number()).max(256).optional(),
  batteryMv: z.number().int().min(0).max(6000).optional(),
  wifiRssi: z.number().int().min(-120).max(0).optional()
});

export type BioelectricPayload = z.infer<typeof bioelectricSchema>;

export const plantUpdateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
  species: z.string().max(120).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  notes: z.string().max(1200).optional().nullable(),
  targetMoisture: z.number().int().min(0).max(100),
  minLightLux: z.number().int().min(0).max(200000),
  minSoilTempC: z.number().min(-20).max(60),
  maxSoilTempC: z.number().min(-20).max(80)
});

export const plantCalibrationSchema = z.object({
  plantId: z.string().min(1).optional()
});

export const chatSchema = z.object({
  plantId: z.string().min(1),
  message: z.string().min(1).max(2000),
  webSearch: z.boolean().optional(),
  weatherLocation: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional()
});

export const weatherQuerySchema = z.object({
  location: z.string().min(1).max(120).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  timezone: z.string().min(1).max(80).optional()
});

export const insightsQuerySchema = z.object({
  plantId: z.string().min(1),
  weatherLocation: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional()
});

export const plantPhotoQuerySchema = z.object({
  plantId: z.string().min(1)
});

const plantPhotoImageSchema = z.object({
  title: z.string().min(1).max(90).optional(),
  imageDataUrl: z.string().min(32).max(7_500_000),
  takenAt: z.string().datetime().optional()
});

export const plantPhotoCreateSchema = z.object({
  plantId: z.string().min(1),
  title: z.string().min(1).max(90).optional(),
  imageDataUrl: z.string().min(32).max(7_500_000).optional(),
  takenAt: z.string().datetime().optional(),
  images: z.array(plantPhotoImageSchema).min(1).max(6).optional()
}).superRefine((value, context) => {
  if (!value.imageDataUrl && !value.images?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Au moins une image est requise.",
      path: ["images"]
    });
  }
});

export const plantPhotoDeleteSchema = z.object({
  id: z.string().min(1)
});

export const calendarEventQuerySchema = z.object({
  plantId: z.string().min(1)
});

export const calendarEventCreateSchema = z.object({
  plantId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(1200).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  category: z.enum(["water", "check", "relocate", "prune", "fertilize", "wait", "custom"]).default("check"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["planned", "done", "skipped"]).default("planned"),
  source: z.enum(["manual", "agent"]).default("manual")
});

export const calendarEventUpdateSchema = calendarEventCreateSchema.partial().extend({
  id: z.string().min(1),
  plantId: z.string().min(1).optional()
});

export const calendarEventDeleteSchema = z.object({
  id: z.string().min(1)
});

// ML dataset schemas
export const datasetListQuerySchema = z.object({
  status: z.enum(["draft", "frozen", "published"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const datasetFilterSchema = {
  plantId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  labelSource: z.enum(["photo", "sensor_derived", "manual", "agent"]).optional()
};

export const datasetBuildSchema = z.object({
  datasetId: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, "slug url-safe (a-z, 0-9, tirets)"),
  description: z.string().max(2000).optional(),
  license: z.string().max(60).optional(),
  ...datasetFilterSchema
});

export const datasetIdSchema = z.object({
  id: z.string().min(1)
});

export const datasetTrainSchema = z.object({
  epochs: z.number().int().min(5).max(2000).optional()
});

export const datasetExportQuerySchema = z.object({
  format: z.enum(["jsonl", "csv", "hf", "datasheet"]).default("jsonl"),
  gzip: z.coerce.boolean().optional()
});

export const manualLabelSchema = z.object({
  plantId: z.string().min(1),
  sampledAt: z.string().datetime().optional(),
  value: z.number().min(0).max(100)
});

export const mlCollectSchema = z.object({
  plantId: z.string().optional(),
  includeSensorDerived: z.boolean().optional()
});

// Agentic output schemas
export const agentTrendSchema = z.object({
  metric: z.string(),
  direction: z.enum(["rising", "falling", "stable", "volatile"]),
  rateOfChange: z.number(),
  prediction: z.string(),
  confidence: z.number().min(0).max(1)
});

export const agentHealthScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  moisture: z.number().min(0).max(100),
  temperature: z.number().min(0).max(100),
  light: z.number().min(0).max(100),
  stability: z.number().min(0).max(100),
  factors: z.array(z.string())
});

export const agentActionSchema = z.object({
  id: z.string(),
  type: z.enum(["water", "relocate", "prune", "fertilize", "check", "wait", "custom"]),
  description: z.string(),
  urgency: z.enum(["immediate", "today", "this_week", "soon"]),
  rationale: z.string(),
  expectedOutcome: z.string(),
  parameters: z.record(z.union([z.string(), z.number()])).optional()
});

export const agentCareScheduleItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueAt: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  actionType: z.enum(["water", "relocate", "prune", "fertilize", "check", "wait", "custom"]),
  cadence: z.enum(["once", "daily", "weekly", "as_needed"]),
  successCriteria: z.string()
});

export const agentResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional()
});

export const agentMemoryUpdateSchema = z.object({
  kind: z.enum(["sensor_observation", "agent_advice", "goal", "reflection", "user_preference", "care_plan"]),
  content: z.string(),
  importance: z.number().min(0).max(1)
});

export const agentReasoningStepSchema = z.object({
  step: z.number(),
  phase: z.enum(["perceive", "analyze", "plan", "decide", "reflect"]),
  thought: z.string(),
  toolCall: z.object({
    tool: z.string(),
    params: z.record(z.unknown())
  }).optional(),
  toolResult: z.unknown().optional()
});

export const agentStructuredOutputSchema = z.object({
  reasoning: z.array(agentReasoningStepSchema),
  healthScore: agentHealthScoreSchema,
  trends: z.array(agentTrendSchema),
  diagnosis: z.object({
    summary: z.string(),
    severity: z.enum(["healthy", "mild_stress", "moderate_stress", "critical"]),
    rootCauses: z.array(z.string())
  }),
  proposedActions: z.array(agentActionSchema),
  careSchedule: z.array(agentCareScheduleItemSchema).default([]),
  webSources: z.array(agentResearchSourceSchema).default([]),
  memoryUpdates: z.array(agentMemoryUpdateSchema),
  alertResolutions: z.array(z.string()),
  followUpPlan: z.object({
    checkAt: z.string(),
    reason: z.string()
  }).nullable(),
  responseToUser: z.string()
});

export type AgentStructuredOutput = z.infer<typeof agentStructuredOutputSchema>;
