"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bluetooth,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Clock,
  Droplets,
  Leaf,
  Lightbulb,
  MessageCircle,
  Moon,
  RefreshCw,
  Save,
  Sun,
  Thermometer,
  Wifi,
  Zap
} from "lucide-react";

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

type Plant = {
  id: string;
  name: string;
  species: string | null;
  location: string | null;
  notes: string | null;
  targetMoisture: number;
  minLightLux: number;
  minSoilTempC: number;
  maxSoilTempC: number;
  memorySummary: string;
  readings: Reading[];
  alerts: Alert[];
};

type Insight = {
  title: string;
  body: string;
  tone: "good" | "watch" | "urgent";
};

type AgentAction = {
  type: string;
  description: string;
  urgency: string;
  rationale: string;
};

type ParsedAgentResponse = {
  diagnosis: { severity: string; summary: string };
  healthScore: { overall: number };
  actions: AgentAction[];
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

export function GardenApp() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [parsedAgent, setParsedAgent] = useState<ParsedAgentResponse | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [bleStatus, setBleStatus] = useState("Non connecte");
  const [form, setForm] = useState(emptyPlant);
  const [timezone, setTimezone] = useState("UTC");

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
  const insights = useMemo(() => buildInsights(plant, chartReadings, dayCycle), [plant, chartReadings, dayCycle]);

  useEffect(() => {
    const saved = window.localStorage.getItem("arborisis-timezone");
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(saved || detected || "UTC");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("arborisis-timezone", timezone);
  }, [timezone]);

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

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, []);

  async function savePlant() {
    const response = await fetch("/api/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (response.ok) await refresh();
  }

  function parseAgentResponse(text: string): ParsedAgentResponse {
    const severityMatch = text.match(/## Diagnostic:\s*(\w+)/);
    const summaryMatch = text.match(/## Diagnostic:[^\n]*\n([^\n#]+)/);
    const scoreMatch = text.match(/## Score de sante:\s*(\d+)/);
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

    return {
      diagnosis: {
        severity: severityMatch?.[1]?.toLowerCase() ?? "unknown",
        summary: summaryMatch?.[1]?.trim() ?? "Diagnostic non disponible"
      },
      healthScore: { overall: Number(scoreMatch?.[1] ?? 50) },
      actions,
      responseToUser: userResponseMatch?.[1]?.trim() ?? text
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
      body: JSON.stringify({ plantId: plant.id, message })
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      const text = await response.text();
      setAnswer(text);
      setParsedAgent(parseAgentResponse(text));
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
    setChatBusy(false);
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

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Arborisis Garden</p>
          <h1>{plant?.name ?? "Compagnon plante"}</h1>
        </div>
        <button className="iconButton" onClick={refresh} aria-label="Rafraichir">
          <RefreshCw size={20} />
        </button>
      </section>

      <section className="statusBand">
        <div>
          <span className={`statusDot ${health.toLowerCase().replace(" ", "-")}`} />
          <p>{loading ? "Chargement" : health}</p>
        </div>
        <span>{latest ? formatTime(latest.recordedAt, timezone) : "Aucune mesure"}</span>
      </section>

      <section className="metricGrid">
        <Metric icon={<Leaf />} label="Humidite sol" value={formatPct(latest?.soilMoisturePct)} />
        <Metric icon={<Thermometer />} label="Temp. sol" value={formatTemp(latest?.soilTempC)} />
        <Metric icon={<Activity />} label="Air" value={formatTemp(latest?.airTempC)} detail={formatPct(latest?.airHumidityPct)} />
        <Metric icon={<Lightbulb />} label="Lumiere" value={formatLux(latest?.lightLux)} />
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

      <section className="panel">
        <div className="panelHeader">
          <h2>Insights IA</h2>
          <BrainCircuit size={18} />
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

      <section className="panel agentPanel">
        <div className="panelHeader">
          <h2>Agent IA Autonome</h2>
          <BrainCircuit size={18} />
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Demande quoi faire maintenant pour cette plante..."
          rows={3}
        />
        <button className="primaryButton" onClick={askAgent} disabled={!plant || chatBusy}>
          {chatBusy ? "Raisonnement en cours..." : "Demander conseil"}
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

            {parsedAgent.actions.length > 0 && (
              <div className="agentActions">
                <strong>Actions proposees:</strong>
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

      <section className="panel">
        <div className="panelHeader">
          <h2>Connexion produit</h2>
          <Wifi size={18} />
        </div>
        <p className="muted">
          Sur iPhone, garde le Pico en Wi-Fi. Sur Chrome Android/Mac, BLE peut servir au diagnostic local.
        </p>
        <button className="secondaryButton" onClick={connectBle}>
          <Bluetooth size={17} />
          Connecter BLE
        </button>
        <p className="small">{bleStatus}</p>
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
          <button className="iconButton smallIcon" onClick={savePlant} aria-label="Sauvegarder">
            <Save size={18} />
          </button>
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
      </section>

      <section className="history">
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
    </main>
  );
}

function Metric({
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
    <article className="metric">
      <div className="metricIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
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

  return (
    <article className="chartCard">
      <div className="chartTitle">
        <span>{label}</span>
        <strong>{typeof latestValue === "number" ? `${Math.round(latestValue)} ${unit}` : "--"}</strong>
      </div>
      {points ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Graphique ${label}`} preserveAspectRatio="none">
          <line x1="0" y1={height - 1} x2={width} y2={height - 1} />
          <polyline points={points} style={{ stroke: color }} />
        </svg>
      ) : (
        <div className="chartEmpty">Pas encore assez de donnees</div>
      )}
    </article>
  );
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

function formatTime(value: string, timezone: string) {
  return new Date(value).toLocaleTimeString("fr-BE", {
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
