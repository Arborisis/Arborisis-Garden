import type { Alert, ChatMessage, Memory, Plant, Reading } from "@prisma/client";

export type AgentContext = {
  plant: Plant;
  latestReadings: Reading[];
  openAlerts: Alert[];
  memories: Memory[];
  chatHistory?: ChatMessage[];
};

export type TrendAnalysis = {
  metric: string;
  direction: "rising" | "falling" | "stable" | "volatile";
  rateOfChange: number;
  prediction: string;
  confidence: number;
};

export type HealthScore = {
  overall: number;
  moisture: number;
  temperature: number;
  light: number;
  stability: number;
  factors: string[];
};

export type ProposedAction = {
  id: string;
  type: "water" | "relocate" | "prune" | "fertilize" | "check" | "wait" | "custom";
  description: string;
  urgency: "immediate" | "today" | "this_week" | "soon";
  rationale: string;
  expectedOutcome: string;
  parameters?: Record<string, string | number>;
};

export type AgentMemoryUpdate = {
  kind: "sensor_observation" | "agent_advice" | "goal" | "reflection" | "user_preference" | "care_plan";
  content: string;
  importance: number;
};

export type AgentReasoningStep = {
  step: number;
  phase: "perceive" | "analyze" | "plan" | "decide" | "reflect";
  thought: string;
  toolCall?: AgentToolCall;
  toolResult?: unknown;
};

export type AgentToolCall = {
  tool: string;
  params: Record<string, unknown>;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
};

export type AgentStructuredOutput = {
  reasoning: AgentReasoningStep[];
  healthScore: HealthScore;
  trends: TrendAnalysis[];
  diagnosis: {
    summary: string;
    severity: "healthy" | "mild_stress" | "moderate_stress" | "critical";
    rootCauses: string[];
  };
  proposedActions: ProposedAction[];
  memoryUpdates: AgentMemoryUpdate[];
  alertResolutions: string[];
  followUpPlan: {
    checkAt: string;
    reason: string;
  } | null;
  responseToUser: string;
};

export type AgentExecutionResult = {
  structuredOutput: AgentStructuredOutput;
  executedTools: { tool: string; result: unknown }[];
  persistedMemories: Memory[];
  closedAlertMemories: Memory[];
  updatedSummary: string | null;
};
