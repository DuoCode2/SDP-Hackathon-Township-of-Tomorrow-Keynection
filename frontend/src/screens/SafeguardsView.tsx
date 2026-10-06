import type { ReactNode } from 'react'
import { ArrowUpRight, Ban, Camera, Clock4, EyeOff, Gavel, KeyRound, Languages, Scale, ServerCog, Smartphone, UsersRound } from 'lucide-react'
import type { TabId } from '../guide'
import { ScreenTitle, Stamp } from '../ui'

type Measure = { text: string; built: boolean }
type Risk = { icon: ReactNode; title: string; risk: string; measures: Measure[]; see?: { tab: TabId; label: string } }

// Every concern raised while designing Jiran5, and what the prototype (or the pilot plan) does about it.
const RISKS: Risk[] = [
  {
    icon: <EyeOff size={18} />, title: 'Privacy & PDPA', risk: 'Neighbours, contractors or staff seeing personal data they should not.',
    measures: [
      { text: 'Phone numbers stay hidden until both households agree to exchange them', built: true },
      { text: 'Photos are re-encoded: GPS, camera model and capture time removed', built: true },
      { text: 'Contractors see only their pass, dates and house rules; no names, phones or photos', built: true },
      { text: 'PDPA notice and consent at sign-up; data kept only for the defect liability period plus one year', built: false },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Ban size={18} />, title: 'Harassment & neighbour conflict', risk: 'A messaging tool can make disputes louder instead of calmer.',
    measures: [
      { text: 'Tone check stops obvious insults before they are sent and suggests a calmer quick reply', built: true },
      { text: 'Report a message to the SDP estate team; the sender is warned privately, the reporter stays anonymous', built: true },
      { text: 'Silent block, and a daily message limit per neighbour', built: true },
      { text: 'Concerns go to the neighbour first, privately, before anyone else is involved', built: true },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Camera size={18} />, title: 'False or edited evidence', risk: 'Someone uploads an old photo, or edits a record later to win a dispute.',
    measures: [
      { text: 'Each photo is fingerprinted (SHA-256) the moment it is saved, with a server timestamp', built: true },
      { text: 'Every record is chained to the one before it; any later edit breaks the chain visibly', built: true },
      { text: 'In-app camera only, so gallery photos cannot be passed off as new', built: false },
    ],
    see: { tab: 'log', label: 'Home log' },
  },
  {
    icon: <Gavel size={18} />, title: 'Wrong automated judgement', risk: 'Software blaming the wrong party for a crack or a leak.',
    measures: [
      { text: 'The comparison only marks what changed; a transparent rule suggests, people decide', built: true },
      { text: '"Ask an SDP inspector" is always an option when owners disagree', built: true },
      { text: 'Photos that cannot be aligned are sent back for a retake instead of guessed', built: true },
    ],
    see: { tab: 'evidence', label: 'Evidence' },
  },
  {
    icon: <Clock4 size={18} />, title: 'Slow or disputed repairs', risk: 'Defects drag on, which is what SDP App reviewers complain about most.',
    measures: [
      { text: 'Every ticket shows the Housing Development Act clock: 24-month defect liability, 30 days to repair', built: true },
      { text: 'SDP can submit a repair but only the homeowner can close it; rejecting reopens the ticket', built: true },
      { text: 'Repair photos are checked against the pre-work photo automatically', built: true },
      { text: 'Overdue tickets are flagged on the SDP command view', built: true },
    ],
    see: { tab: 'sdp', label: 'SDP command view' },
  },
  {
    icon: <KeyRound size={18} />, title: 'Contractor misuse', risk: 'Workers arriving on Sundays, late at night, or after the job has ended.',
    measures: [
      { text: 'Passes only work on the renovation dates, Monday–Saturday 08:00–18:00', built: true },
      { text: 'Owners can revoke a pass at any time; at most three active passes per renovation', built: true },
      { text: 'Only a fingerprint of the QR code is stored, so a data leak cannot create working passes', built: true },
    ],
    see: { tab: 'works', label: 'Works' },
  },
  {
    icon: <Smartphone size={18} />, title: 'Residents who are not online', risk: 'Older residents or tenants without smartphones are left out.',
    measures: [
      { text: 'Notices are delivered on WhatsApp, which most residents already use', built: true },
      { text: 'A family member can act on an owner’s behalf, with the owner’s consent', built: false },
      { text: 'The estate office can register a renovation and print the notice for neighbours', built: false },
    ],
  },
  {
    icon: <Languages size={18} />, title: 'Language barriers', risk: 'Neighbours who do not share a language misread each other.',
    measures: [
      { text: 'Introductions and notices in English, Bahasa Melayu and Chinese', built: true },
      { text: 'Quick replies arrive translated into the reader’s language, no internet translation needed', built: true },
      { text: 'Tamil templates', built: false },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Scale size={18} />, title: 'Legal fit', risk: 'The app suggesting something that conflicts with Malaysian rules.',
    measures: [
      { text: 'Renovation notices record the council (PBT) permit and CIDB registration', built: true },
      { text: 'Warranty timing follows HDA Schedules G/H; the Tribunal for Homebuyer Claims stays available to owners', built: true },
      { text: 'Apartment rules follow each building’s strata by-laws (Strata Management Act 2013), set with the JMB/MC', built: false },
    ],
  },
  {
    icon: <UsersRound size={18} />, title: 'Low adoption', risk: 'Neighbours ignore it, so the circle is incomplete.',
    measures: [
      { text: 'Works with partial circles: each household is useful on its own', built: true },
      { text: 'Starts at handover, when SDP already meets every owner', built: false },
      { text: 'Reply rate and pre-work photo coverage are tracked on the command view', built: true },
    ],
    see: { tab: 'sdp', label: 'SDP command view' },
  },
  {
    icon: <ServerCog size={18} />, title: 'Security of the system', risk: 'Abuse of demo shortcuts, or someone acting as another household.',
    measures: [
      { text: 'Every action checks who is allowed to do it (only owners close tickets, only recipients report)', built: true },
      { text: 'Demo-only shortcuts switch off with one setting (JIRAN_DEMO_MODE=0)', built: true },
      { text: 'Sign-in with a WhatsApp one-time code, encryption at rest and an access audit log', built: false },
    ],
  },
]

export default function SafeguardsView({ onGo }: { onGo: (tab: TabId) => void }) {
  const built = RISKS.reduce((n, r) => n + r.measures.filter((m) => m.built).length, 0)
  const total = RISKS.reduce((n, r) => n + r.measures.length, 0)
  return (
    <section className="screen">
      <ScreenTitle eyebrow="Trust" title="Safeguards" subtitle="Every risk we found while designing Jiran5, and what the prototype already does about it."
        aside={<div className="metrics"><div className="metric metric-brand"><b>{built}/{total}</b><span>Built in prototype</span></div><div className="metric"><b>{RISKS.length}</b><span>Risks covered</span></div></div>} />
      <div className="risk-grid">
        {RISKS.map((r) => (
          <article key={r.title} className="risk">
            <div className="risk-head">
              <div className="card-icon tone-brand">{r.icon}</div>
              <div className="grow">
                <h3>{r.title}</h3>
                <p>{r.risk}</p>
              </div>
            </div>
            <ul>
              {r.measures.map((m) => (
                <li key={m.text} className={m.built ? 'built' : 'pilot'}>
                  <span>{m.text}</span>
                  {m.built ? <Stamp tone="brand" tilt={0}>Built</Stamp> : <Stamp tone="blue" tilt={0}>Pilot</Stamp>}
                </li>
              ))}
            </ul>
            {r.see && <button className="link-btn" onClick={() => onGo(r.see!.tab)}>See it in {r.see.label} <ArrowUpRight size={13} /></button>}
          </article>
        ))}
      </div>
    </section>
  )
}
