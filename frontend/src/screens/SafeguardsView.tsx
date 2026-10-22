import type { ReactNode } from 'react'
import { ArrowUpRight, Ban, Building, Camera, Clock4, EyeOff, Gavel, KeyRound, Languages, Lock, Scale, ServerCog, Smartphone, Sparkles, UsersRound } from 'lucide-react'
import type { TabId } from '../guide'
import { useT } from '../i18n'
import { ScreenTitle, Stamp } from '../ui'

// A risk's words live in i18n-sdp-safe.ts: `sdp.safe.<id>.title`, `.risk` and `.m1` … `.m<measures>`, in the order the
// measures are listed. `pilot` names the measures (by number) the pilot plan adds; the rest are built in the prototype.
// `see.label` is the dictionary key of the page the link names.
type Risk = { id: string; icon: ReactNode; measures: number; pilot: number[]; see?: { tab: TabId; label: string } }

// Every concern raised while designing Keynection, and what the prototype (or the pilot plan) does about it.
const RISKS: Risk[] = [
  { id: 'privacy', icon: <EyeOff size={18} />, measures: 20, pilot: [13], see: { tab: 'chats', label: 'nav.chats' } },
  { id: 'conflict', icon: <Ban size={18} />, measures: 11, pilot: [], see: { tab: 'chats', label: 'nav.chats' } },
  { id: 'ai', icon: <Sparkles size={18} />, measures: 11, pilot: [11], see: { tab: 'chats', label: 'nav.chats' } },
  { id: 'evidence', icon: <Camera size={18} />, measures: 5, pilot: [4, 5], see: { tab: 'log', label: 'nav.log' } },
  { id: 'judgement', icon: <Gavel size={18} />, measures: 6, pilot: [5], see: { tab: 'evidence', label: 'nav.evidence' } },
  { id: 'repairs', icon: <Clock4 size={18} />, measures: 4, pilot: [], see: { tab: 'sdp', label: 'sdp.safe.see.sdp' } },
  { id: 'contractor', icon: <KeyRound size={18} />, measures: 2, pilot: [2], see: { tab: 'works', label: 'nav.works' } },
  { id: 'safety', icon: <Lock size={18} />, measures: 2, pilot: [2], see: { tab: 'circle', label: 'sdp.safe.see.circle' } },
  { id: 'apartments', icon: <Building size={18} />, measures: 4, pilot: [4], see: { tab: 'circle', label: 'sdp.safe.see.circle' } },
  { id: 'offline', icon: <Smartphone size={18} />, measures: 6, pilot: [] },
  { id: 'language', icon: <Languages size={18} />, measures: 5, pilot: [5], see: { tab: 'chats', label: 'nav.chats' } },
  { id: 'legal', icon: <Scale size={18} />, measures: 3, pilot: [3] },
  { id: 'adoption', icon: <UsersRound size={18} />, measures: 7, pilot: [4], see: { tab: 'sdp', label: 'sdp.safe.see.sdp' } },
  { id: 'security', icon: <ServerCog size={18} />, measures: 16, pilot: [16] },
]

export default function SafeguardsView({ onGo }: { onGo: (tab: TabId) => void }) {
  const t = useT()
  const built = RISKS.reduce((n, r) => n + r.measures - r.pilot.length, 0)
  const total = RISKS.reduce((n, r) => n + r.measures, 0)
  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('sdp.safe.eyebrow')} title={t('nav.safeguards')} subtitle={t('sdp.safe.subtitle')}
        aside={<div className="metrics"><div className="metric metric-brand"><b>{built}/{total}</b><span>{t('sdp.safe.metric.built')}</span></div><div className="metric"><b>{RISKS.length}</b><span>{t('sdp.safe.metric.risks')}</span></div></div>} />
      <div className="risk-grid">
        {RISKS.map((r) => (
          <article key={r.id} className="risk">
            <div className="risk-head">
              <div className="card-icon tone-brand">{r.icon}</div>
              <div className="grow">
                <h3>{t(`sdp.safe.${r.id}.title`)}</h3>
                <p>{t(`sdp.safe.${r.id}.risk`)}</p>
              </div>
            </div>
            <ul>
              {Array.from({ length: r.measures }, (_, i) => {
                const key = `sdp.safe.${r.id}.m${i + 1}`
                const isBuilt = !r.pilot.includes(i + 1)
                return (
                  <li key={key} className={isBuilt ? 'built' : 'pilot'}>
                    <span>{t(key)}</span>
                    {isBuilt ? <Stamp tone="brand" tilt={0}>{t('sdp.safe.stamp.built')}</Stamp> : <Stamp tone="blue" tilt={0}>{t('si.pilot')}</Stamp>}
                  </li>
                )
              })}
            </ul>
            {r.see && <button className="link-btn" onClick={() => onGo(r.see!.tab)}>{t('sdp.safe.see', { page: t(r.see.label) })} <ArrowUpRight size={13} /></button>}
          </article>
        ))}
      </div>
    </section>
  )
}
