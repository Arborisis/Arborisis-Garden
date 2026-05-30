type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
    timezone?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    weather_code?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
    shortwave_radiation?: number[];
    et0_fao_evapotranspiration?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    uv_index_max?: number[];
    sunrise?: string[];
    sunset?: string[];
    et0_fao_evapotranspiration_sum?: number[];
  };
};

export type WeatherContext = {
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
    weatherCode: number | null;
    description: string;
    cloudCoverPct: number | null;
    windSpeedKmh: number | null;
    windGustKmh: number | null;
    isDay: boolean;
  };
  today: {
    date: string | null;
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
    humidityPct: number | null;
    precipitationProbabilityPct: number | null;
    precipitationMm: number | null;
    weatherCode: number | null;
    description: string;
    windSpeedKmh: number | null;
    solarRadiationWm2: number | null;
    evapotranspirationMm: number | null;
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
    forecastUrl: string;
    geocodingUrl: string | null;
    fetchedAt: string;
  };
};

type WeatherRequest = {
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
};

const DEFAULT_LOCATION = "Brussels";

function readDefaultLocation() {
  return process.env.WEATHER_DEFAULT_LOCATION?.trim() || DEFAULT_LOCATION;
}

function isFiniteCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildLocationLabel(location: NonNullable<OpenMeteoGeocodingResponse["results"]>[number]) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}

async function geocodeLocation(locationName: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", locationName);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "fr");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) {
    throw new Error(`Geocoding meteo indisponible (${response.status})`);
  }

  const json = (await response.json()) as OpenMeteoGeocodingResponse;
  const result = json.results?.[0];
  if (!result) {
    throw new Error(`Lieu meteo introuvable: ${locationName}`);
  }

  return {
    name: result.name,
    label: buildLocationLabel(result),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone ?? "auto",
    geocodingUrl: url.toString()
  };
}

async function resolveLocation(request: WeatherRequest) {
  if (isFiniteCoordinate(request.latitude) && isFiniteCoordinate(request.longitude)) {
    return {
      name: request.location?.trim() || "Position personnalisee",
      label: request.location?.trim() || `${request.latitude!.toFixed(3)}, ${request.longitude!.toFixed(3)}`,
      latitude: request.latitude!,
      longitude: request.longitude!,
      timezone: request.timezone?.trim() || "auto",
      geocodingUrl: null
    };
  }

  return geocodeLocation(request.location?.trim() || readDefaultLocation());
}

function weatherDescription(code?: number | null) {
  if (code == null) return "Meteo inconnue";
  if (code === 0) return "Ciel clair";
  if ([1, 2].includes(code)) return "Partiellement nuageux";
  if (code === 3) return "Couvert";
  if ([45, 48].includes(code)) return "Brouillard";
  if ([51, 53, 55, 56, 57].includes(code)) return "Bruine";
  if ([61, 63, 65, 66, 67].includes(code)) return "Pluie";
  if ([71, 73, 75, 77].includes(code)) return "Neige";
  if ([80, 81, 82].includes(code)) return "Averses";
  if ([85, 86].includes(code)) return "Averses de neige";
  if ([95, 96, 99].includes(code)) return "Orage";
  return "Meteo variable";
}

function at<T>(values: T[] | undefined, index: number): T | null {
  return values?.[index] ?? null;
}

function buildGardeningAdvice(weather: WeatherContext) {
  const rainToday = weather.today.precipitationSumMm ?? 0;
  const rainChance = weather.today.precipitationProbabilityMaxPct ?? 0;
  const wind = weather.current.windSpeedKmh ?? 0;
  const uv = weather.today.uvIndexMax ?? 0;
  const evapotranspiration = weather.today.evapotranspirationMm ?? 0;
  const hot = (weather.today.temperatureMaxC ?? weather.current.temperatureC ?? 0) >= 28;

  const wateringWindow: WeatherContext["gardening"]["wateringWindow"] =
    rainToday >= 4 || rainChance >= 70 ? "avoid" : hot || wind >= 30 || evapotranspiration >= 4 ? "careful" : "good";

  const wateringAdvice =
    wateringWindow === "avoid"
      ? "Pluie probable: eviter l'arrosage exterieur et verifier seulement les pots abrites."
      : wateringWindow === "careful"
        ? "Arroser tot ou tard, par petites quantites, car chaleur, vent ou evaporation augmentent le stress."
        : "Fenetre correcte pour un arrosage doux si le capteur confirme un substrat sec.";

  const lightAdvice =
    uv >= 6
      ? "UV fort: proteger les feuilles sensibles du soleil direct de mi-jour."
      : weather.current.cloudCoverPct != null && weather.current.cloudCoverPct > 75
        ? "Ciel couvert: placer les plantes gourmandes en lumiere pres d'une fenetre claire."
        : "Lumiere naturelle exploitable pour les plantes proches d'une ouverture.";

  const windAdvice =
    wind >= 35
      ? "Vent fort: rentrer ou stabiliser les pots legers."
      : wind >= 20
        ? "Vent sensible: surveiller le dessechement des petits pots."
        : "Vent calme a modere, peu de risque mecanique.";

  const summary = `${weather.current.description}, ${formatMaybe(weather.current.temperatureC, "C")}, pluie ${formatMaybe(rainToday, "mm")} aujourd'hui. ${wateringAdvice}`;

  return { wateringWindow, wateringAdvice, lightAdvice, windAdvice, summary };
}

function formatMaybe(value: number | null, unit: string) {
  if (typeof value !== "number") return "--";
  const formatted = `${Math.round(value * 10) / 10}`;
  return unit ? `${formatted} ${unit}` : formatted;
}

export async function getWeatherContext(request: WeatherRequest = {}): Promise<WeatherContext> {
  const location = await resolveLocation(request);
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(location.latitude));
  forecastUrl.searchParams.set("longitude", String(location.longitude));
  forecastUrl.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_gusts_10m"
    ].join(",")
  );
  forecastUrl.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "shortwave_radiation",
      "et0_fao_evapotranspiration"
    ].join(",")
  );
  forecastUrl.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "uv_index_max",
      "sunrise",
      "sunset",
      "et0_fao_evapotranspiration_sum"
    ].join(",")
  );
  forecastUrl.searchParams.set("forecast_days", "3");
  forecastUrl.searchParams.set("timezone", request.timezone?.trim() || location.timezone || "auto");

  const response = await fetch(forecastUrl, { next: { revalidate: 900 } });
  if (!response.ok) {
    throw new Error(`API meteo indisponible (${response.status})`);
  }

  const forecast = (await response.json()) as OpenMeteoForecastResponse;
  const now = Date.now();
  const hourlyTimes = forecast.hourly?.time ?? [];
  const firstFutureIndex = hourlyTimes.findIndex((time) => new Date(time).getTime() >= now - 30 * 60000);
  const start = Math.max(0, firstFutureIndex);

  const weather: WeatherContext = {
    location: {
      name: location.name,
      label: location.label,
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      timezone: forecast.timezone ?? location.timezone ?? "auto"
    },
    current: {
      time: forecast.current?.time ?? new Date().toISOString(),
      temperatureC: forecast.current?.temperature_2m ?? null,
      apparentTemperatureC: forecast.current?.apparent_temperature ?? null,
      humidityPct: forecast.current?.relative_humidity_2m ?? null,
      precipitationMm: forecast.current?.precipitation ?? null,
      weatherCode: forecast.current?.weather_code ?? null,
      description: weatherDescription(forecast.current?.weather_code),
      cloudCoverPct: forecast.current?.cloud_cover ?? null,
      windSpeedKmh: forecast.current?.wind_speed_10m ?? null,
      windGustKmh: forecast.current?.wind_gusts_10m ?? null,
      isDay: forecast.current?.is_day === 1
    },
    today: {
      date: at(forecast.daily?.time, 0),
      temperatureMinC: at(forecast.daily?.temperature_2m_min, 0),
      temperatureMaxC: at(forecast.daily?.temperature_2m_max, 0),
      precipitationSumMm: at(forecast.daily?.precipitation_sum, 0),
      precipitationProbabilityMaxPct: at(forecast.daily?.precipitation_probability_max, 0),
      uvIndexMax: at(forecast.daily?.uv_index_max, 0),
      sunrise: at(forecast.daily?.sunrise, 0),
      sunset: at(forecast.daily?.sunset, 0),
      evapotranspirationMm: at(forecast.daily?.et0_fao_evapotranspiration_sum, 0),
      description: weatherDescription(at(forecast.daily?.weather_code, 0))
    },
    hourly: hourlyTimes.slice(start, start + 12).map((time, offset) => {
      const index = start + offset;
      const weatherCode = at(forecast.hourly?.weather_code, index);
      return {
        time,
        temperatureC: at(forecast.hourly?.temperature_2m, index),
        humidityPct: at(forecast.hourly?.relative_humidity_2m, index),
        precipitationProbabilityPct: at(forecast.hourly?.precipitation_probability, index),
        precipitationMm: at(forecast.hourly?.precipitation, index),
        weatherCode,
        description: weatherDescription(weatherCode),
        windSpeedKmh: at(forecast.hourly?.wind_speed_10m, index),
        solarRadiationWm2: at(forecast.hourly?.shortwave_radiation, index),
        evapotranspirationMm: at(forecast.hourly?.et0_fao_evapotranspiration, index)
      };
    }),
    gardening: {
      wateringWindow: "good",
      wateringAdvice: "",
      lightAdvice: "",
      windAdvice: "",
      summary: ""
    },
    source: {
      provider: "Open-Meteo",
      forecastUrl: forecastUrl.toString(),
      geocodingUrl: location.geocodingUrl,
      fetchedAt: new Date().toISOString()
    }
  };

  weather.gardening = buildGardeningAdvice(weather);
  return weather;
}

export function summarizeWeatherForAgent(weather: WeatherContext) {
  return [
    `Lieu meteo: ${weather.location.label} (${weather.location.latitude.toFixed(3)}, ${weather.location.longitude.toFixed(3)})`,
    `Actuel: ${weather.current.description}, temperature ${formatMaybe(weather.current.temperatureC, "C")}, ressentie ${formatMaybe(weather.current.apparentTemperatureC, "C")}, humidite ${formatMaybe(weather.current.humidityPct, "%")}, vent ${formatMaybe(weather.current.windSpeedKmh, "km/h")}.`,
    `Aujourd'hui: min ${formatMaybe(weather.today.temperatureMinC, "C")}, max ${formatMaybe(weather.today.temperatureMaxC, "C")}, pluie ${formatMaybe(weather.today.precipitationSumMm, "mm")}, risque pluie ${formatMaybe(weather.today.precipitationProbabilityMaxPct, "%")}, UV ${formatMaybe(weather.today.uvIndexMax, "")}, ET0 ${formatMaybe(weather.today.evapotranspirationMm, "mm")}.`,
    `Conseil jardinage: ${weather.gardening.summary}`,
    `Source: ${weather.source.provider}, fetchedAt=${weather.source.fetchedAt}`
  ].join("\n");
}
