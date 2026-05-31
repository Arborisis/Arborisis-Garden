import type { Alert, CalendarEvent, ChatMessage, Memory, Plant, PlantPhoto, Reading } from "@prisma/client";
import type { WeatherContext } from "@/lib/weather";

export type AgentContext = {
  plant: Plant;
  latestReadings: Reading[];
  openAlerts: Alert[];
  memories: Memory[];
  chatHistory?: ChatMessage[];
  weather?: WeatherContext | null;
  recentPhotos?: PlantPhoto[];
  calendarEvents?: CalendarEvent[];
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

export type CareScheduleItem = {
  id: string;
  title: string;
  dueAt: string;
  priority: "high" | "medium" | "low";
  actionType: ProposedAction["type"];
  cadence: "once" | "daily" | "weekly" | "as_needed";
  successCriteria: string;
};

export type ResearchSource = {
  title: string;
  url: string;
  snippet?: string;
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
  mode: "chat" | "analysis";
  reasoning: AgentReasoningStep[];
  healthScore: HealthScore;
  trends: TrendAnalysis[];
  diagnosis: {
    summary: string;
    severity: "healthy" | "mild_stress" | "moderate_stress" | "critical";
    rootCauses: string[];
  };
  proposedActions: ProposedAction[];
  careSchedule: CareScheduleItem[];
  webSources: ResearchSource[];
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
  webSources: ResearchSource[];
  webSearchRequests: number;
  persistedMemories: Memory[];
  closedAlertMemories: Memory[];
  persistedCalendarEvents: CalendarEvent[];
  updatedSummary: string | null;
};
