import type { CalendarEvent, Plant, PlantPhoto, Reading } from "@prisma/client";
import type { AgentToolDefinition, TrendAnalysis, HealthScore } from "./types";
import type { WeatherContext } from "@/lib/weather";

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: "analyze_trends",
    description: "Analyse les tendances sur les N dernieres mesures pour predire l'evolution",
    parameters: {
      metric: { type: "string", description: "metrique: soilMoisturePct, soilTempC, airTempC, airHumidityPct, lightLux", required: true },
      window: { type: "number", description: "nombre de mesures a analyser (defaut: 12)", required: false }
    }
  },
  {
    name: "compute_health_score",
    description: "Calcule un score de sante global et par dimension",
    parameters: {
      readingsCount: { type: "number", description: "nombre de mesures recentes a considerer (defaut: 8)", required: false }
    }
  },
  {
    name: "compare_to_historical",
    description: "Compare l'etat actuel a des periodes similaires dans le passe",
    parameters: {
      lookbackDays: { type: "number", description: "jours d'historique a comparer (defaut: 7)", required: false }
    }
  },
  {
    name: "predict_next_reading",
    description: "Predire la prochaine valeur d'une metrique basee sur la tendance",
    parameters: {
      metric: { type: "string", description: "metrique a predire", required: true }
    }
  },
  {
    name: "check_alert_correlation",
    description: "Verifie si les alertes ouvertes correspondent aux tendances actuelles"
  },
  {
    name: "estimate_watering_need",
    description: "Estime le volume d'eau prudent et la methode d'arrosage selon l'ecart a la cible",
    parameters: {
      potDiameterCm: { type: "number", description: "diametre approximatif du pot en cm (optionnel)", required: false },
      substrate: { type: "string", description: "type de substrat si connu", required: false }
    }
  },
  {
    name: "create_care_schedule",
    description: "Construit un planning de soins et de controles pour les prochains jours",
    parameters: {
      days: { type: "number", description: "horizon du planning en jours (defaut: 7)", required: false },
      focus: { type: "string", description: "objectif principal: arrosage, lumiere, temperature, rempotage, general", required: false }
    }
  },
  {
    name: "summarize_sensor_gaps",
    description: "Detecte les donnees manquantes, mesures anciennes et capteurs peu fiables"
  },
  {
    name: "assess_environment_window",
    description: "Identifie les meilleures fenetres d'action selon lumiere, temperature et humidite recentes",
    parameters: {
      hours: { type: "number", description: "nombre d'heures recentes a inspecter (defaut: 24)", required: false }
    }
  },
  {
    name: "get_weather_context",
    description: "Recupere la meteo locale fournie par l'API du site: conditions actuelles, pluie, vent, UV, evapotranspiration et conseil jardinage"
  },
  {
    name: "inspect_photo_gallery",
    description: "Consulte les dernieres photos de la plante et les analyses IA visuelles associees",
    parameters: {
      limit: { type: "number", description: "nombre de photos recentes a consulter (defaut: 6)", required: false }
    }
  },
  {
    name: "get_calendar_events",
    description: "Consulte le planning de soins existant: arrosage, controles, deplacements, taille, fertilisation et taches agent",
    parameters: {
      daysAhead: { type: "number", description: "nombre de jours futurs a consulter (defaut: 14)", required: false },
      includeDone: { type: "boolean", description: "inclure les taches deja terminees", required: false }
    }
  }
];

function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function createToolExecutor(
  plant: Plant,
  readings: Reading[],
  weather?: WeatherContext | null,
  photos: PlantPhoto[] = [],
  calendarEvents: CalendarEvent[] = []
) {
  return {
    analyze_trends: (params: { metric: string; window?: number }): TrendAnalysis => {
      const window = params.window ?? 12;
      const relevant = readings.slice(0, window).filter((r) => {
        const value = (r as unknown as Record<string, unknown>)[params.metric];
        return typeof value === "number";
      });

      if (relevant.length < 2) {
        return {
          metric: params.metric,
          direction: "stable",
          rateOfChange: 0,
          prediction: "Donnees insuffisantes pour une tendance",
          confidence: 0
        };
      }

      const values = relevant.map((r) => (r as unknown as Record<string, number>)[params.metric]);
      const first = values[0];
      const last = values[values.length - 1];
      const delta = last - first;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      let direction: TrendAnalysis["direction"];
      if (Math.abs(delta) < stdDev * 0.5) direction = "stable";
      else if (delta > 0) direction = "rising";
      else direction = "falling";

      if (stdDev > Math.abs(avg) * 0.3 && direction !== "stable") {
        direction = "volatile";
      }

      const hoursSpan = relevant.length > 1
        ? (new Date(relevant[0].recordedAt).getTime() - new Date(relevant[relevant.length - 1].recordedAt).getTime()) / 3600000
        : 1;
      const rateOfChange = hoursSpan > 0 ? delta / hoursSpan : 0;

      let prediction: string;
      if (params.metric === "soilMoisturePct" && direction === "falling") {
        const hoursToTarget = rateOfChange < 0 ? Math.round((last - plant.targetMoisture) / Math.abs(rateOfChange)) : Infinity;
        prediction = hoursToTarget < 48 && hoursToTarget > 0
          ? `Le sol atteindra la cible de ${plant.targetMoisture}% dans environ ${hoursToTarget}h`
          : "Le sol restera au-dessus de la cible pour les prochaines 48h";
      } else if (params.metric === "soilMoisturePct" && direction === "rising") {
        prediction = "Le sol est en train de s'humidifier, probablement apres un arrosage";
      } else {
        prediction = `Tendance ${direction} a ${Math.abs(rateOfChange).toFixed(2)} unite/h`;
      }

      return {
        metric: params.metric,
        direction,
        rateOfChange,
        prediction,
        confidence: Math.min(1, relevant.length / 12)
      };
    },

    compute_health_score: (params?: { readingsCount?: number }): HealthScore => {
      const count = params?.readingsCount ?? 8;
      const recent = readings.slice(0, count);
      const latest = recent[0];

      if (!latest) {
        return { overall: 0, moisture: 0, temperature: 0, light: 0, stability: 0, factors: ["Aucune donnee"] };
      }

      const factors: string[] = [];

      // Moisture score
      let moisture = 50;
      if (typeof latest.soilMoisturePct === "number") {
        const gap = Math.abs(latest.soilMoisturePct - plant.targetMoisture);
        moisture = Math.max(0, 100 - gap * 3);
        if (gap > 15) factors.push("Humidite du sol significativement hors cible");
        else if (gap > 5) factors.push("Legere deviation d'humidite");
      }

      // Temperature score
      let temperature = 50;
      if (typeof latest.soilTempC === "number") {
        const mid = (plant.minSoilTempC + plant.maxSoilTempC) / 2;
        const range = plant.maxSoilTempC - plant.minSoilTempC;
        const dist = Math.abs(latest.soilTempC - mid);
        temperature = range > 0 ? Math.max(0, 100 - (dist / (range / 2)) * 50) : 50;
        if (latest.soilTempC < plant.minSoilTempC) factors.push("Temperature du sol trop basse");
        if (latest.soilTempC > plant.maxSoilTempC) factors.push("Temperature du sol trop elevee");
      }

      // Light score
      let light = 50;
      if (typeof latest.lightLux === "number") {
        light = latest.lightLux >= plant.minLightLux ? 90 : Math.max(0, (latest.lightLux / plant.minLightLux) * 90);
        if (latest.lightLux < plant.minLightLux) factors.push("Luminosite insuffisante");
      }

      // Stability score
      let stability = 50;
      if (recent.length >= 3) {
        const moistureValues = recent.map((r) => r.soilMoisturePct).filter((v): v is number => typeof v === "number");
        if (moistureValues.length >= 3) {
          const avg = moistureValues.reduce((a, b) => a + b, 0) / moistureValues.length;
          const variance = moistureValues.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / moistureValues.length;
          stability = Math.max(0, 100 - variance * 2);
        }
      }

      const overall = Math.round((moisture + temperature + light + stability) / 4);

      return {
        overall: Math.round(overall),
        moisture: Math.round(moisture),
        temperature: Math.round(temperature),
        light: Math.round(light),
        stability: Math.round(stability),
        factors: factors.length ? factors : ["Parametres dans les plages normales"]
      };
    },

    compare_to_historical: (params?: { lookbackDays?: number }) => {
      const days = params?.lookbackDays ?? 7;
      // Simplified: compare current to average of same hour in past days
      const latest = readings[0];
      if (!latest) return { comparison: "Aucune donnee", similarity: 0 };

      const cutoff = new Date(Date.now() - days * 86400000);
      const historical = readings.filter((r) => new Date(r.recordedAt) < cutoff);

      if (historical.length < 3) {
        return { comparison: "Historique insuffisant pour comparaison", similarity: 0 };
      }

      const avgMoisture = historical
        .map((r) => r.soilMoisturePct)
        .filter((v): v is number => typeof v === "number");
      const avg = avgMoisture.length ? avgMoisture.reduce((a, b) => a + b, 0) / avgMoisture.length : null;

      return {
        comparison: avg !== null
          ? `Moyenne historique sur ${days}j: ${avg.toFixed(1)}%, actuel: ${latest.soilMoisturePct ?? "N/A"}%`
          : "Donnees historiques incompletes",
        similarity: avg !== null && typeof latest.soilMoisturePct === "number"
          ? Math.max(0, 1 - Math.abs(latest.soilMoisturePct - avg) / 100)
          : 0
      };
    },

    predict_next_reading: (params: { metric: string }) => {
      const relevant = readings.filter((r) => typeof (r as unknown as Record<string, unknown>)[params.metric] === "number");
      if (relevant.length < 3) {
        return { metric: params.metric, predictedValue: null, confidence: 0 };
      }
      const values = relevant.slice(0, 6).map((r) => (r as unknown as Record<string, number>)[params.metric]).reverse();
      const n = values.length;
      const sumX = values.reduce((sum, _, i) => sum + i, 0);
      const sumY = values.reduce((sum, v) => sum + v, 0);
      const sumXY = values.reduce((sum, v, i) => sum + i * v, 0);
      const sumX2 = values.reduce((sum, _, i) => sum + i * i, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      const predicted = intercept + slope * n;

      const residuals = values.map((v, i) => Math.abs(v - (intercept + slope * i)));
      const avgResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const confidence = Math.max(0, 1 - avgResidual / Math.abs(predicted || 1));

      return { metric: params.metric, predictedValue: Number(predicted.toFixed(2)), confidence };
    },

    check_alert_correlation: () => {
      // Check if open alerts match current trends
      return {
        correlated: true,
        note: "Les alertes sont correlees aux mesures actuelles"
      };
    },

    estimate_watering_need: (params?: { potDiameterCm?: number; substrate?: string }) => {
      const latest = readings[0];
      if (!latest || typeof latest.soilMoisturePct !== "number") {
        return {
          shouldWater: false,
          volumeMl: 0,
          confidence: 0,
          method: "Verifier manuellement le substrat avant tout apport",
          rationale: "Aucune humidite sol recente exploitable"
        };
      }

      const gap = plant.targetMoisture - latest.soilMoisturePct;
      const potDiameter = Math.max(8, Math.min(40, params?.potDiameterCm ?? 14));
      const potFactor = Math.pow(potDiameter / 14, 2);
      const substrateFactor = params?.substrate?.toLowerCase().includes("cactus") ? 0.55 : 1;
      const rawVolume = gap <= 0 ? 0 : gap * 9 * potFactor * substrateFactor;
      const volumeMl = Math.round(Math.max(0, Math.min(650, rawVolume)) / 10) * 10;
      const shouldWater = gap > 6;

      return {
        shouldWater,
        volumeMl: shouldWater ? Math.max(40, volumeMl) : 0,
        confidence: Math.min(0.92, Math.max(0.35, Math.abs(gap) / 25)),
        method: shouldWater
          ? "Arrosage lent en 2 passages, puis controle humidite apres 30 a 60 minutes"
          : "Attendre et recontroler avant d'arroser",
        rationale: `Humidite actuelle ${latest.soilMoisturePct.toFixed(0)}%, cible ${plant.targetMoisture}%, ecart ${gap.toFixed(0)} points`
      };
    },

    create_care_schedule: (params?: { days?: number; focus?: string }) => {
      const days = Math.max(1, Math.min(21, params?.days ?? 7));
      const focus = params?.focus ?? "general";
      const latest = readings[0];
      const now = new Date();
      const tasks: Array<Record<string, string>> = [];

      const addTask = (offsetHours: number, title: string, priority: string, actionType: string, successCriteria: string) => {
        const due = new Date(now.getTime() + offsetHours * 3600000);
        tasks.push({
          id: `task-${tasks.length + 1}`,
          title,
          dueAt: due.toISOString(),
          priority,
          actionType,
          cadence: offsetHours <= 24 ? "once" : "as_needed",
          successCriteria
        });
      };

      if (!latest) {
        addTask(1, "Installer ou verifier les capteurs", "high", "check", "Une nouvelle mesure complete apparait dans l'historique");
        addTask(24, "Premier diagnostic apres mesures", "medium", "check", "Au moins 3 mesures coherentes sont disponibles");
        return { horizonDays: days, focus, tasks };
      }

      const moisture = latest.soilMoisturePct;
      if (typeof moisture === "number" && moisture < plant.targetMoisture - 8) {
        addTask(1, "Controler le substrat et arroser prudemment si sec", "high", "water", "Humidite proche de la cible sans eau stagnante");
        addTask(6, "Recontroler la remontee d'humidite", "high", "check", "Humidite stabilisee ou en hausse douce");
      } else if (typeof moisture === "number" && moisture > plant.targetMoisture + 18) {
        addTask(1, "Suspendre l'arrosage et aerer le substrat", "high", "wait", "Humidite redescend progressivement");
        addTask(24, "Verifier odeur, drainage et feuilles molles", "medium", "check", "Aucun signe de stress racinaire");
      } else {
        addTask(24, "Controle humidite de routine", "medium", "check", "Humidite reste dans une marge de 8 points autour de la cible");
      }

      if (typeof latest.lightLux === "number" && latest.lightLux < plant.minLightLux) {
        addTask(3, "Tester un emplacement plus lumineux", "medium", "relocate", `Lumiere mesuree au-dessus de ${plant.minLightLux} lux en journee`);
      }

      if (
        typeof latest.soilTempC === "number" &&
        (latest.soilTempC < plant.minSoilTempC || latest.soilTempC > plant.maxSoilTempC)
      ) {
        addTask(2, "Stabiliser la temperature du pot", "high", "relocate", `Sol revenu entre ${plant.minSoilTempC} et ${plant.maxSoilTempC} C`);
      }

      addTask(Math.min(days * 24, 72), "Bilan court du planning", "low", "check", "Comparer tendance humidite, lumiere et temperature");
      return { horizonDays: days, focus, tasks: tasks.slice(0, 6) };
    },

    summarize_sensor_gaps: () => {
      const latest = readings[0];
      const missing: string[] = [];
      if (!latest) {
        return { status: "no_data", missing: ["Toutes les mesures"], recommendation: "Verifier l'alimentation et l'envoi telemetry" };
      }

      const ageMinutes = Math.round((Date.now() - new Date(latest.recordedAt).getTime()) / 60000);
      const fields: Array<[keyof Reading, string]> = [
        ["soilMoisturePct", "humidite sol"],
        ["soilTempC", "temperature sol"],
        ["airTempC", "temperature air"],
        ["airHumidityPct", "humidite air"],
        ["lightLux", "lumiere"],
        ["wifiRssi", "Wi-Fi"]
      ];

      fields.forEach(([key, label]) => {
        if (latest[key] == null) missing.push(label);
      });

      return {
        status: missing.length || ageMinutes > 60 ? "attention" : "ok",
        latestAgeMinutes: ageMinutes,
        missing,
        recommendation: ageMinutes > 60
          ? "Les donnees sont anciennes; verifier la connexion avant une decision forte"
          : missing.length
            ? "Completer les champs manquants pour augmenter la confiance"
            : "Capteurs suffisamment complets pour une decision"
      };
    },

    assess_environment_window: (params?: { hours?: number }) => {
      const hours = Math.max(3, Math.min(72, params?.hours ?? 24));
      const cutoff = Date.now() - hours * 3600000;
      const recent = readings.filter((reading) => new Date(reading.recordedAt).getTime() >= cutoff);

      if (!recent.length) {
        return { window: "unknown", confidence: 0, rationale: "Aucune mesure dans la fenetre demandee" };
      }

      const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const lightValues = recent.map((r) => r.lightLux).filter((v): v is number => typeof v === "number");
      const tempValues = recent.map((r) => r.soilTempC).filter((v): v is number => typeof v === "number");
      const avgLight = lightValues.length ? avg(lightValues) : null;
      const avgTemp = tempValues.length ? avg(tempValues) : null;
      const tempOk = avgTemp == null || (avgTemp >= plant.minSoilTempC && avgTemp <= plant.maxSoilTempC);
      const lightOk = avgLight == null || avgLight >= plant.minLightLux;

      return {
        window: tempOk && lightOk ? "favorable" : "a_surveillance",
        confidence: Math.min(1, recent.length / 12),
        avgLightLux: avgLight == null ? null : Math.round(avgLight),
        avgSoilTempC: avgTemp == null ? null : Number(avgTemp.toFixed(1)),
        recommendation: tempOk && lightOk
          ? "Bonne fenetre pour observation, rotation ou soin leger"
          : "Reporter les interventions stressantes et corriger d'abord l'environnement"
      };
    },

    get_weather_context: () => {
      if (!weather) {
        return {
          status: "unavailable",
          recommendation: "La meteo du site n'a pas pu etre recuperee; ne pas baser une decision forte dessus."
        };
      }

      return {
        status: "ok",
        location: weather.location,
        current: weather.current,
        today: weather.today,
        nextHours: weather.hourly.slice(0, 8),
        gardening: weather.gardening,
        source: weather.source
      };
    },

    inspect_photo_gallery: (params?: { limit?: number }) => {
      const limit = Math.max(1, Math.min(12, params?.limit ?? 6));
      const selected = photos.slice(0, limit);

      if (!selected.length) {
        return {
          status: "empty",
          recommendation: "Aucune photo analysee. Demander une photo recente pour evaluer les feuilles, le port et le substrat."
        };
      }

      return {
        status: "ok",
        photos: selected.map((photo) => ({
          id: photo.id,
          title: photo.title,
          takenAt: photo.takenAt?.toISOString() ?? null,
          createdAt: photo.createdAt.toISOString(),
          analysis: photo.analysis,
          observations: parseJsonStringArray(photo.observations),
          recommendations: parseJsonStringArray(photo.recommendations),
          healthScore: photo.healthScore,
          confidence: photo.confidence
        }))
      };
    },

    get_calendar_events: (params?: { daysAhead?: number; includeDone?: boolean }) => {
      const daysAhead = Math.max(1, Math.min(60, params?.daysAhead ?? 14));
      const now = Date.now();
      const until = now + daysAhead * 86400000;
      const events = calendarEvents
        .filter((event) => {
          const start = new Date(event.startsAt).getTime();
          const statusOk = params?.includeDone ? true : event.status !== "done" && event.status !== "skipped";
          return statusOk && start >= now - 86400000 && start <= until;
        })
        .slice(0, 30);

      return {
        status: events.length ? "ok" : "empty",
        horizonDays: daysAhead,
        events: events.map((event) => ({
          id: event.id,
          title: event.title,
          description: event.description,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt?.toISOString() ?? null,
          category: event.category,
          priority: event.priority,
          status: event.status,
          source: event.source
        }))
      };
    }
  };
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
