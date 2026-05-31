import { readFileSync } from "node:fs"

// Jeu de classes PlantVillage (38 classes), ordre alphabetique canonique utilise
// par la quasi-totalite des modeles publics (Kaggle "New Plant Diseases Dataset",
// modeles HuggingFace MobileNet/ResNet PlantVillage). L'ordre DOIT correspondre a
// l'index de sortie du modele ONNX. Surcharge possible via PLANT_DISEASE_LABELS
// (JSON: tableau de cles brutes) ou PLANT_DISEASE_LABELS_PATH (fichier JSON).

export type DiseaseLabel = {
  /** Cle brute telle qu'exposee par le dataset/modele. */
  raw: string
  /** Espece en francais. */
  plant: string
  /** Etat / pathologie en francais. */
  condition: string
  /** true = feuillage sain. */
  healthy: boolean
}

const PLANT_FR: Record<string, string> = {
  Apple: "Pommier",
  Blueberry: "Myrtille",
  "Cherry_(including_sour)": "Cerisier",
  "Corn_(maize)": "Mais",
  Grape: "Vigne",
  Orange: "Oranger",
  Peach: "Pecher",
  "Pepper,_bell": "Poivron",
  Potato: "Pomme de terre",
  Raspberry: "Framboisier",
  Soybean: "Soja",
  Squash: "Courge",
  Strawberry: "Fraisier",
  Tomato: "Tomate"
}

const CONDITION_FR: Record<string, string> = {
  Apple_scab: "Tavelure",
  Black_rot: "Pourriture noire",
  Cedar_apple_rust: "Rouille grillagee",
  healthy: "Sain",
  Powdery_mildew: "Oidium",
  "Cercospora_leaf_spot Gray_leaf_spot": "Cercosporiose / tache grise",
  Common_rust_: "Rouille commune",
  Northern_Leaf_Blight: "Helminthosporiose (brulure du Nord)",
  "Esca_(Black_Measles)": "Esca (black measles)",
  "Leaf_blight_(Isariopsis_Leaf_Spot)": "Brulure foliaire (Isariopsis)",
  "Haunglongbing_(Citrus_greening)": "Huanglongbing (greening des agrumes)",
  Bacterial_spot: "Tache bacterienne",
  Early_blight: "Alternariose (brulure precoce)",
  Late_blight: "Mildiou (brulure tardive)",
  Leaf_Mold: "Cladosporiose (moisissure foliaire)",
  Septoria_leaf_spot: "Septoriose",
  "Spider_mites Two-spotted_spider_mite": "Acariens (tetranyque tisserand)",
  Target_Spot: "Tache cible (corynesporiose)",
  Tomato_Yellow_Leaf_Curl_Virus: "Virus TYLCV (enroulement jaune)",
  Tomato_mosaic_virus: "Virus de la mosaique",
  Leaf_scorch: "Brulure foliaire"
}

// Ordre canonique PlantVillage 38 classes.
const RAW_CLASSES: string[] = [
  "Apple___Apple_scab",
  "Apple___Black_rot",
  "Apple___Cedar_apple_rust",
  "Apple___healthy",
  "Blueberry___healthy",
  "Cherry_(including_sour)___Powdery_mildew",
  "Cherry_(including_sour)___healthy",
  "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
  "Corn_(maize)___Common_rust_",
  "Corn_(maize)___Northern_Leaf_Blight",
  "Corn_(maize)___healthy",
  "Grape___Black_rot",
  "Grape___Esca_(Black_Measles)",
  "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
  "Grape___healthy",
  "Orange___Haunglongbing_(Citrus_greening)",
  "Peach___Bacterial_spot",
  "Peach___healthy",
  "Pepper,_bell___Bacterial_spot",
  "Pepper,_bell___healthy",
  "Potato___Early_blight",
  "Potato___Late_blight",
  "Potato___healthy",
  "Raspberry___healthy",
  "Soybean___healthy",
  "Squash___Powdery_mildew",
  "Strawberry___Leaf_scorch",
  "Strawberry___healthy",
  "Tomato___Bacterial_spot",
  "Tomato___Early_blight",
  "Tomato___Late_blight",
  "Tomato___Leaf_Mold",
  "Tomato___Septoria_leaf_spot",
  "Tomato___Spider_mites Two-spotted_spider_mite",
  "Tomato___Target_Spot",
  "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
  "Tomato___Tomato_mosaic_virus",
  "Tomato___healthy"
]

function humanize(token: string): string {
  return token.replace(/_/g, " ").replace(/\s+/g, " ").trim()
}

export function parseDiseaseLabel(raw: string): DiseaseLabel {
  const [plantPart, conditionPart = "healthy"] = raw.split("___")
  const healthy = conditionPart.toLowerCase() === "healthy"
  return {
    raw,
    plant: PLANT_FR[plantPart] ?? humanize(plantPart),
    condition: CONDITION_FR[conditionPart] ?? (healthy ? "Sain" : humanize(conditionPart)),
    healthy
  }
}

/** Libelle d'affichage francais: "Tomate - Mildiou" ou "Pommier - Sain". */
export function formatDiseaseLabel(label: DiseaseLabel): string {
  return `${label.plant} - ${label.condition}`
}

function parseClassesJson(json: string): string[] | null {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed) && parsed.length) return parsed.map(String)
  } catch {
    // ignore: on retombe sur le defaut
  }
  return null
}

function loadRawClasses(): string[] {
  const inline = process.env.PLANT_DISEASE_LABELS
  if (inline) {
    const parsed = parseClassesJson(inline)
    if (parsed) return parsed
  }

  const path = process.env.PLANT_DISEASE_LABELS_PATH
  if (path) {
    try {
      const parsed = parseClassesJson(readFileSync(path, "utf8"))
      if (parsed) return parsed
    } catch {
      // ignore: on retombe sur le defaut
    }
  }

  return RAW_CLASSES
}

let cachedLabels: DiseaseLabel[] | null = null

/** Labels resolus (defaut PlantVillage, ou surcharge via env). Memoise. */
export function getDiseaseLabels(): DiseaseLabel[] {
  if (!cachedLabels) cachedLabels = loadRawClasses().map(parseDiseaseLabel)
  return cachedLabels
}

export const PLANTVILLAGE_CLASS_COUNT = RAW_CLASSES.length
