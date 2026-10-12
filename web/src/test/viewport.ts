/**
 * Width-aware `window.matchMedia` stub for layout tests. Evaluates simple
 * `(min-width: Npx)` / `(max-width: Npx)` queries against a fake viewport
 * width and fires `change` listeners when `setWidth` moves across them.
 */
type Listener = () => void

interface FakeMql {
  media: string
  readonly matches: boolean
  onchange: null
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
  addListener: (listener: Listener) => void
  removeListener: (listener: Listener) => void
  dispatchEvent: () => boolean
}

function evaluate(query: string, width: number) {
  const parts = query.match(/\((min|max)-width:\s*([\d.]+)px\)/g)
  if (!parts) return false
  return parts.every((part) => {
    const [, kind, value] = part.match(/\((min|max)-width:\s*([\d.]+)px\)/) ?? []
    const px = Number(value)
    return kind === 'min' ? width >= px : width <= px
  })
}

export function installViewport(initialWidth: number) {
  let width = initialWidth
  const entries: { query: string; listeners: Set<Listener>; last: boolean }[] = []

  window.matchMedia = ((query: string) => {
    const entry = { query, listeners: new Set<Listener>(), last: evaluate(query, width) }
    entries.push(entry)
    const mql: FakeMql = {
      media: query,
      get matches() {
        return evaluate(query, width)
      },
      onchange: null,
      addEventListener: (_type, listener) => entry.listeners.add(listener),
      removeEventListener: (_type, listener) => entry.listeners.delete(listener),
      addListener: (listener) => entry.listeners.add(listener),
      removeListener: (listener) => entry.listeners.delete(listener),
      dispatchEvent: () => false,
    }
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia

  return {
    setWidth(next: number) {
      width = next
      for (const entry of entries) {
        const now = evaluate(entry.query, width)
        if (now === entry.last) continue
        entry.last = now
        entry.listeners.forEach((listener) => listener())
      }
    },
  }
}
