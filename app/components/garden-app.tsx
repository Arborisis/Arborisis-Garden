"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { MLIntelligencePanel } from "./ml-intelligence-panel";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BellOff,
  Bluetooth,
  BrainCircuit,
  Camera,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudSun,
  Download,
  Droplets,
  Globe2,
  ImagePlus,
  Leaf,
  Lightbulb,
  MapPin,
  MessageCircle,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Umbrella,
  Upload,
  Wifi,
  Wind,
  Zap
} from "lucide-react";
import { subscribeToPush, unsubscribeFromPush, getPushState } from "./service-worker-register";
import { DevicePairing } from "./device-pairing";

type Reading = {
  id: string;
  recordedAt: string;
  soilMoisturePct: number | null;
  soilMoistureRaw: number | null;
  soilTempC: number | null;
  airTempC: number | null;
  airHumidityPct: number | null;
  pressureHpa: number | null;
  lightLux: number | null;
  wifiRssi: number | null;
};

type Alert = {
  id: string;
  severity: string;
  title: string;
  body: string;
  createdAt: string;
};

type Device = {
  id: string;
  serial: string;
  name: string;
  tokenHash: string | null;
  lastSeen: string | null;
};

type Plant = {
  id: string;
  name: string;
  species: string | null;
  location: string | null;
  notes: string | null;
  moistureDryRaw: number;
  moistureWetRaw: number;
  targetMoisture: number;
  minLightLux: number;
  minSoilTempC: number;
  maxSoilTempC: number;
  memorySummary: string;
  deviceId: string | null;
  device: Device | null;
  readings: Reading[];
  alerts: Alert[];
};

type Insight = {
  title: string;
  body: string;
  tone: "good" | "watch" | "urgent";
};

type PlantPhoto = {
  id: string;
  title: string;
  imageUrl: string;
  mimeType: string;
  sizeBytes: number;
  takenAt: string | null;
  analysis: string;
  observations: string[];
  recommendations: string[];
  healthScore: number | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

type CalendarItem = {
  id: string;
  plantId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  category: string;
  priority: string;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type WeatherContext = {
  location: {
    name: string;
    label: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    time: string;
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    humidityPct: number | null;
    precipitationMm: number | null;
    description: string;
    cloudCoverPct: number | null;
    windSpeedKmh: number | null;
    windGustKmh: number | null;
    isDay: boolean;
  };
  today: {
    temperatureMinC: number | null;
    temperatureMaxC: number | null;
    precipitationSumMm: number | null;
    precipitationProbabilityMaxPct: number | null;
    uvIndexMax: number | null;
    sunrise: string | null;
    sunset: string | null;
    evapotranspirationMm: number | null;
    description: string;
  };
  hourly: Array<{
    time: string;
    temperatureC: number | null;
    precipitationProbabilityPct: number | null;
    precipitationMm: number | null;
    description: string;
    windSpeedKmh: number | null;
    solarRadiationWm2: number | null;
  }>;
  gardening: {
    wateringWindow: "avoid" | "careful" | "good";
    wateringAdvice: string;
    lightAdvice: string;
    windAdvice: string;
    summary: string;
  };
  source: {
    provider: "Open-Meteo";
    fetchedAt: string;
  };
};

type AgentAction = {
  type: string;
  description: string;
  urgency: string;
  rationale: string;
};

type AgentPlanTask = {
  priority: string;
  title: string;
  dueAt: string;
  actionType: string;
  cadence: string;
  successCriteria: string;
};

type AgentSource = {
  title: string;
  url: string;
};

type ParsedAgentResponse = {
  diagnosis: { severity: string; summary: string };
  healthScore: { overall: number; moisture: number; temperature: number; light: number; stability: number };
  actions: AgentAction[];
  plan: AgentPlanTask[];
  sources: AgentSource[];
  tools: string[];
  responseToUser: string;
};

const emptyPlant = {
  id: "",
  name: "Ma plante",
  species: "",
  location: "Maison",
  notes: "",
  targetMoisture: 48,
  minLightLux: 250,
  minSoilTempC: 10,
  maxSoilTempC: 30
};

type CalibrationResponse = {
  calibration: {
    profile: {
      targetMoisture: number;
      minLightLux: number;
      minSoilTempC: number;
      maxSoilTempC: number;
      confidence: number;
      researchedName: string;
      reason: string;
      sources: Array<{ title: string; url: string }>;
    };
    sensor: {
      moistureDryRaw: number;
      moistureWetRaw: number;
      confidence: number;
      appliedFromHistory: boolean;
      reason: string;
    };
  };
};

const timezones = [
  "Europe/Brussels",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Casablanca",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC"
];

const agentPresets = [
  { label: "Analyse complete", prompt: "Analyse completement l'etat de la plante, utilise tous les outils utiles et donne un plan d'action priorise.", variant: "analyze" },
  { label: "Planning 7 jours", prompt: "Cree un planning de soins tres concret pour les 7 prochains jours avec controles, criteres de reussite et priorites.", variant: "plan" },
  { label: "Recherche espece", prompt: "Recherche les besoins actuels de cette espece et compare-les aux mesures capteur avant de conseiller.", variant: "research" },
  { label: "Diagnostic urgent", prompt: "Fais un diagnostic urgent: risques racines, lumiere, temperature, arrosage, et action immediate la plus prudente.", variant: "urgent" }
];

export function GardenApp() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [parsedAgent, setParsedAgent] = useState<ParsedAgentResponse | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [bleStatus, setBleStatus] = useState("Non connecte");
  const [form, setForm] = useState(emptyPlant);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [aiInsights, setAiInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsStatus, setInsightsStatus] = useState("");
  const [weatherLocation, setWeatherLocation] = useState("Brussels");
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherStatus, setWeatherStatus] = useState("");
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarItem[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState("");
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "idle" | "loading">("loading");
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [showUnpairConfirm, setShowUnpairConfirm] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
  const [eventForm, setEventForm] = useState({
    title: "Controle plante",
    description: "",
    startsAt: toDatetimeLocal(new Date(Date.now() + 24 * 3600000)),
    category: "check",
    priority: "medium"
  });

  const plant = plants[0];
  const latest = plant?.readings?.[0];
  const chartReadings = useMemo(() => (plant?.readings ?? []).slice(0, 24).reverse(), [plant]);

  const health = useMemo(() => {
    if (!plant || !latest) return "En attente";
    if (plant.alerts.some((alert) => alert.severity === "critical")) return "Urgent";
    if (plant.alerts.some((alert) => alert.severity === "warning")) return "A surveiller";
    return "Stable";
  }, [plant, latest]);

  const dayCycle = useMemo(() => getDayCycle(timezone), [timezone]);
  const fallbackInsights = useMemo(() => buildInsights(plant, chartReadings, dayCycle), [plant, chartReadings, dayCycle]);
  const insights = aiInsights.length
    ? aiInsights
    : plant
      ? [{
          title: insightsLoading ? "Generation OpenRouter" : "Insights IA indisponibles",
          body: insightsLoading
            ? "OpenRouter analyse les mesures recentes. Le resultat sera mis en cache 4 h."
            : insightsStatus || "Configure OPENROUTER_API_KEY pour activer les insights IA.",
          tone: "watch" as const
        }]
      : fallbackInsights;

  useEffect(() => {
    const saved = window.localStorage.getItem("arborisis-timezone");
    const savedWeatherLocation = window.localStorage.getItem("arborisis-weather-location");
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(saved || detected || "UTC");
    if (savedWeatherLocation) setWeatherLocation(savedWeatherLocation);

    // Push notification state
    getPushState().then(setPushState);

    // PWA install prompt
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("arborisis-timezone", timezone);
  }, [timezone]);

  useEffect(() => {
    window.localStorage.setItem("arborisis-weather-location", weatherLocation);
  }, [weatherLocation]);

  useEffect(() => {
    const location = weatherLocation.trim();
    if (!location) return;

    let cancelled = false;

    async function refreshWeather() {
      setWeatherLoading(true);
      setWeatherStatus("");
      const query = new URLSearchParams({ location, timezone });
      const response = await fetch(`/api/weather?${query.toString()}`, { cache: "no-store" });

      if (cancelled) return;

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        setWeather(null);
        setWeatherStatus(error?.error ?? "Meteo indisponible");
        setWeatherLoading(false);
        return;
      }

      const data = await response.json() as { weather?: WeatherContext };
      setWeather(data.weather ?? null);
      setWeatherStatus(data.weather ? `API site - ${formatTime(data.weather.source.fetchedAt, timezone)}` : "");
      setWeatherLoading(false);
    }

    refreshWeather();
    const interval = window.setInterval(refreshWeather, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [weatherLocation, timezone]);

  async function refresh() {
    const response = await fetch("/api/plants", { cache: "no-store" });
    const data = await response.json();
    setPlants(data.plants ?? []);
    const first = data.plants?.[0];
    if (first) {
      setForm({
        id: first.id,
        name: first.name,
        species: first.species ?? "",
        location: first.location ?? "",
        notes: first.notes ?? "",
        targetMoisture: first.targetMoisture,
        minLightLux: first.minLightLux,
        minSoilTempC: first.minSoilTempC,
        maxSoilTempC: first.maxSoilTempC
      });
    }
    setLoading(false);
  }

  async function unpairDevice() {
    if (!plant?.deviceId) return;
    await fetch("/api/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plant.id, deviceId: null })
    });
    setShowUnpairConfirm(false);
    await refresh();
  }

  async function refreshPhotos(plantId = plant?.id) {
    if (!plantId) {
      setPhotos([]);
      return;
    }

    const query = new URLSearchParams({ plantId });
    const response = await fetch(`/api/photos?${query.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setPhotoStatus("Galerie indisponible");
      return;
    }

    const data = await response.json() as { photos?: PlantPhoto[] };
    setPhotos(data.photos ?? []);
  }

  async function refreshCalendar(plantId = plant?.id) {
    if (!plantId) {
      setCalendarEvents([]);
      return;
    }

    const query = new URLSearchParams({ plantId });
    const response = await fetch(`/api/calendar?${query.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setCalendarStatus("Calendrier indisponible");
      return;
    }

    const data = await response.json() as { events?: CalendarItem[] };
    setCalendarEvents(data.events ?? []);
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!plant?.id) {
      setPhotos([]);
      setCalendarEvents([]);
      return;
    }

    void refreshPhotos(plant.id);
    void refreshCalendar(plant.id);
  }, [plant?.id]);

  useEffect(() => {
    if (!plant?.id) {
      setAiInsights([]);
      setInsightsStatus("");
      return;
    }

    let cancelled = false;
    const selectedPlantId = plant.id;

    async function refreshInsights() {
      try {
        setInsightsLoading(true);
        const query = new URLSearchParams({ plantId: selectedPlantId, timezone });
        const selectedWeatherLocation = weatherLocation.trim() || plant.location;
        if (selectedWeatherLocation) {
          query.set("weatherLocation", selectedWeatherLocation);
        }
        const response = await fetch(`/api/insights?${query.toString()}`, {
          cache: "no-store"
        });

        if (cancelled) return;

        if (!response.ok) {
          const error = await response.json().catch(() => null) as { error?: string } | null;
          setAiInsights([]);
          setInsightsStatus(error?.error ?? "Insights IA indisponibles");
          setInsightsLoading(false);
          return;
        }

        const data = await response.json() as {
          insights?: Insight[];
          cached?: boolean;
          generatedAt?: string;
          expiresAt?: string;
          weatherIncluded?: boolean;
        };

        setAiInsights(data.insights ?? []);
        setInsightsStatus(
          data.generatedAt
            ? `${data.cached ? "Cache IA" : "Genere OpenRouter"}${data.weatherIncluded ? " + meteo" : ""} - valide jusqu'a ${formatTime(data.expiresAt ?? data.generatedAt, timezone)}`
            : "Genere par OpenRouter"
        );
        setInsightsLoading(false);
      } catch {
        if (cancelled) return;
        setAiInsights([]);
        setInsightsStatus("Insights IA indisponibles");
        setInsightsLoading(false);
      }
    }

    refreshInsights();

    return () => {
      cancelled = true;
    };
  }, [plant?.id, plant?.location, latest?.recordedAt, timezone, weatherLocation]);

  async function savePlant() {
    const response = await fetch("/api/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (response.ok) await refresh();
  }

  async function autoCalibratePlant() {
    if (!plant) return;
    setCalibrationBusy(true);
    setCalibrationMessage("");

    const response = await fetch("/api/plants/calibrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantId: plant.id })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null;
      setCalibrationMessage(error?.error ?? "Auto-calibrage impossible pour le moment.");
      setCalibrationBusy(false);
      return;
    }

    const data = (await response.json()) as CalibrationResponse;
    const { profile, sensor } = data.calibration;
    setForm((current) => ({
      ...current,
      targetMoisture: profile.targetMoisture,
      minLightLux: profile.minLightLux,
      minSoilTempC: profile.minSoilTempC,
      maxSoilTempC: profile.maxSoilTempC
    }));
    setCalibrationMessage(
      `Recherche IA web pour ${profile.researchedName}: ${profile.targetMoisture}% humidite, ${profile.minLightLux} lx min. ` +
        (sensor.appliedFromHistory ? "Capteur humidite ajuste." : "Capteur conserve: historique brut insuffisant.")
    );
    await refresh();
    setCalibrationBusy(false);
  }

  async function uploadPhoto(file: File | null) {
    if (!plant || !file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoStatus("Compression de la photo...");

    try {
      const imageDataUrl = await prepareImageDataUrl(file);
      setPhotoStatus("Envoi dans le bucket Railway et analyse IA...");
      const response = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId: plant.id,
          title: photoTitle.trim() || file.name.replace(/\.[^.]+$/, "") || "Photo plante",
          imageDataUrl,
          takenAt: new Date(file.lastModified || Date.now()).toISOString()
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? "Upload photo impossible");
      }

      setPhotoTitle("");
      setPhotoStatus("Photo stockee dans le bucket Railway et analysee par OpenRouter.");
      await refreshPhotos(plant.id);
    } catch (error) {
      setPhotoStatus(error instanceof Error ? error.message : "Upload photo impossible");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function deletePhoto(id: string) {
    const response = await fetch("/api/photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (response.ok) await refreshPhotos();
  }

  async function saveCalendarEvent() {
    if (!plant || !eventForm.title.trim() || calendarBusy) return;
    setCalendarBusy(true);
    setCalendarStatus("");

    try {
      const startsAt = new Date(eventForm.startsAt);
      if (Number.isNaN(startsAt.getTime())) throw new Error("Date de planning invalide");

      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId: plant.id,
          title: eventForm.title.trim(),
          description: eventForm.description.trim() || null,
          startsAt: startsAt.toISOString(),
          category: eventForm.category,
          priority: eventForm.priority,
          status: "planned",
          source: "manual"
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? "Creation impossible");
      }

      setEventForm({
        title: "Controle plante",
        description: "",
        startsAt: toDatetimeLocal(new Date(Date.now() + 24 * 3600000)),
        category: "check",
        priority: "medium"
      });
      setCalendarStatus("Evenement ajoute au calendrier.");
      await refreshCalendar(plant.id);
    } catch (error) {
      setCalendarStatus(error instanceof Error ? error.message : "Creation impossible");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function updateCalendarStatus(id: string, status: "planned" | "done" | "skipped") {
    const response = await fetch("/api/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status })
    });
    if (response.ok) await refreshCalendar();
  }

  async function deleteCalendarEvent(id: string) {
    const response = await fetch("/api/calendar", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (response.ok) await refreshCalendar();
  }

  function parseAgentResponse(text: string): ParsedAgentResponse {
    const structured = parseStructuredAgentResponse(text);
    if (structured) return structured;

    const severityMatch = text.match(/## Diagnostic:\s*(\w+)/);
    const summaryMatch = text.match(/## Diagnostic:[^\n]*\n([^\n#]+)/);
    const scoreMatch = text.match(/## Score de sante:\s*(\d+)/);
    const scoreDetailMatch = text.match(/Humidite:\s*(\d+)%\s*\|\s*Temperature:\s*(\d+)%\s*\|\s*Lumiere:\s*(\d+)%\s*\|\s*Stabilite:\s*(\d+)%/);
    const userResponseMatch = text.match(/---\n([\s\S]*)$/);

    const actions: AgentAction[] = [];
    const actionRegex = /\[([A-Z_]+)\]\s*([^\n]+)\n\s*Justification:\s*([^\n]+)/g;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      actions.push({
        urgency: match[1].toLowerCase(),
        description: match[2].trim(),
        rationale: match[3].trim(),
        type: "custom"
      });
    }

    const plan: AgentPlanTask[] = [];
    const planRegex = /- \[([A-Z]+)\]\s*(.*?)\s*-\s*([^\n]+)\n\s*Type:\s*([^|]+)\|\s*Cadence:\s*([^\n]+)\n\s*Critere de reussite:\s*([^\n]+)/g;
    while ((match = planRegex.exec(text)) !== null) {
      plan.push({
        priority: match[1].toLowerCase(),
        title: match[2].trim(),
        dueAt: match[3].trim(),
        actionType: match[4].trim(),
        cadence: match[5].trim(),
        successCriteria: match[6].trim()
      });
    }

    const sources: AgentSource[] = [];
    const sourcesSection = text.match(/## Sources web:\n([\s\S]*?)(?:\n## |\n---|$)/)?.[1] ?? "";
    const sourceRegex = /- (.*?): (https?:\/\/\S+)/g;
    while ((match = sourceRegex.exec(sourcesSection)) !== null) {
      sources.push({ title: match[1].trim(), url: match[2].trim() });
    }

    const tools: string[] = [];
    const toolsSection = text.match(/## Outils executes:\n([\s\S]*?)(?:\n## |\n---|$)/)?.[1] ?? "";
    const toolRegex = /- ([^\n]+)/g;
    while ((match = toolRegex.exec(toolsSection)) !== null) {
      tools.push(match[1].trim());
    }

    return {
      diagnosis: {
        severity: severityMatch?.[1]?.toLowerCase() ?? "unknown",
        summary: summaryMatch?.[1]?.trim() ?? "Diagnostic non disponible"
      },
      healthScore: {
        overall: Number(scoreMatch?.[1] ?? 50),
        moisture: Number(scoreDetailMatch?.[1] ?? scoreMatch?.[1] ?? 50),
        temperature: Number(scoreDetailMatch?.[2] ?? scoreMatch?.[1] ?? 50),
        light: Number(scoreDetailMatch?.[3] ?? scoreMatch?.[1] ?? 50),
        stability: Number(scoreDetailMatch?.[4] ?? scoreMatch?.[1] ?? 50)
      },
      actions,
      plan,
      sources,
      tools,
      responseToUser: userResponseMatch?.[1]?.trim() ?? text
    };
  }

  function usePreset(prompt: string) {
    setMessage(prompt);
  }

  function extractBalancedJsonObjects(text: string) {
    const objects: string[] = [];

    for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === "\"") {
            inString = false;
          }
          continue;
        }

        if (char === "\"") {
          inString = true;
        } else if (char === "{") {
          depth += 1;
        } else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            objects.push(text.slice(start, index + 1));
            break;
          }
        }
      }
    }

    return objects;
  }

  function parseJsonCandidate(candidate: string) {
    try {
      const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function isStructuredAgentJson(value: Record<string, unknown> | null) {
    return Boolean(
      value &&
      (value.diagnosis ||
        value.healthScore ||
        value.responseToUser ||
        value.proposedActions ||
        value.careSchedule)
    );
  }

  function extractStructuredAgentJson(text: string) {
    const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(text)?.[1];
    const candidates = [
      fenced,
      ...extractBalancedJsonObjects(fenced ?? ""),
      ...extractBalancedJsonObjects(text)
    ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

    for (const candidate of candidates) {
      const parsed = parseJsonCandidate(candidate);
      if (isStructuredAgentJson(parsed)) return parsed;
    }

    return null;
  }

  function parseStructuredAgentResponse(text: string): ParsedAgentResponse | null {
    const parsed = extractStructuredAgentJson(text);
    if (!parsed) return null;

    const diagnosis = parsed.diagnosis && typeof parsed.diagnosis === "object"
      ? parsed.diagnosis as Record<string, unknown>
      : {};
    const score = parsed.healthScore && typeof parsed.healthScore === "object"
      ? parsed.healthScore as Record<string, unknown>
      : {};
    const readScore = (key: string, fallback = 50) => {
      const value = Number(score[key]);
      return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
    };

    return {
      diagnosis: {
        severity: typeof diagnosis.severity === "string" ? diagnosis.severity : "unknown",
        summary: typeof diagnosis.summary === "string" ? diagnosis.summary : "Diagnostic non disponible"
      },
      healthScore: {
        overall: readScore("overall"),
        moisture: readScore("moisture", readScore("overall")),
        temperature: readScore("temperature", readScore("overall")),
        light: readScore("light", readScore("overall")),
        stability: readScore("stability", readScore("overall"))
      },
      actions: Array.isArray(parsed.proposedActions)
        ? parsed.proposedActions.map((action) => {
            const item = action && typeof action === "object" ? action as Record<string, unknown> : {};
            return {
              type: typeof item.type === "string" ? item.type : "custom",
              description: typeof item.description === "string" ? item.description : "Action a verifier",
              urgency: typeof item.urgency === "string" ? item.urgency : "soon",
              rationale: typeof item.rationale === "string" ? item.rationale : ""
            };
          })
        : [],
      plan: Array.isArray(parsed.careSchedule)
        ? parsed.careSchedule.map((task) => {
            const item = task && typeof task === "object" ? task as Record<string, unknown> : {};
            return {
              priority: typeof item.priority === "string" ? item.priority : "medium",
              title: typeof item.title === "string" ? item.title : "Suivi plante",
              dueAt: typeof item.dueAt === "string" ? item.dueAt : new Date().toISOString(),
              actionType: typeof item.actionType === "string" ? item.actionType : "check",
              cadence: typeof item.cadence === "string" ? item.cadence : "once",
              successCriteria: typeof item.successCriteria === "string" ? item.successCriteria : ""
            };
          })
        : [],
      sources: Array.isArray(parsed.webSources)
        ? parsed.webSources.map((source) => {
            const item = source && typeof source === "object" ? source as Record<string, unknown> : {};
            return {
              title: typeof item.title === "string" ? item.title : "Source web",
              url: typeof item.url === "string" ? item.url : ""
            };
          }).filter((source) => source.url)
        : [],
      tools: [],
      responseToUser: typeof parsed.responseToUser === "string"
        ? parsed.responseToUser
        : typeof diagnosis.summary === "string"
          ? diagnosis.summary
          : text
    };
  }

  async function askAgent() {
    if (!plant || !message.trim()) return;
    setChatBusy(true);
    setAnswer("");
    setParsedAgent(null);
    setShowReasoning(false);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantId: plant.id, message, webSearch, weatherLocation, timezone })
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      const text = await response.text();
      setAnswer(text);
      setParsedAgent(parseAgentResponse(text));
      await refreshCalendar(plant.id);
      setChatBusy(false);
      return;
    }

    let fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      setAnswer((current) => current + chunk);
    }

    setParsedAgent(parseAgentResponse(fullText));
    setMessage("");
    await refreshCalendar(plant.id);
    setChatBusy(false);
  }

  async function togglePush() {
    setPushState("loading");
    try {
      if (pushState === "subscribed") {
        await unsubscribeFromPush();
        setPushState("idle");
      } else {
        const ok = await subscribeToPush();
        setPushState(ok ? "subscribed" : (Notification.permission === "denied" ? "denied" : "idle"));
      }
    } catch {
      setPushState(Notification.permission === "denied" ? "denied" : "idle");
    }
  }

  async function triggerInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  }

  async function connectBle() {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice(options: {
          filters?: Array<{ namePrefix?: string }>;
          optionalServices?: string[];
        }): Promise<{
          name?: string;
          gatt?: { connect(): Promise<unknown> };
        }>;
      };
    };

    if (!nav.bluetooth) {
      setBleStatus("Web Bluetooth indisponible ici; utilise le Wi-Fi sur iPhone.");
      return;
    }

    try {
      setBleStatus("Recherche...");
      const device = await nav.bluetooth.requestDevice({
        filters: [{ namePrefix: "Arborisis" }],
        optionalServices: ["0000a001-0000-1000-8000-00805f9b34fb"]
      });
      await device.gatt?.connect();
      setBleStatus(`Connecte a ${device.name ?? "Arborisis Pico"}`);
    } catch {
      setBleStatus("Connexion BLE annulee ou impossible");
    }
  }

  const healthClass = statusClassName(health);
  const careScore = getCareScore(plant, latest, health, dayCycle);
  const careDecision = getCareDecision(plant, latest, weather, health);
  const sensorStatus = latest ? "Capteur en ligne" : loading ? "Synchronisation" : "Aucune mesure";
  const plantLocation = plant?.location || weather?.location.label || "Maison";
  const plantSpecies = plant?.species || "Profil botanique";
  const soilTempProgress =
    typeof latest?.soilTempC === "number" && plant
      ? ((latest.soilTempC - plant.minSoilTempC) / Math.max(1, plant.maxSoilTempC - plant.minSoilTempC)) * 100
      : undefined;
  const lightProgress =
    typeof latest?.lightLux === "number" && plant
      ? Math.min(100, (latest.lightLux / Math.max(plant.minLightLux * 2, 1)) * 100)
      : undefined;
  const airProgress =
    typeof latest?.airTempC === "number"
      ? Math.min(100, Math.max(0, ((latest.airTempC - 5) / 35) * 100))
      : undefined;

  return (
    <main className="shell appShell">
      <section className="topbar appTopbar">
        <div className="brandLockup">
          <span className="brandMark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <p className="eyebrow">Arborisis Garden</p>
            <strong>{plantLocation}</strong>
          </div>
        </div>
        <div className="topActions">
          <span className={`syncPill ${latest ? "online" : "idle"}`}>
            <Wifi size={15} />
            {sensorStatus}
          </span>
          {installPrompt && (
            <button className="installButton" onClick={triggerInstall} aria-label="Installer l'app" title="Installer sur l'écran d'accueil">
              <Download size={17} />
              <span>Installer</span>
            </button>
          )}
          {pushState !== "unsupported" && (
            <button
              className={`iconButton pushButton ${pushState === "subscribed" ? "active" : ""}`}
              onClick={togglePush}
              disabled={pushState === "loading" || pushState === "denied"}
              aria-label={pushState === "subscribed" ? "Désactiver les notifications" : "Activer les notifications"}
              title={pushState === "denied" ? "Notifications bloquées dans le navigateur" : pushState === "subscribed" ? "Désactiver les alertes" : "Recevoir les alertes plante"}
            >
              {pushState === "subscribed" ? <Bell size={20} /> : <BellOff size={20} />}
            </button>
          )}
          <button className="iconButton" onClick={refresh} aria-label="Rafraichir" title="Rafraichir">
            <RefreshCw size={20} />
          </button>
        </div>
      </section>

      {plant?.device?.lastSeen && new Date().getTime() - new Date(plant.device.lastSeen).getTime() > 15 * 60 * 1000 && (
        <div style={{ background: "var(--danger-glow)", border: "1px solid var(--danger)", borderRadius: "var(--radius-md, 8px)", padding: "10px 16px", margin: "0 16px 8px", display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)", fontSize: "0.9rem" }}>
          <AlertTriangle size={16} />
          <span>Device offline — last seen {formatTime(plant.device.lastSeen, timezone)}</span>
          <button style={{ marginLeft: "auto", background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: "var(--radius-sm, 6px)", padding: "4px 10px", cursor: "pointer", fontSize: "0.8rem" }} onClick={() => setShowPairingModal(true)}>Re-pair</button>
        </div>
      )}

      {showPairingModal && plant?.device && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <DevicePairing deviceSerial={plant.device.serial} onPaired={() => { setShowPairingModal(false); void refresh(); }} onClose={() => setShowPairingModal(false)} />
        </div>
      )}

      {showUnpairConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--surface-raised)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-lg, 12px)", padding: "24px", maxWidth: 360, display: "flex", flexDirection: "column", gap: "16px" }}>
            <h3 style={{ margin: 0, color: "var(--ink)" }}>Unlink device?</h3>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.9rem" }}>This will unlink the device from this plant. All readings are preserved. You can re-pair at any time.</p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button style={{ background: "var(--danger)", color: "#fff", border: "none", borderRadius: "var(--radius-sm, 6px)", padding: "10px 20px", cursor: "pointer", fontWeight: 600 }} onClick={() => void unpairDevice()}>Unlink</button>
              <button style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm, 6px)", padding: "10px 20px", cursor: "pointer" }} onClick={() => setShowUnpairConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <section className="heroGrid">
        <div className="heroPanel">
          <div className="heroCopy">
            <p className="eyebrow">Sante vivante</p>
            <h1>{plant?.name ?? "Compagnon plante"}</h1>
            <p>{careDecision.body}</p>
            <div className="heroChips">
              <span>
                <Leaf size={15} />
                {plantSpecies}
              </span>
              <span>
                <Droplets size={15} />
                Cible {plant?.targetMoisture ?? emptyPlant.targetMoisture}%
              </span>
            </div>
          </div>
          <div className={`scoreRing ${healthClass}`} style={{ "--score": `${careScore}%` } as CSSProperties}>
            <strong>{careScore}</strong>
            <span>score</span>
          </div>
          <div className="plantPortrait" aria-hidden="true">
            <span className="leaf l1" />
            <span className="leaf l2" />
            <span className="leaf l3" />
            <span className="leaf l4" />
            <span className="stem" />
            <span className="sensorPod">
              <span />
            </span>
          </div>
        </div>

        <aside className={`carePanel ${careDecision.tone}`}>
          <div>
            <p className="eyebrow">Decision du jour</p>
            <h2>{careDecision.title}</h2>
            <p>{careDecision.summary}</p>
          </div>
          <div className="careActions">
            <button className="primaryButton compactButton" onClick={() => usePreset(agentPresets[1].prompt)} disabled={!plant}>
              <CalendarDays size={17} />
              Planning
            </button>
            <button className="secondaryButton compactButton" onClick={autoCalibratePlant} disabled={!plant || calibrationBusy}>
              <Sparkles size={17} />
              Calibrer
            </button>
          </div>
          <span>{latest ? `Derniere mesure ${formatTime(latest.recordedAt, timezone)}` : "En attente de mesure"}</span>
        </aside>
      </section>

      <section className="metricGrid">
        <Metric
          icon={<Leaf size={19} />}
          label="Humidite sol"
          value={formatPct(latest?.soilMoisturePct)}
          detail={plant ? `cible ${plant.targetMoisture}%` : undefined}
          progress={latest?.soilMoisturePct ?? undefined}
          accent="var(--water)"
        />
        <Metric
          icon={<Thermometer size={19} />}
          label="Temp. sol"
          value={formatTemp(latest?.soilTempC)}
          detail={plant ? `${plant.minSoilTempC}-${plant.maxSoilTempC} C` : undefined}
          progress={soilTempProgress}
          accent="var(--moss)"
        />
        <Metric
          icon={<Activity size={19} />}
          label="Air"
          value={formatTemp(latest?.airTempC)}
          detail={formatPct(latest?.airHumidityPct)}
          progress={airProgress}
          accent="var(--sky)"
        />
        <Metric
          icon={<Lightbulb size={19} />}
          label="Lumiere"
          value={formatLux(latest?.lightLux)}
          detail={plant ? `min ${plant.minLightLux} lx` : undefined}
          progress={lightProgress}
          accent="var(--sun)"
        />
      </section>

      <div className="dashboardGrid">
        <div className="primaryColumn">
          <section className={`panel weatherPanel ${weather?.gardening.wateringWindow ?? "good"}`}>
        <div className="panelHeader">
          <div>
            <h2>Meteo jardin</h2>
            <p className="small">{weatherStatus || (weatherLoading ? "Chargement..." : "API site")}</p>
          </div>
          <CloudSun size={20} />
        </div>
        <div className="weatherHero">
          <div>
            <span className="weatherLocation">
              <MapPin size={15} />
              {weather?.location.label ?? weatherLocation}
            </span>
            <strong>{formatTemp(weather?.current.temperatureC)}</strong>
            <p>{weather?.current.description ?? "Meteo en attente"}</p>
          </div>
          <label className="weatherSearch">
            Lieu
            <input
              value={weatherLocation}
              onChange={(event) => setWeatherLocation(event.target.value)}
              placeholder="Brussels"
            />
          </label>
        </div>
        <div className="weatherStats">
          <WeatherStat icon={<Umbrella size={17} />} label="Pluie" value={formatMm(weather?.today.precipitationSumMm)} detail={formatPct(weather?.today.precipitationProbabilityMaxPct)} />
          <WeatherStat icon={<Wind size={17} />} label="Vent" value={formatWind(weather?.current.windSpeedKmh)} detail={weather?.current.windGustKmh ? `raf. ${formatWind(weather.current.windGustKmh)}` : undefined} />
          <WeatherStat icon={<Sun size={17} />} label="UV" value={formatNumber(weather?.today.uvIndexMax)} detail={weather?.current.cloudCoverPct ? `${Math.round(weather.current.cloudCoverPct)}% nuages` : undefined} />
        </div>
        {weather && (
          <>
            <p className="weatherAdvice">{weather.gardening.summary}</p>
            <div className="weatherHours">
              {weather.hourly.slice(0, 6).map((hour) => (
                <div className="weatherHour" key={hour.time}>
                  <span>{formatTime(hour.time, timezone)}</span>
                  <strong>{formatTemp(hour.temperatureC)}</strong>
                  <small>{formatPct(hour.precipitationProbabilityPct)}</small>
                </div>
              ))}
            </div>
          </>
        )}
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2>Graphiques</h2>
              <BarChart3 size={18} />
            </div>
            <div className="chartGrid">
              <MiniChart
                readings={chartReadings}
                label="Humidite sol"
                color="var(--water)"
                min={0}
                max={100}
                unit="%"
                getValue={(reading) => reading.soilMoisturePct}
              />
              <MiniChart
                readings={chartReadings}
                label="Lumiere"
                color="var(--sun)"
                min={0}
                max={Math.max(1000, ...chartReadings.map((reading) => reading.lightLux ?? 0))}
                unit="lx"
                getValue={(reading) => reading.lightLux}
              />
              <MiniChart
                readings={chartReadings}
                label="Temperature air"
                color="var(--leaf)"
                min={0}
                max={45}
                unit="C"
                getValue={(reading) => reading.airTempC}
              />
            </div>
          </section>

          <section className="panel photoPanel">
            <div className="panelHeader">
              <div>
                <h2>Galerie photo</h2>
                <p className="small">{photoStatus || "Images stockees dans le bucket Railway, analysees par OpenRouter."}</p>
              </div>
              <Camera size={18} />
            </div>
            <div className="photoUploader">
              <input
                value={photoTitle}
                onChange={(event) => setPhotoTitle(event.target.value)}
                placeholder="Titre de la photo"
                disabled={photoBusy}
              />
              <label className={`uploadButton ${photoBusy ? "busy" : ""}`}>
                <Upload size={17} />
                {photoBusy ? "Analyse..." : "Ajouter"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!plant || photoBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    void uploadPhoto(file);
                  }}
                />
              </label>
            </div>
            {photos.length ? (
              <div className="photoGrid">
                {photos.map((photo) => (
                  <article className="photoCard" key={photo.id}>
                    <img src={photo.imageUrl} alt={photo.title} />
                    <div className="photoCardBody">
                      <div className="photoCardTitle">
                        <strong>{photo.title}</strong>
                        {typeof photo.healthScore === "number" && <span>{photo.healthScore}/100</span>}
                      </div>
                      <p>{photo.analysis}</p>
                      {photo.observations.length > 0 && (
                        <ul>
                          {photo.observations.slice(0, 2).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                      <div className="photoMeta">
                        <span>{formatDateTime(photo.createdAt, timezone)}</span>
                        <button className="iconButton smallIcon" onClick={() => void deletePhoto(photo.id)} aria-label="Supprimer la photo" title="Supprimer la photo">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <ImagePlus size={20} />
                <span>Aucune photo analysee pour cette plante.</span>
              </div>
            )}
          </section>

          <section className="panel agentPanel">
            <div className="panelHeader">
              <h2>Agent IA Autonome</h2>
              <div className="agentHeaderTools">
                <button
                  type="button"
                  className={`agentSwitch ${webSearch ? "active" : ""}`}
                  onClick={() => setWebSearch(!webSearch)}
                  aria-pressed={webSearch}
                  title={webSearch ? "Recherche web activee" : "Recherche web desactivee"}
                >
                  <Globe2 size={16} />
                  <span>Web</span>
                </button>
                <BrainCircuit size={18} />
              </div>
            </div>
            <div className="agentPresetGrid">
              {agentPresets.map((preset, index) => (
                <button
                  type="button"
                  className="agentPreset"
                  data-variant={preset.variant}
                  onClick={() => usePreset(preset.prompt)}
                  key={preset.label}
                >
                  {index === 0 && <Search size={14} />}
                  {index === 1 && <CalendarDays size={14} />}
                  {index === 2 && <Globe2 size={14} />}
                  {index === 3 && <AlertTriangle size={14} />}
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Demande une analyse, un planning, une recherche espece ou une action precise..."
              rows={3}
            />
            <button className="primaryButton" onClick={askAgent} disabled={!plant || chatBusy}>
              <MessageCircle size={18} />
              {chatBusy ? "Raisonnement en cours..." : "Lancer l'agent"}
            </button>

            {parsedAgent && (
              <div className="agentResult">
                <div className={`agentDiagnosis ${parsedAgent.diagnosis.severity}`}>
                  <div className="agentDiagnosisHeader">
                    <Zap size={16} />
                    <strong>Diagnostic: {parsedAgent.diagnosis.severity}</strong>
                    <span className="agentScore">{parsedAgent.healthScore.overall}/100</span>
                  </div>
                  <p>{parsedAgent.diagnosis.summary}</p>
                </div>

                <div className="agentHealthGrid">
                  <AgentGauge label="Eau" value={parsedAgent.healthScore.moisture} />
                  <AgentGauge label="Temp." value={parsedAgent.healthScore.temperature} />
                  <AgentGauge label="Lumiere" value={parsedAgent.healthScore.light} />
                  <AgentGauge label="Stabilite" value={parsedAgent.healthScore.stability} />
                </div>

                <div className="agentUserResponse">
                  <strong>Decision de l'agent</strong>
                  <p>{parsedAgent.responseToUser}</p>
                </div>

                {parsedAgent.actions.length > 0 && (
                  <div className="agentActions">
                    <strong>Actions proposees</strong>
                    {parsedAgent.actions.map((action, i) => (
                      <div className={`agentAction ${action.urgency}`} key={i}>
                        <div className="agentActionHeader">
                          <Droplets size={14} />
                          <span className="agentActionUrgency">{action.urgency}</span>
                          <span>{action.description}</span>
                        </div>
                        <p className="small">{action.rationale}</p>
                      </div>
                    ))}
                  </div>
                )}

                {parsedAgent.plan.length > 0 && (
                  <div className="agentPlan">
                    <strong>Planning</strong>
                    {parsedAgent.plan.map((task, i) => (
                      <div className={`agentTask ${task.priority}`} key={`${task.title}-${i}`}>
                        <div>
                          <span className="agentTaskDate">{formatDateTime(task.dueAt, timezone)}</span>
                          <strong>{task.title}</strong>
                        </div>
                        <p className="small">{task.successCriteria}</p>
                      </div>
                    ))}
                  </div>
                )}

                {(parsedAgent.sources.length > 0 || parsedAgent.tools.length > 0) && (
                  <div className="agentEvidence">
                    {parsedAgent.sources.length > 0 && (
                      <div>
                        <strong>Sources</strong>
                        <div className="sourceList">
                          {parsedAgent.sources.map((source) => (
                            <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                              <Globe2 size={14} />
                              <span>{source.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {parsedAgent.tools.length > 0 && (
                      <div>
                        <strong>Outils</strong>
                        <div className="toolList">
                          {parsedAgent.tools.map((tool) => (
                            <span key={tool}>{tool}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="agentToggle"
                  onClick={() => setShowReasoning((s) => !s)}
                >
                  {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {showReasoning ? "Masquer le raisonnement" : "Voir le raisonnement complet"}
                </button>
              </div>
            )}

            {answer && showReasoning && (
              <div className="answer reasoning">{answer}</div>
            )}
            {answer && !parsedAgent && <div className="answer">{answer}</div>}
          </section>
        </div>

        <aside className="sideColumn">
          <section className="panel">
            <div className="panelHeader">
              <h2>Insights IA</h2>
              <div className="insightHeaderMeta">
                <span>{insightsLoading ? "Generation..." : insightsStatus}</span>
                <BrainCircuit size={18} />
              </div>
            </div>
            <div className="insightList">
              {insights.map((insight) => (
                <article className={`insight ${insight.tone}`} key={insight.title}>
                  <strong>{insight.title}</strong>
                  <p>{insight.body}</p>
                </article>
              ))}
            </div>
          </section>

          {plant?.id && (
            <MLIntelligencePanel
              plantId={plant.id}
              weatherLocation={(weatherLocation.trim() || plant.location) ?? undefined}
              timezone={timezone}
            />
          )}

          <section className="panel calendarPanel">
        <div className="panelHeader">
          <div>
            <h2>Calendrier</h2>
            <p className="small">{calendarStatus || "Planning manuel et taches ajoutees par l'agent."}</p>
          </div>
          <CalendarDays size={18} />
        </div>
        <div className="calendarForm">
          <input
            value={eventForm.title}
            onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })}
            placeholder="Tache"
          />
          <input
            type="datetime-local"
            value={eventForm.startsAt}
            onChange={(event) => setEventForm({ ...eventForm, startsAt: event.target.value })}
          />
          <div className="calendarControls">
            <select
              value={eventForm.category}
              onChange={(event) => setEventForm({ ...eventForm, category: event.target.value })}
            >
              <option value="check">Controle</option>
              <option value="water">Arrosage</option>
              <option value="relocate">Emplacement</option>
              <option value="prune">Taille</option>
              <option value="fertilize">Engrais</option>
              <option value="custom">Autre</option>
            </select>
            <select
              value={eventForm.priority}
              onChange={(event) => setEventForm({ ...eventForm, priority: event.target.value })}
            >
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Basse</option>
            </select>
          </div>
          <textarea
            value={eventForm.description}
            onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })}
            placeholder="Notes"
            rows={2}
          />
          <button className="secondaryButton" onClick={saveCalendarEvent} disabled={!plant || calendarBusy}>
            <Plus size={17} />
            Ajouter au planning
          </button>
        </div>
        <div className="calendarList">
          {calendarEvents.length ? calendarEvents.map((event) => (
            <article className={`calendarItem ${event.priority} ${event.status}`} key={event.id}>
              <div>
                <span className="calendarDate">{formatDateTime(event.startsAt, timezone)}</span>
                <strong>{event.title}</strong>
                {event.description && <p>{event.description}</p>}
                <div className="calendarTags">
                  <span>{event.category}</span>
                  <span>{event.source === "agent" ? "agent IA" : "manuel"}</span>
                </div>
              </div>
              <div className="calendarActions">
                <button
                  className="iconButton smallIcon"
                  onClick={() => void updateCalendarStatus(event.id, event.status === "done" ? "planned" : "done")}
                  aria-label={event.status === "done" ? "Remettre a planifier" : "Marquer fait"}
                  title={event.status === "done" ? "Remettre a planifier" : "Marquer fait"}
                >
                  <CheckCircle2 size={16} />
                </button>
                <button className="iconButton smallIcon" onClick={() => void deleteCalendarEvent(event.id)} aria-label="Supprimer" title="Supprimer">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          )) : (
            <div className="emptyState">
              <CalendarDays size={20} />
              <span>Aucune tache planifiee.</span>
            </div>
          )}
        </div>
          </section>

          <section className="panel cyclePanel">
        <div className="panelHeader">
          <h2>Cycle jour nuit</h2>
          {dayCycle.isDay ? <Sun size={18} /> : <Moon size={18} />}
        </div>
        <div className="cycleGrid">
          <div>
            <span className="muted">Phase locale</span>
            <strong>{dayCycle.label}</strong>
            <p className="small">{dayCycle.localTime} dans {timezone}</p>
          </div>
          <label>
            Fuseau horaire
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {[timezone, ...timezones.filter((option) => option !== timezone)].map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cycleTrack" aria-label={`Cycle ${dayCycle.label}`}>
          <span style={{ left: `${dayCycle.progress}%` }} />
        </div>
          </section>

          <section className="panel">
        <div className="panelHeader">
          <h2>Connexion produit</h2>
          <Wifi size={18} />
        </div>
        <p className="muted">Wi-Fi prioritaire. BLE disponible pour diagnostic local.</p>
        <button className="secondaryButton" onClick={connectBle}>
          <Bluetooth size={17} />
          Connecter BLE
        </button>
        <p className="small">{bleStatus}</p>
        {plant?.device && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--line)" }}>
            <p className="small" style={{ margin: "0 0 8px" }}>Appare: <strong>{plant.device.serial}</strong> — {plant.device.name}</p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button className="secondaryButton compactButton" onClick={() => setShowPairingModal(true)}>Re-pair</button>
              <button style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)", borderRadius: "var(--radius-sm, 6px)", padding: "6px 14px", cursor: "pointer", fontSize: "0.85rem" }} onClick={() => setShowUnpairConfirm(true)}>Unlink device</button>
            </div>
          </div>
        )}
        {!plant?.device && plant && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--line)" }}>
            <p className="small" style={{ margin: "0 0 8px", color: "var(--muted)" }}>No device linked.</p>
          </div>
        )}
          </section>

          <section className="panel">
        <div className="panelHeader">
          <h2>Alertes</h2>
          <AlertTriangle size={18} />
        </div>
        {plant?.alerts?.length ? (
          <div className="alertList">
            {plant.alerts.map((alert) => (
              <article className={`alert ${alert.severity}`} key={alert.id}>
                <strong>{alert.title}</strong>
                <p>{alert.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Aucune alerte ouverte.</p>
        )}
          </section>

          <section className="panel">
        <div className="panelHeader">
          <h2>Profil plante</h2>
          <div className="profileActions">
            <button
              className="iconButton smallIcon"
              onClick={autoCalibratePlant}
              disabled={!plant || calibrationBusy}
              aria-label="Calibrer avec recherche IA web"
              title="Calibrer avec recherche IA web"
            >
              <Sparkles size={18} />
            </button>
            <button className="iconButton smallIcon" onClick={savePlant} aria-label="Sauvegarder" title="Sauvegarder">
              <Save size={18} />
            </button>
          </div>
        </div>
        <div className="formGrid">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input
            value={form.species}
            onChange={(event) => setForm({ ...form, species: event.target.value })}
            placeholder="Espece"
          />
          <input
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
            placeholder="Lieu"
          />
          <label>
            Humidite cible
            <input
              type="number"
              value={form.targetMoisture}
              onChange={(event) => setForm({ ...form, targetMoisture: Number(event.target.value) })}
            />
          </label>
          <label>
            Lumiere min.
            <input
              type="number"
              value={form.minLightLux}
              onChange={(event) => setForm({ ...form, minLightLux: Number(event.target.value) })}
            />
          </label>
        </div>
        {calibrationMessage && <p className="calibrationNote">{calibrationMessage}</p>}
          </section>

          <section className="history panel">
        <div className="historyHeader">
          <h2>Historique</h2>
          <Clock size={17} />
        </div>
        {(plant?.readings ?? []).slice(0, 16).map((reading) => (
          <div className="historyRow" key={reading.id}>
            <span>{formatTime(reading.recordedAt, timezone)}</span>
            <strong>{formatPct(reading.soilMoisturePct)}</strong>
            <span>{formatLux(reading.lightLux)}</span>
          </div>
        ))}
          </section>
        </aside>
      </div>
    </main>
  );
}

function AgentGauge({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="agentGauge">
      <span>{label}</span>
      <strong>{bounded}%</strong>
      <div className="agentGaugeTrack">
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  progress,
  accent = "var(--leaf)"
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
  accent?: string;
}) {
  const boundedProgress = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <article className="metric" style={{ "--metric-accent": accent } as CSSProperties}>
      <div className="metricIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
      {boundedProgress !== null && (
        <div className="metricBar" aria-hidden="true">
          <span style={{ width: `${boundedProgress}%` }} />
        </div>
      )}
    </article>
  );
}

function WeatherStat({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="weatherStat">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail && <em>{detail}</em>}
      </div>
    </article>
  );
}

function MiniChart({
  readings,
  label,
  color,
  min,
  max,
  unit,
  getValue
}: {
  readings: Reading[];
  label: string;
  color: string;
  min: number;
  max: number;
  unit: string;
  getValue: (reading: Reading) => number | null;
}) {
  const values = readings
    .map((reading, index) => ({ value: getValue(reading), index }))
    .filter((point): point is { value: number; index: number } => typeof point.value === "number");
  const latestValue = values.at(-1)?.value;
  const range = Math.max(1, max - min);
  const width = 320;
  const height = 126;
  const points = values
    .map((point) => {
      const x = readings.length <= 1 ? width : (point.index / (readings.length - 1)) * width;
      const y = height - ((point.value - min) / range) * height;
      return `${x.toFixed(1)},${Math.max(0, Math.min(height, y)).toFixed(1)}`;
    })
    .join(" ");

  const gradientId = `grad-${label.replace(/\s+/g, "-")}`;
  const getX = (index: number) => readings.length <= 1 ? width : (index / (readings.length - 1)) * width;
  const fillPoints = values.length > 0
    ? `${getX(values[0].index).toFixed(1)},${height} ${points} ${getX(values.at(-1)!.index).toFixed(1)},${height}`
    : "";

  return (
    <article className="chartCard">
      <div className="chartTitle">
        <span>{label}</span>
        <strong>{typeof latestValue === "number" ? `${Math.round(latestValue)} ${unit}` : "--"}</strong>
      </div>
      {points ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Graphique ${label}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1={height - 1} x2={width} y2={height - 1} />
          {fillPoints && (
            <polygon points={fillPoints} fill={`url(#${gradientId})`} className="chartAreaFill" />
          )}
          <polyline points={points} style={{ stroke: color }} />
        </svg>
      ) : (
        <div className="chartEmpty">Pas encore assez de donnees</div>
      )}
    </article>
  );
}

function prepareImageDataUrl(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return Promise.reject(new Error("Format accepte: JPG, PNG ou WebP."));
  }

  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Compression image impossible"));
        return;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.84));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Lecture de l'image impossible"));
    };

    image.src = url;
  });
}

function toDatetimeLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatPct(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value)}%` : "--";
}

function formatTemp(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(1)} C` : "--";
}

function formatLux(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value)} lx` : "--";
}

function formatMm(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(value >= 10 ? 0 : 1)} mm` : "--";
}

function formatWind(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value)} km/h` : "--";
}

function formatNumber(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value * 10) / 10}` : "--";
}

function formatTime(value: string, timezone: string) {
  return new Date(value).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone
  });
}

function formatDateTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone
  });
}

function getDayCycle(timezone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const decimalHour = hour + minute / 60;
  const progress = Math.round((decimalHour / 24) * 100);

  if (hour < 6) return { label: "Nuit", isDay: false, progress, localTime: `${pad(hour)}:${pad(minute)}` };
  if (hour < 10) return { label: "Matin", isDay: true, progress, localTime: `${pad(hour)}:${pad(minute)}` };
  if (hour < 18) return { label: "Jour", isDay: true, progress, localTime: `${pad(hour)}:${pad(minute)}` };
  if (hour < 22) return { label: "Soir", isDay: false, progress, localTime: `${pad(hour)}:${pad(minute)}` };
  return { label: "Nuit", isDay: false, progress, localTime: `${pad(hour)}:${pad(minute)}` };
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function statusClassName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

function getCareScore(
  plant: Plant | undefined,
  latest: Reading | undefined,
  health: string,
  cycle: ReturnType<typeof getDayCycle>
) {
  if (!plant || !latest) return 0;
  if (health === "Urgent") return 38;

  let score = health === "A surveiller" ? 72 : 92;

  if (typeof latest.soilMoisturePct === "number") {
    score -= Math.min(28, Math.abs(latest.soilMoisturePct - plant.targetMoisture) * 0.9);
  }

  if (typeof latest.soilTempC === "number") {
    if (latest.soilTempC < plant.minSoilTempC || latest.soilTempC > plant.maxSoilTempC) score -= 18;
  }

  if (cycle.isDay && typeof latest.lightLux === "number" && latest.lightLux < plant.minLightLux) {
    score -= 12;
  }

  return Math.max(8, Math.min(99, Math.round(score)));
}

function getCareDecision(
  plant: Plant | undefined,
  latest: Reading | undefined,
  weather: WeatherContext | null,
  health: string
) {
  if (!plant || !latest) {
    return {
      title: "Connecter une premiere mesure",
      body: "L'app attend les donnees capteur pour prioriser l'arrosage, la lumiere et la temperature.",
      summary: "Aucun diagnostic fiable sans mesure recente.",
      tone: "watch"
    };
  }

  if (health === "Urgent") {
    return {
      title: "Intervenir maintenant",
      body: "Une alerte critique est ouverte. Verifie les racines, le substrat et la temperature avant d'ajouter de l'eau.",
      summary: "Traiter l'alerte active avant toute action de confort.",
      tone: "urgent"
    };
  }

  const moistureGap = typeof latest.soilMoisturePct === "number"
    ? latest.soilMoisturePct - plant.targetMoisture
    : null;

  if (typeof moistureGap === "number" && moistureGap < -8) {
    const weatherHint = weather?.gardening.wateringWindow === "good"
      ? "La meteo confirme une bonne fenetre d'arrosage."
      : "Dose doucement et evite les heures chaudes.";
    return {
      title: "Arroser prudemment",
      body: `Le sol est ${Math.abs(Math.round(moistureGap))}% sous la cible. ${weatherHint}`,
      summary: "Arrosage leger, puis controle de la pente dans les prochaines heures.",
      tone: "watch"
    };
  }

  if (typeof moistureGap === "number" && moistureGap > 18) {
    return {
      title: "Laisser secher",
      body: "Le substrat est encore tres humide. Attends une baisse nette avant le prochain apport.",
      summary: "Priorite aux racines: air, chaleur douce et pas d'eau aujourd'hui.",
      tone: "urgent"
    };
  }

  if (typeof latest.soilTempC === "number" && (latest.soilTempC < plant.minSoilTempC || latest.soilTempC > plant.maxSoilTempC)) {
    return {
      title: "Stabiliser la temperature",
      body: `Le sol est a ${latest.soilTempC.toFixed(1)} C, hors plage ${plant.minSoilTempC}-${plant.maxSoilTempC} C.`,
      summary: "Deplace la plante avant de modifier l'arrosage.",
      tone: "watch"
    };
  }

  return {
    title: "Observer avant d'agir",
    body: "Les mesures restent proches de la zone cible. Surveille la tendance avant de changer les soins.",
    summary: weather?.gardening.summary ?? "Prochaine action: recontrole au prochain cycle lumineux.",
    tone: "good"
  };
}

function buildInsights(plant: Plant | undefined, readings: Reading[], cycle: ReturnType<typeof getDayCycle>): Insight[] {
  if (!plant || readings.length === 0) {
    return [
      {
        title: "En attente de donnees",
        body: "Ajoute quelques mesures capteur pour generer des tendances fiables.",
        tone: "watch"
      }
    ];
  }

  const latest = readings.at(-1);
  const first = readings[0];
  const insights: Insight[] = [];
  const moistureDelta =
    typeof latest?.soilMoisturePct === "number" && typeof first?.soilMoisturePct === "number"
      ? latest.soilMoisturePct - first.soilMoisturePct
      : null;

  if (typeof latest?.soilMoisturePct === "number") {
    const gap = latest.soilMoisturePct - plant.targetMoisture;
    if (gap < -8) {
      insights.push({
        title: "Arrosage probable",
        body: `Le sol est ${Math.abs(Math.round(gap))}% sous la cible. Verifie le substrat avant d'arroser.`,
        tone: "urgent"
      });
    } else if (gap > 18) {
      insights.push({
        title: "Sol tres humide",
        body: "Laisse secher avant le prochain apport d'eau pour limiter le stress racinaire.",
        tone: "watch"
      });
    } else {
      insights.push({
        title: "Humidite coherente",
        body: "Le niveau du sol reste proche de la cible configuree.",
        tone: "good"
      });
    }
  }

  if (typeof moistureDelta === "number" && Math.abs(moistureDelta) >= 6) {
    insights.push({
      title: moistureDelta < 0 ? "Tendance au sechage" : "Tendance a la hausse",
      body: `Variation recente: ${Math.round(moistureDelta)}%. Surveille si cette pente continue.`,
      tone: moistureDelta < 0 ? "watch" : "good"
    });
  }

  if (typeof latest?.lightLux === "number") {
    if (cycle.isDay && latest.lightLux < plant.minLightLux) {
      insights.push({
        title: "Lumiere faible en journee",
        body: `La mesure est sous le seuil de ${plant.minLightLux} lx pour la phase ${cycle.label.toLowerCase()}.`,
        tone: "watch"
      });
    } else if (!cycle.isDay && latest.lightLux > plant.minLightLux) {
      insights.push({
        title: "Lumiere nocturne detectee",
        body: "Le cycle indique la nuit ou le soir, mais le capteur voit encore beaucoup de lumiere.",
        tone: "watch"
      });
    }
  }

  if (typeof latest?.soilTempC === "number") {
    if (latest.soilTempC < plant.minSoilTempC || latest.soilTempC > plant.maxSoilTempC) {
      insights.push({
        title: "Temperature hors plage",
        body: `Le sol est a ${latest.soilTempC.toFixed(1)} C pour une plage ${plant.minSoilTempC}-${plant.maxSoilTempC} C.`,
        tone: "urgent"
      });
    }
  }

  return insights.slice(0, 4);
}
