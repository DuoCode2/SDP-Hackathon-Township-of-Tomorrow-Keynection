import { useEffect, useState, type ReactNode } from 'react'
import { Ban, BellRing, Building2, Camera, ChevronDown, ChevronUp, CircleCheck, FileWarning, Fingerprint, Gavel, Hammer, HandHeart, Handshake, KeyRound, Link2, MailCheck, MessageSquareReply, MessageSquareWarning, ShieldAlert, ShieldCheck, StickyNote, ThumbsDown, Ticket, UserPlus, Wrench } from 'lucide-react'
import { api, type HistoryEvent, type UnitInfo } from '../api'
import { byWho, subjectText, useDates, useT, type Translate } from '../i18n'
import { Card, CardHead, ScreenTitle, Skeleton } from '../ui'

type Described = { icon: ReactNode; title: string; detail?: string; photo?: string }

/** One record in plain words, in the reader's language. What people typed is shown as written. */
function describe(t: Translate, dates: ReturnType<typeof useDates>, label: (id: string) => string, e: HistoryEvent): Described {
  const p = e.payload as Record<string, unknown>
  const s = (k: string) => String(p[k] ?? '')
  const note = p.note ? `“${s('note')}”` : ''
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ') || undefined
  switch (e.type) {
    case 'handover':
      return { icon: <KeyRound size={17} />, title: t('lg.handover'), detail: t('lg.handover.start') }
    case 'renovation_registered':
      return { icon: <Hammer size={17} />, title: t('lg.renovation'), detail: t('lg.renovation.d', { scope: s('scope'), dates: dates.range(s('start'), s('end')), n: (p.neighbours_notified as string[] | undefined)?.length ?? 0 }) }
    case 'photo_baseline':
      return { icon: <Camera size={17} />, title: t('lg.photo'), detail: `${subjectText(t, s('subject'))}${p.renovation_at ? t('lg.photo.before', { label: s('renovation_at') }) : ''}`, photo: `/api/photos/${s('photo_id')}?size=thumb` }
    case 'incident':
      return { icon: <FileWarning size={17} />, title: t('lg.incident', { n: String(p.incident_id ?? '').padStart(3, '0') }), detail: t('lg.incident.d', { n: s('regions') }) }
    case 'triage':
      if (p.stage === 'proposed') return { icon: <Gavel size={17} />, title: t('lg.proposed'), detail: join(t('lg.proposed.d'), note) }
      if (p.stage === 'disputed') return { icon: <Gavel size={17} />, title: t('lg.disputed'), detail: join(note) }
      return { icon: <Gavel size={17} />, title: t('lg.decided', { what: t(`lg.out.${s('decision')}`) }), detail: join(p.decided_by ? t(`lg.by.${s('decided_by')}`) : '', note) }
    case 'contractor_pass_issued':
      return { icon: <Ticket size={17} />, title: t('lg.pass'), detail: join(s('contractor'), dates.range(s('valid_from'), s('valid_to'))) }
    case 'contractor_pass_revoked':
      return { icon: <Ban size={17} />, title: t('lg.passRevoked'), detail: s('contractor') }
    case 'warranty_opened':
      return { icon: <Wrench size={17} />, title: t('lg.warranty', { n: String(p.ticket_id ?? '').padStart(3, '0') }), detail: subjectText(t, s('subject')) }
    case 'repair_submitted':
      return { icon: <Wrench size={17} />, title: t('lg.repair'), detail: t('lg.repair.d', { who: s('subcontractor'), check: t(`lg.check.${s('check') || 'unverified'}`) }) }
    case 'warranty_closed_by_owner':
      return { icon: <CircleCheck size={17} />, title: t('lg.accepted'), detail: note || t('lg.accepted.d') }
    case 'repair_rejected_by_owner':
      return { icon: <ThumbsDown size={17} />, title: t('lg.rejected'), detail: note || undefined }
    case 'concern_raised':
      return { icon: <MessageSquareWarning size={17} />, title: t('lg.concern', { what: t(`cat.${s('category')}`) }), detail: t('lg.concern.d', { from: label(s('raised_by')), about: label(s('about')) }) }
    case 'concern_acknowledged':
      return { icon: <MessageSquareReply size={17} />, title: t('lg.concernReply'), detail: note || undefined }
    case 'concern_resolved':
      return { icon: <Handshake size={17} />, title: t('lg.concernSorted'), detail: note || undefined }
    case 'concern_escalated':
      return { icon: <Building2 size={17} />, title: t('lg.concernEscalated'), detail: p.category ? t(`cat.${s('category')}`) : undefined }
    case 'estate_reminder':
      return { icon: <BellRing size={17} />, title: t('lg.estateReminder'), detail: note || undefined }
    case 'concern_closed_by_estate':
      return { icon: <CircleCheck size={17} />, title: t('lg.estateClosed'), detail: note || undefined }
    case 'delegate_added':
      return { icon: <HandHeart size={17} />, title: t('lg.helperAdded', { name: byWho(t, `${s('name')} (${s('relation')})`) }) }
    case 'delegate_removed':
      return { icon: <HandHeart size={17} />, title: t('lg.helperRemoved', { name: s('name') }) }
    case 'join_code_issued':
      return { icon: <KeyRound size={17} />, title: t('lg.joinCode') }
    case 'joined':
      return { icon: <UserPlus size={17} />, title: t('lg.joined') }
    case 'digital_key_added':
      return { icon: <KeyRound size={17} />, title: t('lg.key') }
    case 'reentry_code_issued':
      return { icon: <KeyRound size={17} />, title: t('lg.reentry') }
    case 'signed_in_again':
      return { icon: <KeyRound size={17} />, title: t('lg.signedAgain') }
    case 'account_closed':
      return { icon: <UserPlus size={17} />, title: t('lg.closed'), detail: s('by') === 'household' ? t('lg.closed.self') : t('lg.closed.estate', { by: s('by') }) }
    case 'procore_linked':
      return { icon: <Wrench size={17} />, title: t('lg.procore', { n: String(p.ticket_id ?? '').padStart(3, '0') }), detail: s('procore_ref') }
    case 'notice_delivered_on_paper':
      return { icon: <MailCheck size={17} />, title: t('lg.paper'), detail: t('lg.paper.d', { to: s('delivered_to'), by: s('delivered_by') }) }
    default:
      return { icon: <StickyNote size={17} />, title: t('lg.other') }
  }
}

export default function HistoryView({ me, units, version }: { me: UnitInfo; units: UnitInfo[]; version: number }) {
  const t = useT()
  const dates = useDates()
  const [data, setData] = useState<{ events: (HistoryEvent & { prev_hash?: string })[]; chain_ok: boolean } | null>(null)
  const [technical, setTechnical] = useState(false)

  useEffect(() => {
    let live = true
    api.history(me.id).then((h) => live && setData(h))
    return () => {
      live = false
    }
  }, [me.id, version])

  // Records name homes by their id ("T-11"); people know them by the house number.
  const label = (id: string) => units.find((u) => u.id === id)?.label ?? id
  const latest = data?.events[data.events.length - 1]

  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('log.eyebrow', { label: me.label })} title={t('nav.log')} />
      {!data ? (
        <Skeleton lines={5} />
      ) : (
        <div className="cols">
          <div className="col">
            <Card>
              <CardHead icon={<StickyNote size={16} />} title={t('log.what')} />
              <p className="small dim" style={{ margin: 0, lineHeight: 1.6 }}>{t('log.whatBody', { label: me.label })}</p>
            </Card>
            <div className={`chain-banner ${data.chain_ok ? 'ok' : 'bad'}`} role={data.chain_ok ? undefined : 'alert'}>
              {data.chain_ok ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
              <div>
                <strong>{t(data.chain_ok ? 'log.ok' : 'log.bad')}</strong>
                <p>{!data.chain_ok ? t('log.badSub') : data.events.length === 1 ? t('log.okSub1') : t('log.okSub', { n: data.events.length })}</p>
              </div>
            </div>

            <div className="section-label">{t('log.newestFirst')}</div>
            <ol className="blocks">
              {[...data.events].reverse().map((e, i, arr) => {
                const d = describe(t, dates, label, e)
                const actedBy = (e.payload as Record<string, unknown>).acted_by
                const who = actedBy ? String(actedBy) : ''  // a family helper or staff member acting for the home
                return (
                  <li key={e.id} className="block">
                    <div className="block-rail">
                      <div className="block-icon">{d.icon}</div>
                      {i < arr.length - 1 && <div className="block-link" />}
                    </div>
                    <div className="block-body">
                      <div className="card-row">
                        <div className="grow block-title">{d.title}</div>
                        {/* Handover is dated by vacant possession, the date the warranty clock counts from. */}
                        <span className="muted small">{dates.date(e.type === 'handover' && e.payload.vacant_possession ? String(e.payload.vacant_possession) : e.created_at)}</span>
                      </div>
                      {(d.detail || who) && <div className="small dim">{d.detail}{who ? t('log.by', { who: byWho(t, who) }) : ''}</div>}
                      {d.photo && <img src={d.photo} alt="" loading="lazy" decoding="async" />}
                      {technical && (
                        <div className="block-hash">
                          <span>#{String(arr.length - i).padStart(3, '0')}</span>
                          <span>HASH <b>{e.hash.slice(0, 24)}…</b></span>
                          <span>PREV {(e.prev_hash ?? '').slice(0, 24)}…</span>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="col sticky">
            <button className="btn btn-block" onClick={() => setTechnical((x) => !x)} aria-expanded={technical}>
              <Fingerprint size={15} /> {t(technical ? 'log.tech.hide' : 'log.tech.show')} {technical ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {technical && (
              <>
                <Card>
                  <CardHead icon={<Link2 size={16} />} title={data.chain_ok ? 'CHAIN CHECKED' : 'CHAIN BROKEN'} sub={t('log.tech.chainSub')} />
                  <div className="chain-viz" aria-hidden>
                    {data.events.map((e, i) => (
                      <span key={e.id} className="chain-node" style={{ ['--i' as string]: i }}>
                        <i>{e.hash.slice(0, 2)}</i>
                      </span>
                    ))}
                  </div>
                  {latest && (
                    <div className="hash-box">
                      <span><Fingerprint size={12} /> {t('log.tech.latest')}</span>
                      <code>{latest.hash}</code>
                    </div>
                  )}
                </Card>
                <Card>
                  <CardHead icon={<ShieldCheck size={16} />} title={t('log.tech.title')} />
                  <ol className="how">
                    <li>{t('log.tech.p1')}</li>
                    <li>{t('log.tech.p2')}</li>
                    <li>{t('log.tech.p3')}</li>
                  </ol>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
