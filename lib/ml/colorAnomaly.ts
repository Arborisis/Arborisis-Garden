import sharp from "sharp"

export type ColorAnomalySeverity = "low" | "medium" | "high"

export type ColorAnomalyFinding = {
  tag: string
  label: string
  severity: ColorAnomalySeverity
  coveragePct: number
  confidence: number
  position: string
  view?: string
  bbox: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type ColorAnomalyReport = {
  tags: string[]
  anomalyScore: number
  coveragePct: number
  confidence: number
  findings: ColorAnomalyFinding[]
  summary: string
}

type PixelClass = {
  tag: string
  label: string
  priority: number
}

const EMPTY_REPORT: ColorAnomalyReport = {
  tags: [],
  anomalyScore: 0,
  coveragePct: 0,
  confidence: 0,
  findings: [],
  summary: "Aucune tache de couleur anormale detectee localement."
}

const CLASSES: Record<string, PixelClass> = {
  yellow: { tag: "tache-jaune", label: "jaunissement local", priority: 3 },
  brown: { tag: "tache-brune", label: "zone brune", priority: 4 },
  dark: { tag: "tache-foncee", label: "zone sombre", priority: 4 },
  pale: { tag: "tache-pale", label: "zone pale/grisee", priority: 2 },
  redPurple: { tag: "tache-rouge-violet", label: "teinte rouge/violet", priority: 3 }
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v))
}

function round(v: number, decimals = 3): number {
  const scale = 10 ** decimals
  return Math.round(v * scale) / scale
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0

  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  return {
    h,
    s: max === 0 ? 0 : d / max,
    v: max
  }
}

function isGreenLeafLike(h: number, s: number, v: number): boolean {
  return h >= 70 && h <= 175 && s >= 0.16 && v >= 0.12 && v <= 0.92
}

function isPlantColored(s: number, v: number): boolean {
  return s >= 0.18 && v >= 0.08 && v <= 0.94
}

function hasNeighbor(mask: Uint8Array, width: number, height: number, index: number, radius = 2): boolean {
  const x = index % width
  const y = Math.floor(index / width)
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
      if (mask[yy * width + xx]) return true
    }
  }
  return false
}

function classifyPixel(
  h: number,
  s: number,
  v: number,
  nearGreen: boolean,
  plantColored: boolean,
  hasLeafContext: boolean
): PixelClass | null {
  const contextual = hasLeafContext ? nearGreen : plantColored
  if (!contextual) return null

  if (v < 0.16 && s > 0.08) return CLASSES.dark
  if (h >= 12 && h <= 46 && s >= 0.2 && v >= 0.12 && v <= 0.68) return CLASSES.brown
  if (h >= 42 && h <= 76 && s >= 0.24 && v >= 0.32) return CLASSES.yellow
  if ((h <= 18 || h >= 300 || (h >= 245 && h <= 305)) && s >= 0.22 && v >= 0.12) return CLASSES.redPurple
  if (nearGreen && s <= 0.22 && v >= 0.58 && v <= 0.93) return CLASSES.pale

  return null
}

function severityFor(coveragePct: number, priority: number): ColorAnomalySeverity {
  const weighted = coveragePct * (priority / 3)
  if (weighted >= 4.5) return "high"
  if (weighted >= 1.25) return "medium"
  return "low"
}

function positionLabel(minX: number, minY: number, maxX: number, maxY: number, width: number, height: number): string {
  const cx = (minX + maxX) / 2 / width
  const cy = (minY + maxY) / 2 / height
  const horizontal = cx < 0.34 ? "gauche" : cx > 0.66 ? "droite" : "centre"
  const vertical = cy < 0.34 ? "haut" : cy > 0.66 ? "bas" : "milieu"
  return `${vertical}-${horizontal}`
}

export function emptyColorAnomalyReport(): ColorAnomalyReport {
  return { ...EMPTY_REPORT, tags: [], findings: [] }
}

export async function analyzePlantColorAnomalies(input: {
  bytes: Buffer
  view?: string
}): Promise<ColorAnomalyReport> {
  const resized = await sharp(input.bytes, { failOn: "none" })
    .rotate()
    .resize({ width: 220, height: 220, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const width = resized.info.width
  const height = resized.info.height
  const total = width * height
  if (!width || !height || total === 0) return emptyColorAnomalyReport()

  const greenMask = new Uint8Array(total)
  const plantMask = new Uint8Array(total)
  const hsv = new Array<{ h: number; s: number; v: number }>(total)
  const data = resized.data
  let greenCount = 0
  let plantColoredCount = 0

  for (let i = 0; i < total; i++) {
    const offset = i * 4
    const alpha = data[offset + 3]
    if (alpha < 128) {
      hsv[i] = { h: 0, s: 0, v: 0 }
      continue
    }

    const color = rgbToHsv(data[offset], data[offset + 1], data[offset + 2])
    hsv[i] = color
    if (isGreenLeafLike(color.h, color.s, color.v)) {
      greenMask[i] = 1
      greenCount++
    }
    if (isPlantColored(color.s, color.v)) {
      plantMask[i] = 1
      plantColoredCount++
    }
  }

  const hasLeafContext = greenCount / total >= 0.018
  const classAt: Array<PixelClass | null> = new Array(total).fill(null)
  let anomalyPixels = 0

  for (let i = 0; i < total; i++) {
    const color = hsv[i]
    const nearGreen = hasLeafContext ? hasNeighbor(greenMask, width, height, i, 4) : false
    const plantColored = Boolean(plantMask[i])
    const klass = classifyPixel(color.h, color.s, color.v, nearGreen, plantColored, hasLeafContext)
    if (klass) {
      classAt[i] = klass
      anomalyPixels++
    }
  }

  const contextPixels = Math.max(greenCount + anomalyPixels, plantColoredCount, Math.floor(total * 0.12), 1)
  const minArea = Math.max(10, Math.round(contextPixels * 0.0015))
  const seen = new Uint8Array(total)
  const findings: ColorAnomalyFinding[] = []

  for (let i = 0; i < total; i++) {
    const klass = classAt[i]
    if (!klass || seen[i]) continue

    const queue = [i]
    seen[i] = 1
    let ptr = 0
    let area = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    while (ptr < queue.length) {
      const index = queue[ptr++]
      const x = index % width
      const y = Math.floor(index / width)
      area++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ]
      for (const next of neighbors) {
        if (next < 0 || seen[next]) continue
        if (classAt[next]?.tag !== klass.tag) continue
        seen[next] = 1
        queue.push(next)
      }
    }

    if (area < minArea) continue

    const coveragePct = (area / contextPixels) * 100
    const bboxWidth = maxX - minX + 1
    const bboxHeight = maxY - minY + 1
    const compactness = clamp(area / Math.max(1, bboxWidth * bboxHeight), 0.2, 1)
    const confidence = clamp(0.35 + Math.sqrt(area / contextPixels) * 1.2 + compactness * 0.18, 0.35, 0.94)

    findings.push({
      tag: klass.tag,
      label: klass.label,
      severity: severityFor(coveragePct, klass.priority),
      coveragePct: round(coveragePct, 2),
      confidence: round(confidence, 2),
      position: positionLabel(minX, minY, maxX, maxY, width, height),
      view: input.view,
      bbox: {
        x: round(minX / width),
        y: round(minY / height),
        width: round(bboxWidth / width),
        height: round(bboxHeight / height)
      }
    })
  }

  const rankedFindings = findings
    .sort((a, b) => b.coveragePct * b.confidence - a.coveragePct * a.confidence)
    .slice(0, 8)
  const coveragePct = round(rankedFindings.reduce((sum, finding) => sum + finding.coveragePct, 0), 2)
  const tags = unique(rankedFindings.map((finding) => finding.tag))
  const maxConfidence = rankedFindings.reduce((max, finding) => Math.max(max, finding.confidence), 0)
  const contextConfidence = hasLeafContext ? 0.18 : 0.04
  const confidence = rankedFindings.length
    ? round(clamp(maxConfidence + contextConfidence, 0, 0.96), 2)
    : round(hasLeafContext ? 0.58 : 0.28, 2)
  const anomalyScore = rankedFindings.length
    ? round(clamp((coveragePct / 18) * confidence))
    : 0

  if (!rankedFindings.length) {
    return {
      ...emptyColorAnomalyReport(),
      confidence,
      summary: hasLeafContext
        ? "Aucune tache de couleur anormale detectee sur les zones de feuillage visibles."
        : "Feuillage peu isole par le modele couleur; aucune tache fiable detectee."
    }
  }

  const main = rankedFindings[0]
  const summary =
    `${tags.length} tag(s) couleur: ${tags.join(", ")}. ` +
    `Signal principal: ${main.label} en ${main.position} (${main.coveragePct.toFixed(1)}% de la zone vegetale estimee).`

  return {
    tags,
    anomalyScore,
    coveragePct,
    confidence,
    findings: rankedFindings,
    summary
  }
}

export function mergeColorAnomalyReports(reports: ColorAnomalyReport[]): ColorAnomalyReport {
  const realReports = reports.filter((report) => report.confidence > 0 || report.findings.length > 0)
  if (!realReports.length) return emptyColorAnomalyReport()

  const findings = realReports
    .flatMap((report) => report.findings)
    .sort((a, b) => b.coveragePct * b.confidence - a.coveragePct * a.confidence)
    .slice(0, 12)
  const tags = unique(realReports.flatMap((report) => report.tags))
  const coveragePct = round(realReports.reduce((sum, report) => sum + report.coveragePct, 0))
  const anomalyScore = round(clamp(Math.max(...realReports.map((report) => report.anomalyScore), 0)))
  const confidence = round(clamp(Math.max(...realReports.map((report) => report.confidence), 0)))

  return {
    tags,
    anomalyScore,
    coveragePct,
    confidence,
    findings,
    summary: findings.length
      ? `${tags.length} tag(s) couleur sur ${realReports.length} vue(s): ${tags.join(", ")}.`
      : "Aucune tache de couleur anormale detectee localement."
  }
}
