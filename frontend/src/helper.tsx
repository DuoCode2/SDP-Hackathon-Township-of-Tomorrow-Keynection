import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Delegate } from './api'

// A family helper using Jiran5 for a household (for example, a daughter helping her mother).
// In a real pilot the helper signs in on their own phone; the demo switches with one tap from the Me page.

export interface Acting {
  unitId: string
  id: number
  name: string
  relation: Delegate['relation']
}

const HelperContext = createContext<{ acting: Acting | null; setActing: (a: Acting | null) => void }>({ acting: null, setActing: () => {} })

export function HelperProvider({ children }: { children: ReactNode }) {
  const [acting, setActing] = useState<Acting | null>(null)
  return <HelperContext.Provider value={{ acting, setActing }}>{children}</HelperContext.Provider>
}

export const useActing = () => useContext(HelperContext)

/** The helper acting for this household right now, if any. */
export function useHelper(unitId: string): Acting | null {
  const { acting } = useContext(HelperContext)
  return acting && acting.unitId === unitId ? acting : null
}
