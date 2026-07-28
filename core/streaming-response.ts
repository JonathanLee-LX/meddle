const STREAMING_CONTENT_TYPES = [
    'text/event-stream',
    'application/x-ndjson',
    'application/ndjson',
    'application/json-seq',
    'application/stream+json',
]

export function isStreamingResponse(headers: Record<string, unknown> = {}): boolean {
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    if (typeof contentType !== 'string') return false

    const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
    return STREAMING_CONTENT_TYPES.includes(mediaType)
}
