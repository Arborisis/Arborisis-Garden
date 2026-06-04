/**
 * Auth d'ingestion/mutation, identique au pattern telemetry/bioelectric:
 * si DEVICE_INGEST_TOKEN n'est pas défini, l'auth est ignorée (dev local).
 * Sinon, le header `x-device-token` ou `Authorization: Bearer <token>` doit
 * correspondre. Les routes de listing/export restent publiques (non gardées).
 */
export function isMutationAuthorized(request: Request): boolean {
  const expected = process.env.DEVICE_INGEST_TOKEN
  if (!expected) return true
  const header = request.headers.get("x-device-token") ?? ""
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  return header === expected || bearer === expected
}
