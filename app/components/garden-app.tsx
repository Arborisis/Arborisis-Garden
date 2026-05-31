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
  Home,
  ImagePlus,
  Leaf,
  Lightbulb,
  MapPin,
  MessageCircle,
  Moon,
  MoreHorizontal,
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
  colorTags: string[];
  colorAnomalyScore: number;
  colorAnomalyConfidence: number;
  colorFindings: unknown[];
  diseaseLabel: string | null;
  diseaseConfidence: number;
  diseaseHealthy: boolean | null;
  diseasePredictions: { label: string; probability: number; healthy: boolean }[];
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
  mode: "chat" | "analysis";
  diagnosis: { severity: string; summary: string };
  healthScore: { overall: number; moisture: number; temperature: number; light: number; stability: number };
  actions: AgentAction[];
  plan: AgentPlanTask[];
  sources: AgentSource[];
  tools: string[];
  responseToUser: string;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parsed?: ParsedAgentResponse | null;
  pending?: boolean;
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

const maxPhotoUploadViews = 6;

export function GardenApp() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [chatThread, setChatThread] = useState<ChatTurn[]>([]);
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
  const [weatherTrendMode, setWeatherTrendMode] = useState<"next" | "sun" | "rain">("next");
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarItem[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState("");
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "idle" | "loading">("loading");
  const [activeTab, setActiveTab] = useState("home");
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

  // Hydrate le fil de conversation au changement de plante.
  useEffect(() => {
    if (!plant?.id) {
      setChatThread([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat?plantId=${encodeURIComponent(plant.id)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.messages)) return;
        const turns: ChatTurn[] = data.messages.map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "assistant",
          content: m.role === "user" ? m.content : "",
          parsed: m.role === "user" ? undefined : parseAgentResponse(m.content)
        }));
        // Pour l'assistant, on affiche la reponse naturelle parsee plutot que le payload brut.
        for (const turn of turns) {
          if (turn.role === "assistant" && turn.parsed) {
            turn.content = turn.parsed.responseToUser;
          }
        }
        setChatThread(turns);
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
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

  async function uploadPhotos(files: FileList | File[] | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!plant || !selectedFiles.length || photoBusy) return;

    const uploadFiles = selectedFiles.slice(0, maxPhotoUploadViews);
    const skippedCount = selectedFiles.length - uploadFiles.length;
    setPhotoBusy(true);
    setPhotoStatus(
      uploadFiles.length > 1
        ? `Compression des vues 1/${uploadFiles.length}...`
        : "Compression de la photo..."
    );

    try {
      const images: Array<{ title: string; imageDataUrl: string; takenAt: string }> = [];
      for (const [index, file] of uploadFiles.entries()) {
        setPhotoStatus(
          uploadFiles.length > 1
            ? `Compression des vues ${index + 1}/${uploadFiles.length}...`
            : "Compression de la photo..."
        );
        images.push({
          title: buildPhotoUploadTitle(file, index, uploadFiles.length, photoTitle),
          imageDataUrl: await prepareImageDataUrl(file),
          takenAt: new Date(file.lastModified || Date.now()).toISOString()
        });
      }

      setPhotoStatus(
        uploadFiles.length > 1
          ? "Envoi des vues dans le bucket Railway et analyse IA..."
          : "Envoi dans le bucket Railway et analyse IA..."
      );
      const response = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId: plant.id,
          title: photoTitle.trim() || undefined,
          images
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? "Upload photo impossible");
      }

      const data = await response.json() as { photos?: PlantPhoto[]; photo?: PlantPhoto };
      const uploadedCount = data.photos?.length ?? (data.photo ? 1 : uploadFiles.length);
      setPhotoTitle("");
      setPhotoStatus(
        `${uploadedCount} ${uploadedCount > 1 ? "photos stockees" : "photo stockee"} et ${uploadedCount > 1 ? "analysees" : "analysee"} par OpenRouter.` +
          (skippedCount > 0 ? ` ${skippedCount} vue(s) ignoree(s): maximum ${maxPhotoUploadViews}.` : "")
      );
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

    const looksLikeAnalysis = Boolean(severityMatch) || actions.length > 0 || plan.length > 0;

    return {
      mode: looksLikeAnalysis ? "analysis" : "chat",
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
      // En mode chat le texte visible (hors bloc JSON) EST la reponse.
      responseToUser: userResponseMatch?.[1]?.trim()
        ?? text.replace(/```(?:json)?[\s\S]*?```/g, "").trim()
        ?? text
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

    const hasAnalysisPayload = Boolean(
      (Array.isArray(parsed.proposedActions) && parsed.proposedActions.length) ||
      (Array.isArray(parsed.careSchedule) && parsed.careSchedule.length) ||
      (typeof diagnosis.summary === "string" && diagnosis.summary)
    );
    const mode: ParsedAgentResponse["mode"] =
      parsed.mode === "chat" || parsed.mode === "analysis"
        ? parsed.mode
        : hasAnalysisPayload ? "analysis" : "chat";

    return {
      mode,
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

  function stripJsonFences(text: string) {
    return text.replace(/```(?:json)?[\s\S]*?```/g, "").trim();
  }

  function newTurnId() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  }

  async function askAgent() {
    if (!plant || !message.trim()) return;
    const userText = message.trim();
    const assistantId = newTurnId();

    setChatBusy(true);
    setAnswer("");
    setShowReasoning(false);
    setMessage("");
    setChatThread((prev) => [
      ...prev,
      { id: newTurnId(), role: "user", content: userText },
      { id: assistantId, role: "assistant", content: "", pending: true }
    ]);

    const updateAssistant = (patch: Partial<ChatTurn>) =>
      setChatThread((prev) => prev.map((turn) => (turn.id === assistantId ? { ...turn, ...patch } : turn)));

    let fullText = "";
    let responseReceived = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantId: plant.id, message: userText, webSearch, weatherLocation, timezone })
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        fullText = await response.text();
      } else {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setAnswer(fullText);
          updateAssistant({ content: stripJsonFences(fullText) || "..." });
        }
      }

      const parsed = parseAgentResponse(fullText);
      updateAssistant({ content: parsed.responseToUser, parsed, pending: false });
      responseReceived = true;
      await refreshCalendar(plant.id).catch(() => {});
    } catch (err) {
      if (!responseReceived) {
        const msg = err instanceof Error ? err.message : "Erreur de connexion";
        setAnswer(`Erreur: ${msg}`);
        updateAssistant({ content: `Erreur: ${msg}`, pending: false });
      }
    } finally {
      setChatBusy(false);
    }
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
  const plantState = getPlantState(careScore);
  const needsWater = typeof latest?.soilMoisturePct === "number" && !!plant
    && latest.soilMoisturePct < plant.targetMoisture - 8;
  const goodLight = dayCycle.isDay && typeof latest?.lightLux === "number" && !!plant
    && latest.lightLux >= plant.minLightLux;
  const tempAlert = typeof latest?.soilTempC === "number" && !!plant
    && (latest.soilTempC < plant.minSoilTempC || latest.soilTempC > plant.maxSoilTempC);
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
  const weatherHours = useMemo(() => {
    const hours = weather?.hourly ?? [];
    if (weatherTrendMode === "sun") {
      return [...hours]
        .sort((a, b) => (b.solarRadiationWm2 ?? 0) - (a.solarRadiationWm2 ?? 0))
        .slice(0, 6)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    }
    if (weatherTrendMode === "rain") {
      return [...hours]
        .sort((a, b) => (b.precipitationProbabilityPct ?? 0) - (a.precipitationProbabilityPct ?? 0))
        .slice(0, 6)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    }
    return hours.slice(0, 6);
  }, [weather?.hourly, weatherTrendMode]);
  const goodWateringSlot = weather?.gardening.wateringWindow === "good";

  const tabHidden = (tabs: string[]) => tabs.includes(activeTab) ? "" : "mobileHidden";

  return (
    <main className="shell appShell" data-tab={activeTab}>
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

      <section className={`heroGrid ${tabHidden(["home"])}`}>
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
            <PlantLevel careScore={careScore} />
          </div>
          <div className={`scoreRing ${healthClass}`} style={{ "--score": `${careScore}%` } as CSSProperties}>
            <strong>{careScore}</strong>
            <span>score</span>
          </div>
          <AnimatedPlant
            state={plantState}
            needsWater={needsWater}
            goodLight={goodLight}
            tempAlert={tempAlert}
          />
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

      <section className={`metricGrid ${tabHidden(["home", "capteurs"])}`}>
        <Metric
          icon={<Leaf size={19} />}
          label="Humidite sol"
          value={formatPct(latest?.soilMoisturePct)}
          detail={plant ? `cible ${plant.targetMoisture}%` : undefined}
          progress={latest?.soilMoisturePct ?? undefined}
          series={chartReadings.map((reading) => reading.soilMoisturePct).filter((v): v is number => v != null)}
          trend={sparkTrend(chartReadings.map((reading) => reading.soilMoisturePct))}
          accent="var(--water)"
        />
        <Metric
          icon={<Thermometer size={19} />}
          label="Temp. sol"
          value={formatTemp(latest?.soilTempC)}
          detail={plant ? `${plant.minSoilTempC}-${plant.maxSoilTempC} C` : undefined}
          progress={soilTempProgress}
          series={chartReadings.map((reading) => reading.soilTempC).filter((v): v is number => v != null)}
          trend={sparkTrend(chartReadings.map((reading) => reading.soilTempC))}
          accent="var(--moss)"
        />
        <Metric
          icon={<Activity size={19} />}
          label="Air"
          value={formatTemp(latest?.airTempC)}
          detail={formatPct(latest?.airHumidityPct)}
          progress={airProgress}
          series={chartReadings.map((reading) => reading.airTempC).filter((v): v is number => v != null)}
          trend={sparkTrend(chartReadings.map((reading) => reading.airTempC))}
          accent="var(--sky)"
        />
        <Metric
          icon={<Lightbulb size={19} />}
          label="Lumiere"
          value={formatLux(latest?.lightLux)}
          detail={plant ? `min ${plant.minLightLux} lx` : undefined}
          progress={lightProgress}
          series={chartReadings.map((reading) => reading.lightLux).filter((v): v is number => v != null)}
          trend={sparkTrend(chartReadings.map((reading) => reading.lightLux))}
          accent="var(--sun)"
        />
      </section>

      <div className="dashboardGrid">
        <div className="primaryColumn">
          <section className={`panel weatherPanel ${weather?.gardening.wateringWindow ?? "good"} ${tabHidden(["meteo"])}`}>
        <div className="panelHeader">
          <div>
            <h2>Meteo jardin</h2>
            <p className="small">{weatherStatus || (weatherLoading ? "Chargement..." : "API site")}</p>
          </div>
          <CloudSun size={20} />
        </div>
        <div className="weatherToolbar">
          <div className="segmentedControl" aria-label="Tendances meteo">
            <button type="button" className={weatherTrendMode === "next" ? "active" : ""} onClick={() => setWeatherTrendMode("next")}>
              Prochaines
            </button>
            <button type="button" className={weatherTrendMode === "sun" ? "active" : ""} onClick={() => setWeatherTrendMode("sun")}>
              Lumiere
            </button>
            <button type="button" className={weatherTrendMode === "rain" ? "active" : ""} onClick={() => setWeatherTrendMode("rain")}>
              Pluie
            </button>
          </div>
          <span className={`weatherWindowBadge ${goodWateringSlot ? "good" : "watch"}`}>
            {goodWateringSlot ? <CheckCircle2 size={14} /> : <Clock size={14} />}
            {goodWateringSlot ? "bon creneau" : "a verifier"}
          </span>
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
              {weatherHours.map((hour) => (
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

          <section className={`panel ${tabHidden(["capteurs"])}`}>
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

          <section className={`panel photoPanel ${tabHidden(["plus"])}`}>
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
                placeholder="Titre de l'analyse"
                disabled={photoBusy}
              />
              <label className={`uploadButton ${photoBusy ? "busy" : ""}`}>
                <Upload size={17} />
                {photoBusy ? "Analyse..." : "Ajouter vues"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={!plant || photoBusy}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void uploadPhotos(files);
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
                      {photo.colorTags.length > 0 && (
                        <div className="photoTags" aria-label="Tags couleur">
                          {photo.colorTags.slice(0, 4).map((tag) => (
                            <span className="photoTag" key={tag}>{tag}</span>
                          ))}
                          <span className="photoTag score">
                            {Math.round(photo.colorAnomalyScore * 100)}%
                          </span>
                        </div>
                      )}
                      {photo.diseaseLabel && photo.diseaseHealthy === false && (
                        <div className="photoTags" aria-label="Modele maladies">
                          <span className="photoTag score" title="Classification CNN (modele ONNX)">
                            🔬 {photo.diseaseLabel} · {Math.round(photo.diseaseConfidence * 100)}%
                          </span>
                        </div>
                      )}
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

          <section className={`panel agentPanel ${tabHidden(["ia"])}`}>
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
            {chatThread.length > 0 && (
              <div className="chatThread" aria-live="polite">
                {chatThread.map((turn) => {
                  // En mode analyse, les AgentCards portent deja diagnostic/score/actions/planning :
                  // on n'affiche pas la bulle de texte brut pour eviter le doublon (le gros bloc
                  // de planning qui reapparaissait apres rechargement du fil).
                  const isAnalysis = turn.role === "assistant" && turn.parsed?.mode === "analysis";
                  return (
                    <div className={`chatTurn ${turn.role}`} key={turn.id}>
                      <div className="chatAvatar" aria-hidden="true">
                        {turn.role === "assistant" ? <Leaf size={15} /> : <MessageCircle size={15} />}
                      </div>
                      <div className={`chatMessage ${isAnalysis ? "analysis" : ""}`}>
                        <div className="chatMeta">{turn.role === "assistant" ? (isAnalysis ? "Analyse Arborisis" : "Arborisis") : "Vous"}</div>
                        {!isAnalysis && (
                          <div className="chatBubble">
                            {turn.pending && !turn.content
                              ? <span className="chatTyping">Arborisis reflechit...</span>
                              : <MarkdownText text={turn.content} />}
                          </div>
                        )}
                        {isAnalysis && turn.parsed && (
                          <AgentCards parsed={turn.parsed} timezone={timezone} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="chatComposer">
              <textarea
                className="chatInput"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void askAgent();
                  }
                }}
                placeholder="Ecris a Arborisis..."
                rows={3}
              />
              <div className="chatComposerFooter">
                <span>{webSearch ? "Web actif" : "Web desactive"}</span>
                <button className="primaryButton agentCta" onClick={askAgent} disabled={!plant || chatBusy}>
                  <MessageCircle size={18} />
                  {chatBusy ? "En cours..." : "Envoyer"}
                </button>
              </div>
            </div>

            {answer && (
              <>
                <button
                  className="agentToggle"
                  onClick={() => setShowReasoning((s) => !s)}
                >
                  {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {showReasoning ? "Masquer le detail brut" : "Voir le detail brut de la derniere reponse"}
                </button>
                {showReasoning && <div className="answer reasoning">{answer}</div>}
              </>
            )}
          </section>
        </div>

        <aside className="sideColumn">
          <section className={`panel ${tabHidden(["ia"])}`}>
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
            <div className={tabHidden(["ia"])}>
            <MLIntelligencePanel
              plantId={plant.id}
              weatherLocation={(weatherLocation.trim() || plant.location) ?? undefined}
              timezone={timezone}
            />
            </div>
          )}

          <section className={`panel calendarPanel ${tabHidden(["plus"])}`}>
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
          <button className="secondaryButton calendarAddButton" onClick={saveCalendarEvent} disabled={!plant || calendarBusy}>
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
                  className={`statusCheck ${event.status === "done" ? "checked" : ""}`}
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

          <section className={`panel cyclePanel ${tabHidden(["meteo"])}`}>
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

          <section className={`panel ${tabHidden(["plus"])}`}>
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

          <section className={`panel ${tabHidden(["plus"])}`}>
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

          <section className={`panel ${tabHidden(["plus"])}`}>
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

          <section className={`history panel ${tabHidden(["capteurs"])}`}>
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

      <nav className="bottomNav" aria-label="Navigation principale">
        <button
          type="button"
          className={`navItem ${activeTab === "home" ? "active" : ""}`}
          onClick={() => setActiveTab("home")}
          aria-label="Accueil"
        >
          <Home size={22} strokeWidth={activeTab === "home" ? 2.5 : 1.8} />
          <span>Accueil</span>
        </button>
        <button
          type="button"
          className={`navItem ${activeTab === "capteurs" ? "active" : ""}`}
          onClick={() => setActiveTab("capteurs")}
          aria-label="Capteurs"
        >
          <Activity size={22} strokeWidth={activeTab === "capteurs" ? 2.5 : 1.8} />
          <span>Capteurs</span>
        </button>
        <button
          type="button"
          className={`navItem ${activeTab === "meteo" ? "active" : ""}`}
          onClick={() => setActiveTab("meteo")}
          aria-label="Météo"
        >
          <CloudSun size={22} strokeWidth={activeTab === "meteo" ? 2.5 : 1.8} />
          <span>Météo</span>
        </button>
        <button
          type="button"
          className={`navItem ${activeTab === "ia" ? "active" : ""}`}
          onClick={() => setActiveTab("ia")}
          aria-label="Agent IA"
        >
          <BrainCircuit size={22} strokeWidth={activeTab === "ia" ? 2.5 : 1.8} />
          <span>Agent IA</span>
        </button>
        <button
          type="button"
          className={`navItem ${activeTab === "plus" ? "active" : ""}`}
          onClick={() => setActiveTab("plus")}
          aria-label="Plus"
        >
          <MoreHorizontal size={22} strokeWidth={activeTab === "plus" ? 2.5 : 1.8} />
          <span>Plus</span>
        </button>
      </nav>
    </main>
  );
}

type PlantState = "thriving" | "good" | "watch" | "stressed" | "critical";

function getPlantState(score: number): PlantState {
  if (score >= 85) return "thriving";
  if (score >= 70) return "good";
  if (score >= 50) return "watch";
  if (score >= 30) return "stressed";
  return "critical";
}

function getPlantLevel(score: number) {
  if (score >= 85) return { level: 5, name: "Florissante", emoji: "🌸", xp: score - 85, range: 14 };
  if (score >= 70) return { level: 4, name: "Robuste",     emoji: "🌳", xp: score - 70, range: 15 };
  if (score >= 50) return { level: 3, name: "Plante",      emoji: "🪴", xp: score - 50, range: 20 };
  if (score >= 30) return { level: 2, name: "Pousse",      emoji: "🌿", xp: score - 30, range: 20 };
  return              { level: 1, name: "Graine",      emoji: "🌱", xp: score,      range: 30 };
}

function AnimatedPlant({
  state,
  needsWater,
  goodLight,
  tempAlert
}: {
  state: PlantState;
  needsWater: boolean;
  goodLight: boolean;
  tempAlert: boolean;
}) {
  return (
    <div className="plantPortrait" aria-hidden="true" data-plant-state={state}>
      <svg className="plantSvg" viewBox="0 0 168 190" xmlns="http://www.w3.org/2000/svg">

        {/* Floating sparkle particles — visible when thriving */}
        <g className="plantParticles">
          <circle className="plantParticle" cx="32"  cy="78"  r="3"   />
          <circle className="plantParticle" cx="136" cy="68"  r="2"   />
          <circle className="plantParticle" cx="74"  cy="22"  r="2.5" />
          <circle className="plantParticle" cx="50"  cy="112" r="2"   />
          <circle className="plantParticle" cx="118" cy="100" r="1.5" />
          <circle className="plantParticle" cx="96"  cy="36"  r="1.5" />
        </g>

        {/* Water-drop indicator (low moisture) */}
        {needsWater && (
          <g>
            <path className="waterDrop wd1"
              d="M 148,38 C 148,34 142.5,27.5 142,22 C 141.5,17 144,14 148,14 C 152,14 154.5,17 154,22 C 153.5,27.5 148,34 148,38 Z" />
            <path className="waterDrop wd2"
              d="M 158,57 C 158,53 152.5,46.5 152,41 C 151.5,36 154,33 158,33 C 162,33 164.5,36 164,41 C 163.5,46.5 158,53 158,57 Z" />
            <path className="waterDrop wd3"
              d="M 138,60 C 138,57 134,52 133.5,48 C 133,44 135,42 138,42 C 141,42 143,44 142.5,48 C 142,52 138,57 138,60 Z" />
          </g>
        )}

        {/* Sun indicator (good light during day) */}
        {goodLight && (
          <g>
            <circle className="sunCore" cx="20" cy="22" r="7" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
              const r = Math.PI / 180 * deg;
              return (
                <line key={i} className="sunRay"
                  x1={20 + Math.cos(r) * 10} y1={22 + Math.sin(r) * 10}
                  x2={20 + Math.cos(r) * 14} y2={22 + Math.sin(r) * 14}
                  strokeWidth="1.5" />
              );
            })}
          </g>
        )}

        {/* Temperature alert indicator */}
        {tempAlert && (
          <g>
            <rect className="tempGlass" x="150" y="68" width="8" height="18" rx="4" strokeWidth="1.5" />
            <circle className="tempBulb" cx="154" cy="88" r="5" />
            <rect className="tempMercury" x="152" y="72" width="4" height="12" rx="2" fill="#f97316" />
          </g>
        )}

        {/* Stem */}
        <path className="plantStem"
          d="M 84,148 Q 82,122 84,98 Q 86,78 84,56"
          strokeWidth="4.5" fill="none" strokeLinecap="round" />

        {/* Leaf 5 — small top */}
        <g className="plantLeafGroup lg5">
          <path className="plantLeaf pl5"
            d="M 84,70 C 78,58 66,44 58,40 C 66,54 78,64 84,70 Z" />
          <path className="plantVein" d="M 84,70 C 76,58 66,46 58,40" fill="none" strokeWidth="0.8" />
        </g>

        {/* Leaf 1 — upper left */}
        <g className="plantLeafGroup lg1">
          <path className="plantLeaf pl1"
            d="M 82,92 C 74,72 50,54 26,53 C 50,78 70,86 82,92 Z" />
          <path className="plantVein" d="M 82,92 C 68,76 48,60 26,53" fill="none" strokeWidth="0.9" />
        </g>

        {/* Leaf 2 — upper right */}
        <g className="plantLeafGroup lg2">
          <path className="plantLeaf pl2"
            d="M 86,88 C 94,68 120,54 144,51 C 120,76 100,84 86,88 Z" />
          <path className="plantVein" d="M 86,88 C 96,70 120,56 144,51" fill="none" strokeWidth="0.9" />
        </g>

        {/* Leaf 3 — mid left */}
        <g className="plantLeafGroup lg3">
          <path className="plantLeaf pl3"
            d="M 82,114 C 62,104 38,95 20,100 C 38,112 62,116 82,114 Z" />
          <path className="plantVein" d="M 82,114 C 62,104 38,96 20,100" fill="none" strokeWidth="0.9" />
        </g>

        {/* Leaf 4 — mid right */}
        <g className="plantLeafGroup lg4">
          <path className="plantLeaf pl4"
            d="M 86,118 C 106,107 130,100 150,106 C 130,116 106,120 86,118 Z" />
          <path className="plantVein" d="M 86,118 C 106,108 130,101 150,106" fill="none" strokeWidth="0.9" />
        </g>

        {/* Pot */}
        <path className="plantPotBody" d="M 44,154 L 36,182 L 132,182 L 124,154 Z" />
        <ellipse className="plantPotRim" cx="84" cy="154" rx="40" ry="7" />
        <ellipse className="plantSoil"   cx="84" cy="150" rx="36" ry="5.5" />

        {/* Sensor pod */}
        <rect className="sensorPodRect" x="65" y="125" width="38" height="21" rx="7" />
        <circle className="sensorDotSvg" cx="84" cy="135" r="5" />
      </svg>
    </div>
  );
}

function PlantLevel({ careScore }: { careScore: number }) {
  const lv = getPlantLevel(careScore);
  const xpPct = Math.round(Math.min(100, (lv.xp / lv.range) * 100));
  return (
    <div className="plantLevelBadge">
      <span className="plantLevelEmoji">{lv.emoji}</span>
      <div className="plantLevelInfo">
        <div className="plantLevelHeader">
          <span className="plantLevelName">{lv.name}</span>
          <span className="plantLevelNum">Niv. {lv.level}</span>
        </div>
        <div className="plantXpBar">
          <div className="plantXpFill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const segments = text.split(/(\*\*[^*\n]+\*\*)/g);
  if (segments.length === 1) return text;
  return (
    <>
      {segments.map((seg, i) =>
        seg.startsWith("**") && seg.endsWith("**")
          ? <strong key={i}>{seg.slice(2, -2)}</strong>
          : <span key={i}>{seg}</span>
      )}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={key} style={{ paddingLeft: "1.2em", margin: "0.25em 0" }}>
        {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, idx) => {
    const key = String(idx);
    if (/^##\s/.test(line)) {
      flushList(`ul-${idx}`);
      blocks.push(
        <strong key={key} style={{ display: "block", marginTop: "0.6em", marginBottom: "0.15em", color: "var(--ink)" }}>
          {renderInline(line.replace(/^##\s/, ""))}
        </strong>
      );
    } else if (/^###\s/.test(line)) {
      flushList(`ul-${idx}`);
      blocks.push(
        <em key={key} style={{ display: "block", marginTop: "0.4em", fontStyle: "normal", color: "var(--ink-2)" }}>
          {renderInline(line.replace(/^###\s/, ""))}
        </em>
      );
    } else if (/^[-*]\s/.test(line)) {
      listItems.push(line.slice(2));
    } else if (!line.trim()) {
      flushList(`ul-${idx}`);
    } else {
      flushList(`ul-${idx}`);
      blocks.push(<p key={key} style={{ margin: "0.2em 0" }}>{renderInline(line)}</p>);
    }
  });
  flushList("ul-end");

  return <>{blocks}</>;
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

function AgentCards({ parsed, timezone }: { parsed: ParsedAgentResponse; timezone: string }) {
  return (
    <div className="agentResult">
      <div className={`agentDiagnosis ${parsed.diagnosis.severity}`}>
        <div className="agentDiagnosisHeader">
          <Zap size={16} />
          <strong>Diagnostic: {parsed.diagnosis.severity}</strong>
          <span className="agentScore">{parsed.healthScore.overall}/100</span>
        </div>
        <p>{parsed.diagnosis.summary}</p>
      </div>

      <div className="agentHealthGrid">
        <AgentGauge label="Eau" value={parsed.healthScore.moisture} />
        <AgentGauge label="Temp." value={parsed.healthScore.temperature} />
        <AgentGauge label="Lumiere" value={parsed.healthScore.light} />
        <AgentGauge label="Stabilite" value={parsed.healthScore.stability} />
      </div>

      {parsed.actions.length > 0 && (
        <div className="agentActions">
          <strong>Actions proposees</strong>
          {parsed.actions.map((action, i) => (
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

      {parsed.plan.length > 0 && (
        <div className="agentPlan">
          <strong>Planning</strong>
          {parsed.plan.map((task, i) => (
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

      {(parsed.sources.length > 0 || parsed.tools.length > 0) && (
        <div className="agentEvidence">
          {parsed.sources.length > 0 && (
            <div>
              <strong>Sources</strong>
              <div className="sourceList">
                {parsed.sources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                    <Globe2 size={14} />
                    <span>{source.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {parsed.tools.length > 0 && (
            <div>
              <strong>Outils</strong>
              <div className="toolList">
                {parsed.tools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function sparkTrend(values: Array<number | null | undefined>): string | undefined {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length < 3) return undefined;
  const head = clean.slice(0, Math.ceil(clean.length / 2));
  const tail = clean.slice(Math.floor(clean.length / 2));
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const delta = avg(tail) - avg(head);
  const ref = Math.max(1e-6, Math.abs(avg(head)));
  if (Math.abs(delta) / ref < 0.03) return "— stable";
  return delta > 0 ? "▲ hausse" : "▼ baisse";
}

function MetricSpark({ series }: { series: number[] }) {
  const clean = series.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (clean.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(1e-6, max - min);
  const pts = clean.map((value, index) => {
    const x = (index / (clean.length - 1)) * w;
    const y = h - 2 - ((value - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg className="metricSpark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <polygon points={area} className="metricSparkArea" />
      <polyline points={line} className="metricSparkLine" />
    </svg>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  progress,
  series,
  trend,
  accent = "var(--leaf)"
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
  series?: number[];
  trend?: string;
  accent?: string;
}) {
  const boundedProgress = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
  const hasSpark = Array.isArray(series) && series.length >= 2;

  return (
    <article className="metric" style={{ "--metric-accent": accent } as CSSProperties}>
      <div className="metricTop">
        <div className="metricIcon">{icon}</div>
        {trend && <span className="metricTrend">{trend}</span>}
      </div>
      <strong>{value}</strong>
      <div className="metricMeta">
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </div>
      {hasSpark ? (
        <MetricSpark series={series!} />
      ) : boundedProgress !== null ? (
        <div className="metricBar" aria-hidden="true">
          <span style={{ width: `${boundedProgress}%` }} />
        </div>
      ) : null}
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

function getPhotoBaseTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, "").trim() || "Photo plante";
}

function limitPhotoTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87).trimEnd()}...` : trimmed;
}

function buildPhotoUploadTitle(file: File, index: number, total: number, batchTitle: string) {
  const cleanedBatchTitle = batchTitle.trim();
  if (total === 1) {
    return limitPhotoTitle(cleanedBatchTitle || getPhotoBaseTitle(file));
  }

  return limitPhotoTitle(
    cleanedBatchTitle
      ? `${cleanedBatchTitle} - vue ${index + 1}`
      : `${getPhotoBaseTitle(file)} - vue ${index + 1}`
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
