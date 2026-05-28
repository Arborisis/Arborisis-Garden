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

export const chatSchema = z.object({
  plantId: z.string().min(1),
  message: z.string().min(1).max(2000)
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
  memoryUpdates: z.array(agentMemoryUpdateSchema),
  alertResolutions: z.array(z.string()),
  followUpPlan: z.object({
    checkAt: z.string(),
    reason: z.string()
  }).nullable(),
  responseToUser: z.string()
});

export type AgentStructuredOutput = z.infer<typeof agentStructuredOutputSchema>;
