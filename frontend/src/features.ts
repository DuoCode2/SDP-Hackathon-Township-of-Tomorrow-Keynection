import { createContext, useContext } from 'react'
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
