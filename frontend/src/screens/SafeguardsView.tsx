import type { ReactNode } from 'react'
import { ArrowUpRight, Ban, Building, Camera, Clock4, EyeOff, Gavel, KeyRound, Languages, Lock, Scale, ServerCog, Smartphone, Sparkles, UsersRound } from 'lucide-react'
import type { TabId } from '../guide'
import { ScreenTitle, Stamp } from '../ui'

type Measure = { text: string; built: boolean }
type Risk = { icon: ReactNode; title: string; risk: string; measures: Measure[]; see?: { tab: TabId; label: string } }

// Every concern raised while designing Keynection, and what the prototype (or the pilot plan) does about it.
const RISKS: Risk[] = [
  {
    icon: <EyeOff size={18} />, title: 'Privacy & PDPA', risk: 'Neighbours, contractors or staff seeing personal data they should not.',
    measures: [
      { text: 'No resident directory: outside your circle you see unit numbers, never names', built: true },
      { text: 'Phone numbers stay hidden until both households agree to exchange them', built: true },
      { text: 'Photos are re-encoded: GPS, camera model and capture time removed', built: true },
      { text: 'Profiles are one line only, visible to your circle and contacts, with a reminder not to share schedules or travel dates', built: true },
      { text: 'Voice notes can only be played by the two people in the chat, and are deleted after 30 days, checked every hour (a reported one is kept for the estate team until reviewed, never longer than 90 days)', built: true },
      { text: '"Download my data" gives each household everything Keynection holds about it as a file; other residents appear by unit only', built: true },
      { text: 'Bios and helper names can’t contain phone numbers, emails or links, so numbers are still exchanged only when both agree', built: true },
      { text: 'The data download and reported-voice playback switch off outside demo mode until sign-in exists', built: true },
      { text: 'SDP sees neighbour-relationship numbers only as counts, never who talked to whom or what was said', built: true },
      { text: 'Nobody is in Keynection without consent: a household joins with a one-time code from its handover pack and agrees to a plain-language privacy notice; until then neighbours see only its unit number', built: true },
      { text: 'The name neighbours see is chosen by the owner when joining; the name on SDP’s sales record is never shown', built: true },
      { text: 'Data kept only for the defect liability period plus one year, then deleted', built: false },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Ban size={18} />, title: 'Harassment & neighbour conflict', risk: 'A messaging tool can make disputes louder instead of calmer.',
    measures: [
      { text: 'Tone check stops obvious insults before they are sent; with AI on, a message that sounds heated gets a calmer wording offered first', built: true },
      { text: 'Report a message to the SDP estate team; the sender is warned privately, the reporter stays anonymous', built: true },
      { text: 'Silent block, and a daily message limit per neighbour', built: true },
      { text: 'Homes beyond your circle need a contact request with a reason; 3 a day, no repeat after a decline', built: true },
      { text: 'No township-wide group chat: estate notices come from a read-only official account', built: true },
      { text: '👋 Waves are limited to one per neighbour per day and can be switched off', built: true },
      { text: 'Quiet mode stops new messages, waves and requests; renovation notices and concerns still arrive', built: true },
      { text: 'Concerns go to the neighbour first, privately, before anyone else is involved', built: true },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Sparkles size={18} />, title: 'AI translation and suggestions', risk: 'A machine puts words in a neighbour’s mouth, gets a renovation wrong, or sends residents’ messages abroad.',
    measures: [
      { text: 'Only the words being written go to Claude (Anthropic), never the directory or who is writing to whom; a name or unit number goes only if the writer typed it in', built: true },
      { text: 'Every translation is marked “Translated by AI” with the original one tap away; the home log and reports keep the original words', built: true },
      { text: 'A calmer wording is only a suggestion: the sender chooses which words go, and insults are still refused', built: true },
      { text: 'From one sentence, AI fills in the type of work, dates, hours and contractor; approvals and the CIDB tick stay the owner’s, and nothing is sent until the owner has checked every step', built: true },
      { text: 'Answers that break the notice rules (an end before the start, impossible hours) are dropped and handed back to the owner', built: true },
      { text: 'No key, no network or no answer in time: messages go as written, quick replies are still translated, the notice is filled in by hand', built: true },
      { text: 'A daily AI allowance per home keeps the cost of a public demo small', built: true },
      { text: 'The privacy notice names the AI service and that it processes text outside Malaysia (PDPA cross-border transfer)', built: true },
      { text: 'Pilot: a data processing agreement, or Claude through SDP’s own cloud provider, and a native speaker checking Malay and Tamil translations', built: false },
    ],
    see: { tab: 'chats', label: 'Chats' },
  },
  {
    icon: <Camera size={18} />, title: 'False or edited evidence', risk: 'Someone uploads an old photo, or edits a record later to win a dispute.',
    measures: [
      { text: 'Each photo is fingerprinted (SHA-256) the moment it is saved, with a server timestamp', built: true },
      { text: 'Every record is chained to the one before it; a quiet edit to an old record breaks the chain', built: true },
      { text: 'No one can add records by hand: only the app\'s own steps write to a home log', built: true },
      { text: 'Signed receipts to the owner and a daily outside timestamp, so no one (SDP included) can rewrite a log unseen', built: false },
      { text: 'In-app camera only, so gallery photos cannot be passed off as new', built: false },
    ],
    see: { tab: 'log', label: 'Home log' },
  },
  {
    icon: <Gavel size={18} />, title: 'Wrong automated judgement', risk: 'Software blaming the wrong party for a crack or a leak.',
    measures: [
      { text: 'The comparison only marks what changed; a transparent rule suggests, people decide', built: true },
      { text: 'A change photographed before work began is never put down to the renovation', built: true },
      { text: 'Blaming the renovation is only a proposal until the renovating owner agrees; nothing is pre-selected', built: true },
      { text: '"Ask an SDP inspector" is always an option when owners disagree; residents cannot record an inspector\'s finding', built: true },
      { text: 'A real inspector role with SDP sign-in records the finding', built: false },
      { text: 'Photos that cannot be aligned are sent back for a retake instead of guessed', built: true },
    ],
    see: { tab: 'evidence', label: 'Photos & repairs' },
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
      { text: 'Noisy work only within the hours in the renovation notice; outside them, a neighbour raises a concern that goes on record', built: true },
      { text: 'Time-limited worker passes checked at the guardhouse (refused on Sundays and outside the works dates), revocable by the owner and showing contractors no names, phones or photos. Built on the server but switched off in this demo: estate systems already do this, so it is a pilot add-on, not our focus', built: false },
    ],
    see: { tab: 'works', label: 'Works' },
  },
  {
    icon: <Lock size={18} />, title: 'Burglary and personal safety', risk: 'An app that shows who is renovating or away tells strangers which houses are empty.',
    measures: [
      { text: 'Who is renovating, and when, is visible only to the homes the notice reached', built: true },
      { text: 'Only verified owners and tenants can join (SDP handover records or the management office)', built: false },
    ],
    see: { tab: 'circle', label: 'Circle' },
  },
  {
    icon: <Building size={18} />, title: 'Apartments: leaks and noise across floors', risk: 'A bathroom leak or hacking noise reaches homes that are not next door.',
    measures: [
      { text: 'The notice range follows the type of work: wet work reaches two floors down, hacking two floors up and down', built: true },
      { text: 'The renovating owner cannot remove anyone from the notice', built: true },
      { text: 'Homes two floors away are told and can photograph their ceiling, without seeing each other’s names', built: true },
      { text: 'Inter-floor leak handling follows the strata rules and the JMB/MC process', built: false },
    ],
    see: { tab: 'circle', label: 'Circle' },
  },
  {
    icon: <Smartphone size={18} />, title: 'Residents who are not online', risk: 'Older residents or tenants without smartphones are left out.',
    measures: [
      { text: 'Notices are delivered on WhatsApp, which most residents already use', built: true },
      { text: 'Up to two family helpers can act for a household, added by the owner with consent; every action they take is recorded under the helper’s name', built: true },
      { text: 'Voice messages for residents who find typing hard', built: true },
      { text: 'The estate office can register a renovation for an owner who signed the paper form, with the staff name on record', built: true },
      { text: 'Neighbours who haven’t joined get the renovation notice on paper, in their language with English below; delivery goes into both home logs', built: true },
      { text: 'Easy mode: bigger text and buttons and fewer options, a setting only the household itself can see', built: true },
    ],
  },
  {
    icon: <Languages size={18} />, title: 'Language barriers', risk: 'Neighbours who do not share a language misread each other.',
    measures: [
      { text: 'The resident screens switch between English, Bahasa Melayu and Chinese from the top bar; records stay in English, with a note in the reader’s language saying why', built: true },
      { text: 'Hovering a quick reply shows exactly what the neighbour will receive in their language', built: true },
      { text: 'Introductions, quick replies, WhatsApp alerts, paper notices and the privacy notice in English, Bahasa Melayu, Chinese and Tamil', built: true },
      { text: 'Quick replies arrive translated into the reader’s language, no internet translation needed', built: true },
      { text: 'Tamil on every screen, and a native speaker’s review of the Tamil text (written with AI help)', built: false },
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
      { text: 'Starts at handover, when SDP already meets every owner: the join code is in the welcome pack', built: true },
      { text: 'A new phase is set up from the site plan in seconds; end lots and corners are flagged automatically', built: true },
      { text: 'Irregular plots (semi-D, shoplots, odd shapes) are checked and corrected by the estate office', built: false },
      { text: 'Alerts arrive on WhatsApp and Keynection sits inside the SDP App, so there is no new app to install', built: true },
      { text: 'Reply rate and pre-work photo coverage are tracked on the command view', built: true },
      { text: 'The command view tracks how many next-door pairs know each other and how long it takes from keys to a first hello', built: true },
    ],
    see: { tab: 'sdp', label: 'SDP command view' },
  },
  {
    icon: <ServerCog size={18} />, title: 'Security of the system', risk: 'Abuse of demo shortcuts, or someone acting as another household.',
    measures: [
      { text: 'Every action checks who is allowed to do it (only owners close tickets, only recipients report)', built: true },
      { text: 'A family helper only works for the household that added them; a removed helper is refused straight away', built: true },
      { text: 'A helper’s name can’t look like SDP, the estate office or the police', built: true },
      { text: 'Join codes are single-use, expire after 14 days, are stored only as a hash, and can’t be re-issued for a household that already joined (no takeover)', built: true },
      { text: 'Staff tools (join codes, front desk, paper notices) switch off outside demo mode until staff sign in', built: true },
      { text: 'Demo-only shortcuts switch off with one setting (JIRAN_DEMO_MODE=0)', built: true },
      { text: 'Sign-in with a WhatsApp one-time code, encryption at rest and an access audit log', built: false },
      { text: 'Outside demo mode the phase listing carries no names at all', built: true },
    ],
  },
]

export default function SafeguardsView({ onGo }: { onGo: (tab: TabId) => void }) {
  const built = RISKS.reduce((n, r) => n + r.measures.filter((m) => m.built).length, 0)
  const total = RISKS.reduce((n, r) => n + r.measures.length, 0)
  return (
    <section className="screen">
      <ScreenTitle eyebrow="Trust" title="Safeguards" subtitle="Every risk we found while designing Keynection, and what the prototype already does about it."
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
