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
  redPurple: { tag: "tache-rouge-violet", label: "teinte rouge/violet", priority: 3 },
  // Cœur necrotique (brun/sombre) entoure d'un halo chlorotique (jaune) : signature
  // classique de maladie foliaire, promue lors du post-traitement des composantes.
  necrotic: { tag: "tache-necrotique", label: "necrose a halo chlorotique", priority: 5 }
}

const NOISE_NEIGHBOR_MIN = 2

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

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
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

// Flou boite separable sur la luminance : sert de "fond" local pour mesurer le
// contraste de chaque pixel. Une vraie tache se distingue du feuillage qui
// l'entoure ; un simple degrade d'ombre, lui, suit son fond et a un contraste faible.
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length)
  const window = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let acc = 0
    for (let x = -radius; x <= radius; x++) {
      acc += source[row + clamp(x, 0, width - 1)]
    }
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = acc / window
      const out = row + clamp(x - radius, 0, width - 1)
      const inn = row + clamp(x + radius + 1, 0, width - 1)
      acc += source[inn] - source[out]
    }
  }

  const blurred = new Float32Array(source.length)
  for (let x = 0; x < width; x++) {
    let acc = 0
    for (let y = -radius; y <= radius; y++) {
      acc += horizontal[clamp(y, 0, height - 1) * width + x]
    }
    for (let y = 0; y < height; y++) {
      blurred[y * width + x] = acc / window
      const out = clamp(y - radius, 0, height - 1) * width + x
      const inn = clamp(y + radius + 1, 0, height - 1) * width + x
      acc += horizontal[inn] - horizontal[out]
    }
  }

  return blurred
}

type LeafBaseline = {
  h: number
  s: number
  v: number
  hasContext: boolean
}

// Classification colorimetrique d'un pixel relativement a la feuille saine de
// CETTE plante (et non a des seuils absolus). On combine des regles de teinte
// avec l'ecart au feuillage de reference et le contraste local, ce qui rend la
// detection robuste a l'eclairage et a la balance des blancs. Le rattachement
// spatial a la feuille (anti faux-positifs de fond) est gere separement.
function classifyPixel(
  h: number,
  s: number,
  v: number,
  contrast: number,
  baseline: LeafBaseline
): PixelClass | null {
  const darkerThanLeaf = v < baseline.v * 0.82
  const brighterThanLeaf = v > baseline.v * 1.12
  // Decalage de teinte vers le jaune par rapport au vert sain (chlorose).
  const yellowShift = baseline.hasContext ? baseline.h - h : 999

  // Zone sombre / necrose : tres peu lumineuse, plus foncee que la feuille et
  // marquee par un creux de contraste (bord net), pour ne pas confondre avec une ombre douce.
  if (v < 0.18 && s > 0.08 && (darkerThanLeaf || contrast < -0.05)) return CLASSES.dark

  // Brun : teinte chaude, saturee, plus sombre que le feuillage sain.
  if (h >= 12 && h <= 46 && s >= 0.2 && v >= 0.1 && v <= 0.7 && (darkerThanLeaf || contrast < -0.025)) {
    return CLASSES.brown
  }

  // Jaune / chlorose : teinte jaune franche ET decalee depuis le vert de reference.
  if (h >= 42 && h <= 76 && s >= 0.22 && v >= 0.3 && (yellowShift >= 8 || !baseline.hasContext)) {
    return CLASSES.yellow
  }

  // Rouge / violet : extremes de teinte, contraste perceptible.
  if ((h <= 18 || h >= 300 || (h >= 245 && h <= 305)) && s >= 0.22 && v >= 0.12 && Math.abs(contrast) > 0.02) {
    return CLASSES.redPurple
  }

  // Pale / oidium : zone desaturee et plus claire que le feuillage (poudre blanchatre).
  if (s <= 0.22 && v >= 0.55 && v <= 0.95 && (brighterThanLeaf || contrast > 0.03)) {
    return CLASSES.pale
  }

  return null
}

// Rattachement a la feuille par composantes connexes : on relie le feuillage vert
// et les pixels anormaux, puis on ne retient que les composantes touchant du vrai
// vert. Une lesion enclavee (coeur necrotique cerne par son halo) reste rattachee
// via le halo, alors qu'un aplat de fond non colle au feuillage est ecarte.
function computeOnLeafMask(
  candidate: Uint8Array,
  greenMask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = width * height
  const onLeaf = new Uint8Array(total)
  const seen = new Uint8Array(total)
  const queue = new Int32Array(total)

  for (let start = 0; start < total; start++) {
    if (!candidate[start] || seen[start]) continue
    let ptr = 0
    let end = 0
    queue[end++] = start
    seen[start] = 1
    let touchesGreen = false
    const componentStart = ptr

    while (ptr < end) {
      const index = queue[ptr++]
      if (greenMask[index]) touchesGreen = true
      const x = index % width
      const y = (index - x) / width
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ]
      for (const next of neighbors) {
        if (next < 0 || seen[next] || !candidate[next]) continue
        seen[next] = 1
        queue[end++] = next
      }
    }

    if (touchesGreen) {
      for (let p = componentStart; p < end; p++) onLeaf[queue[p]] = 1
    }
  }

  return onLeaf
}

function severityFor(coveragePct: number, priority: number, contrast: number, solidity: number): ColorAnomalySeverity {
  // La couverture reste le moteur principal, module par la priorite de la classe,
  // la nettete du bord (|contraste|) et la compacite (une lesion pleine pese plus
  // qu'un artefact filiforme).
  const edge = 0.85 + Math.min(0.4, Math.abs(contrast) * 3)
  const shape = 0.7 + solidity * 0.3
  const weighted = coveragePct * (priority / 3) * edge * shape
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
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
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
  const luminance = new Float32Array(total)
  const data = resized.data
  let greenCount = 0
  let plantColoredCount = 0
  const greenH: number[] = []
  const greenS: number[] = []
  const greenV: number[] = []

  for (let i = 0; i < total; i++) {
    const offset = i * 4
    const alpha = data[offset + 3]
    if (alpha < 128) {
      hsv[i] = { h: 0, s: 0, v: 0 }
      continue
    }

    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    luminance[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const color = rgbToHsv(r, g, b)
    hsv[i] = color
    if (isGreenLeafLike(color.h, color.s, color.v)) {
      greenMask[i] = 1
      greenCount++
      // Echantillonnage du feuillage sain pour la reference adaptative.
      if ((i & 3) === 0) {
        greenH.push(color.h)
        greenS.push(color.s)
        greenV.push(color.v)
      }
    }
    if (isPlantColored(color.s, color.v)) {
      plantMask[i] = 1
      plantColoredCount++
    }
  }

  const hasLeafContext = greenCount / total >= 0.018
  const baseline: LeafBaseline = {
    h: median(greenH, 110),
    s: median(greenS, 0.4),
    v: median(greenV, 0.55),
    hasContext: hasLeafContext
  }

  // Contraste local = luminance du pixel moins son fond floute.
  const blurred = boxBlur(luminance, width, height, 6)
  const contrast = new Float32Array(total)
  for (let i = 0; i < total; i++) contrast[i] = luminance[i] - blurred[i]

  const rawClass: Array<PixelClass | null> = new Array(total).fill(null)
  const candidate = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const color = hsv[i]
    const klass = classifyPixel(color.h, color.s, color.v, contrast[i], baseline)
    rawClass[i] = klass
    if (greenMask[i] || klass) candidate[i] = 1
  }

  // En contexte feuillage, on rattache chaque foyer a une composante touchant du
  // vert; sinon (gros plan sans vert isole) on retombe sur un simple masque plante.
  const onLeaf = hasLeafContext
    ? computeOnLeafMask(candidate, greenMask, width, height)
    : plantMask

  // Debruitage : un pixel anormal isole (sans assez de voisins de meme classe)
  // est ecarte. Supprime le poivre-et-sel sans eroder les vrais foyers.
  const classAt: Array<PixelClass | null> = new Array(total).fill(null)
  let anomalyPixels = 0
  for (let i = 0; i < total; i++) {
    const klass = rawClass[i]
    if (!klass || !onLeaf[i]) continue
    const x = i % width
    const y = (i - x) / width
    let sameNeighbors = 0
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
        const n = yy * width + xx
        if (n !== i && rawClass[n]?.tag === klass.tag) sameNeighbors++
      }
    }
    if (sameNeighbors >= NOISE_NEIGHBOR_MIN) {
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
    let contrastSum = 0
    // Suit la presence d'un halo jaune au contact d'un coeur brun/sombre.
    let yellowBorder = false

    while (ptr < queue.length) {
      const index = queue[ptr++]
      const x = index % width
      const y = Math.floor(index / width)
      area++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      contrastSum += Math.abs(contrast[index])

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ]
      for (const next of neighbors) {
        if (next < 0) continue
        const neighborTag = classAt[next]?.tag
        if (seen[next]) continue
        if (neighborTag === klass.tag) {
          seen[next] = 1
          queue.push(next)
        } else if (neighborTag === CLASSES.yellow.tag) {
          yellowBorder = true
        }
      }
    }

    if (area < minArea) continue

    const bboxWidth = maxX - minX + 1
    const bboxHeight = maxY - minY + 1
    const solidity = clamp(area / Math.max(1, bboxWidth * bboxHeight), 0.1, 1)
    const elongation = Math.max(bboxWidth, bboxHeight) / Math.max(1, Math.min(bboxWidth, bboxHeight))
    const meanContrast = contrastSum / area

    // Suppression des structures filiformes peu remplies (nervures, bord de feuille,
    // reflets lineaires) : tres allongees et peu solides, et pas une zone necrotique franche.
    if (elongation > 4.2 && solidity < 0.32 && klass.tag !== CLASSES.dark.tag) continue

    // Promotion en necrose si un coeur brun/sombre est borde de jaune (halo chlorotique).
    const isNecrotic = yellowBorder && (klass.tag === CLASSES.brown.tag || klass.tag === CLASSES.dark.tag)
    const effectiveClass = isNecrotic ? CLASSES.necrotic : klass

    const coveragePct = (area / contextPixels) * 100
    const confidence = clamp(
      0.32 +
        Math.sqrt(area / contextPixels) * 1.1 +
        solidity * 0.2 +
        Math.min(0.18, meanContrast * 2) +
        (isNecrotic ? 0.12 : 0),
      0.32,
      0.96
    )

    findings.push({
      tag: effectiveClass.tag,
      label: effectiveClass.label,
      severity: severityFor(coveragePct, effectiveClass.priority, meanContrast, solidity),
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

  // Score d'anomalie : couverture ponderee par la confiance, escalade quand les
  // foyers se multiplient (semis de taches typique d'une infection) ou en cas de necrose.
  const spotFactor = 1 + Math.min(0.6, Math.max(0, findings.length - 1) * 0.12)
  const necroticBoost = rankedFindings.some((finding) => finding.tag === CLASSES.necrotic.tag) ? 1.25 : 1
  const anomalyScore = rankedFindings.length
    ? round(clamp((coveragePct / 18) * confidence * spotFactor * necroticBoost))
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
  const spotCount = findings.length
  const summary =
    `${tags.length} tag(s) couleur (${spotCount} foyer${spotCount > 1 ? "s" : ""}): ${tags.join(", ")}. ` +
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
