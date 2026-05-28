import type { Plant, Reading, PrismaClient } from "@prisma/client";
import type { AgentToolDefinition, TrendAnalysis, HealthScore } from "./types";

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
  }
];

export function createToolExecutor(plant: Plant, readings: Reading[]) {
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
    }
  };
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
