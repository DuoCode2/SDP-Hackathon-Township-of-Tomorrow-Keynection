// Choices this browser remembers (language, the guide, the staff name...), as keynection.<key>. Before the rename
// they were jiran5.<key>: read once, moved over, so nobody loses a choice. A private window simply remembers nothing.

export function remembered(key: string): string | null {
  try {
    const now = localStorage.getItem(`keynection.${key}`)
    if (now !== null) return now
    const old = localStorage.getItem(`jiran5.${key}`)
    if (old !== null) {
      localStorage.setItem(`keynection.${key}`, old)
      localStorage.removeItem(`jiran5.${key}`)
    }
    return old
  } catch {
    return null
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`keynection.${key}`, value)
  } catch {
    // Private window: not remembered.
  }
}

export function forget(key: string): void {
  try {
    localStorage.removeItem(`keynection.${key}`)
    localStorage.removeItem(`jiran5.${key}`)
  } catch {
    // Private window: nothing was remembered.
  }
}
