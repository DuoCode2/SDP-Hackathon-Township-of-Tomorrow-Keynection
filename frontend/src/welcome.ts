import { forget, remember, remembered } from './storage'

// In a pilot the welcome greets each household once: seen is remembered per household on this device, and joining
// brings it back. The demo never opens it by itself, so a judge lands on the five homes. In both modes the Me page
// shows it again. (A private window remembers nothing, so in a pilot it shows once per page load there.)
const seenThisLoad = new Set<string>()
const asked = new Map<string, number>()  // homes that asked for it (Me, the Guide, the end of the opening) → the card to start on

function seenHomes(): string[] {
  try {
    return JSON.parse(remembered('welcome.seen') ?? '[]') as string[]
  } catch {
    return []
  }
}

function welcomeSeen(unitId: string): boolean {
  return seenThisLoad.has(unitId) || seenHomes().includes(unitId)
}

/** Whether Neighbours opens on the welcome: a pilot household that hasn't seen it, or a home that asked for it. */
export function welcomeDue(unitId: string, pilot: boolean): boolean {
  return asked.has(unitId) || (pilot && !welcomeSeen(unitId))
}

/** Which card the tour opens on for this home: the one asked for, else the first. */
export function tourStart(unitId: string): number {
  return asked.get(unitId) ?? 0
}

export function markWelcomeSeen(unitId: string) {
  seenThisLoad.add(unitId)
  asked.delete(unitId)
  remember('welcome.seen', JSON.stringify([...new Set([...seenHomes(), unitId])]))  // a private window: this load only
}

/** Forget who has seen the welcome (after joining, or a home asking for its tour again). Given a home, it opens for
 *  that home next, demo too. The demo's key-day opening is left alone: asking for the tour is not asking to start over. */
export function replayWelcome(unitId?: string, start = 0) {
  seenThisLoad.clear()
  forget('welcome.seen')
  if (unitId) asked.set(unitId, start)
}

/** A demo reset: the welcome and the key-day opening both come back on the next page load. */
export function replayOpening() {
  replayWelcome()
  forget('opening.done')
}

/** The tour's "Ask now": the assistant's chat opens as if its orb were tapped (there is one assistant per screen). */
export const ASK_EVENT = 'keynection:ask'
export function openAssistant() {
  window.dispatchEvent(new Event(ASK_EVENT))
}
