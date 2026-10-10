import { createContext, useContext, useEffect, useState } from 'react'
import { api, type AiStatus, type AuthMe } from './api'
import type { TabId } from './guide'

// Contractor QR passes and the guardhouse scan are built (and covered by the server's tests) but switched off in the
// demo: they manage workers rather than neighbours, and estate products such as VYROX and i-Neighbour already do it.
// Turn this on if a mentor asks to see them.
export const SHOW_CONTRACTOR_PASSES = false

// The demo opens on the main story only: meet the five homes, the renovation notice as a hello, a fair photo check if a
// crack appears, and how SDP reaches residents and measures the result. "Show every feature" in the guide brings back
// the rest (home log, profile and family helpers, the command view, phase setup, safeguards, contact requests beyond
// the five) for judges' questions. These are the screens of the 3-minute judge route.
export const FOCUS_TABS: readonly TabId[] = ['circle', 'chats', 'works', 'evidence', 'impact', 'channels']

const ShowAllContext = createContext(false)
export const ShowAllProvider = ShowAllContext.Provider
/** True when the presenter has switched on every feature; false shows the main story only. */
export const useShowAll = () => useContext(ShowAllContext)

// Pilot mode (a real phase, real sign-in) or the demo. In pilot mode the signed-in household or staff member is fixed:
// there is no cast switcher, and the server checks every request against the session.
export interface Pilot {
  me: AuthMe
  /** Ask the server again who is signed in (after adding a key, say). */
  refresh: () => void
  signOut: () => void
}
const PilotContext = createContext<Pilot | null>(null)
export const PilotProvider = PilotContext.Provider
/** The pilot session, or null in the demo. */
export const usePilot = () => useContext(PilotContext)

// Claude translates typed words and writes the renovation notice from one sentence, when the server has a key.
// Without one (or offline) the same screens work as before, so the app only needs to know which to say.
let aiStatus: Promise<AiStatus> | null = null
/** Whether AI is on here, asked once per page load; null until known, and off if the question fails. */
export function useAi(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    let live = true
    aiStatus ??= api.aiStatus().catch(() => ({ on: false, model: null }))
    aiStatus.then((s) => live && setStatus(s))
    return () => {
      live = false
    }
  }, [])
  return status
}
