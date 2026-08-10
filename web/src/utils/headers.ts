/** Serialize a headers object to "key: value" lines for copying. */
export function formatHeadersText(headers: Record<string, string> | undefined): string {
  const entries = Object.entries(headers || {})
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}
