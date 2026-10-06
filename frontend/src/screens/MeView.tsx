import { useEffect, useState } from 'react'
import {
  ArrowUpRight, BellOff, Ban, Check, Download, EyeOff, Hand, HandHeart, Hexagon, Languages, Lock, MessageCircle, ShieldHalf, Type, UserPlus, UserRound,
} from 'lucide-react'
import { api, type Delegate, type Lang, type Profile, type UnitInfo } from '../api'
import type { TabId } from '../guide'
import { refusal, useT } from '../i18n'
import { useActing } from '../helper'
import { roleOf } from '../components/Cast'
import { Avatar, Card, CardHead, ScreenTitle, Skeleton, useToast } from '../ui'
import { replayWelcome } from './CircleView'

const LANGS: { code: Lang; name: string }[] = [{ code: 'en', name: 'English' }, { code: 'ms', name: 'Bahasa Melayu' }, { code: 'zh', name: '中文' }]
const RELATIONS: Delegate['relation'][] = ['child', 'spouse', 'sibling', 'caregiver', 'other']

/** Profile and privacy: how neighbours see you, how reachable you are, who helps you, and your data. */
export default function MeView({ me, version, onChange, onGo }: { me: UnitInfo; version: number; onChange: () => void; onGo: (tab: TabId) => void }) {
  const t = useT()
  const toast = useToast()
  const [p, setP] = useState<Profile | null>(null)
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [tone, setTone] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.profile(me.id).then((x) => {
      if (!live) return
      setP(x)
      setBio(x.bio)
    })
    return () => {
      live = false
    }
  }, [me.id, version])

  async function update(patch: Partial<Omit<Profile, 'unit_id' | 'blocked'>>, done?: string) {
    setSaving(true)
    setTone(null)
    try {
      const x = await api.updateProfile(me.id, patch)
      setP(x)
      if (done) toast(done)
      onChange()
    } catch (e) {
      if (refusal(e)) setTone(refusal(e))
      else toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function unblock(id: string, name: string) {
    await api.setBlock(me.id, id, false)
    toast(t('me.unblocked', { name }))
    onChange()
  }

  if (!p) return <section className="screen"><Card><Skeleton lines={6} /></Card></section>

  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('me.eyebrow')} title={t('me.title')} subtitle={t('me.subtitle')} />
      <div className="cols">
        <div className="col">
          <Card>
            <div className="me-hero">
              <span className="story-ring big known"><Avatar name={me.resident_name} size={76} /></span>
              <div className="grow">
                <h2>{me.resident_name}</h2>
                <div className="profile-sub">{me.label} · {t('demo.role', { role: roleOf(me.id, t) })}</div>
                <div className="profile-bio">{p.bio ? `“${p.bio}”` : t('me.noBio')}</div>
              </div>
            </div>
            <label className="field">{t('me.bioField')}
              <input value={bio} maxLength={80} onChange={(e) => { setBio(e.target.value); setTone(null) }} placeholder={t('me.bioPlaceholder')} />
            </label>
            <div className="bio-foot">
              <span className="muted small">{t('me.bioFoot', { n: bio.length })}</span>
              <button className="btn btn-sm btn-primary" disabled={saving || bio === p.bio} onClick={() => update({ bio }, t('me.saved'))}><Check size={14} /> {t('btn.save')}</button>
            </div>
            {tone && <div className="tone-check"><Lock size={15} /><div><b>{t(`${tone}.title`)}</b>{t(`${tone}.body`)}</div></div>}
            <label className="field">{t('me.langField')}
              <select value={p.lang} onChange={(e) => update({ lang: e.target.value as Lang }, t('me.langSaved'))}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
          </Card>

          <Card>
            <CardHead icon={<ShieldHalf size={16} />} title={t('me.reach')} sub={t('me.reachSub')} />
            <ToggleRow icon={<UserPlus size={16} />} title={t('me.requests')} sub={t('me.requestsSub')}
              on={p.accept_requests} disabled={saving || p.quiet_mode} onChange={(v) => update({ accept_requests: v })} />
            <ToggleRow icon={<Hand size={16} />} title={t('me.waves')} sub={t('me.wavesSub')}
              on={p.allow_waves} disabled={saving || p.quiet_mode} onChange={(v) => update({ allow_waves: v })} />
            <ToggleRow icon={<BellOff size={16} />} title={t('me.quiet')} sub={t('me.quietSub')}
              on={p.quiet_mode} disabled={saving} onChange={(v) => update({ quiet_mode: v }, t(v ? 'me.quietOn' : 'me.quietOff'))} />
            <ToggleRow icon={<MessageCircle size={16} />} title={t('me.wa')} sub={t('me.waSub')}
              on={p.whatsapp_alerts} disabled={saving} onChange={(v) => update({ whatsapp_alerts: v })} />
            <ToggleRow icon={<Type size={16} />} title={t('me.easy')} sub={t('me.easySub')}
              on={p.easy_mode} disabled={saving} onChange={(v) => update({ easy_mode: v }, t(v ? 'me.easyOn' : 'me.easyOff'))} />
          </Card>

          <Helpers me={me} version={version} onChange={onChange} />
        </div>

        <div className="col sticky">
          <Card>
            <CardHead icon={<EyeOff size={16} />} title={t('me.see')} />
            <div className="share-grid">
              <div className="share yes"><UserRound size={16} /><div><b>{t('me.seeCircle')}</b>{t('me.seeCircleBody')}</div></div>
              <div className="share no"><Lock size={16} /><div><b>{t('me.seeOthers')}</b>{t('me.seeOthersBody')}</div></div>
              <div className="share no"><EyeOff size={16} /><div><b>{t('me.seeNobody')}</b>{t('me.seeNobodyBody')}</div></div>
            </div>
          </Card>

          <Card>
            <CardHead icon={<Ban size={16} />} title={t('me.blocked')} sub={t('me.blockedSub')} />
            {p.blocked.length === 0 ? <div className="small muted">{t('me.noneBlocked')}</div> : p.blocked.map((b) => (
              <div key={b.id} className="blocked-row">
                <Avatar name={b.resident_name} size={30} />
                <span className="grow"><b>{b.resident_name}</b> <span className="muted">· {b.label}</span></span>
                <button className="btn btn-sm" onClick={() => unblock(b.id, b.resident_name)}>{t('btn.unblock')}</button>
              </div>
            ))}
          </Card>

          <YourData me={me} />

          <Card>
            <CardHead icon={<Languages size={16} />} title={t('me.shortcuts')} />
            <button className="shortcut" onClick={() => onGo('log')}><Hexagon size={15} /> {t('me.myLog')} <ArrowUpRight size={14} /></button>
            <button className="shortcut" onClick={() => onGo('safeguards')}><ShieldHalf size={15} /> {t('me.safe')} <ArrowUpRight size={14} /></button>
            <button className="shortcut muted-shortcut" onClick={() => { replayWelcome(); onGo('circle') }}>{t('me.welcomeAgain')} <ArrowUpRight size={14} /></button>
            <button className="shortcut muted-shortcut" onClick={() => onGo('sdp')}>{t('me.sdp')} <ArrowUpRight size={14} /></button>
          </Card>
        </div>
      </div>
    </section>
  )
}

/** Family helpers: up to two people who may use Jiran5 for this household, each action recorded under their name. */
function Helpers({ me, version, onChange }: { me: UnitInfo; version: number; onChange: () => void }) {
  const t = useT()
  const toast = useToast()
  const { acting, setActing } = useActing()
  const [list, setList] = useState<Delegate[] | null>(null)
  const [name, setName] = useState('')
  const [relation, setRelation] = useState<Delegate['relation']>('child')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.delegates(me.id).then((x) => live && setList(x)).catch(() => live && setList([]))
    return () => {
      live = false
    }
  }, [me.id, version])

  async function add() {
    setBusy(true)
    setWhy(null)
    try {
      const d = await api.addDelegate(me.id, name.trim(), relation)
      toast(t('helpers.added', { name: d.name }))
      setName('')
      setConsent(false)
      onChange()
    } catch (e) {
      if (refusal(e)) setWhy(refusal(e))
      else toast(e instanceof Error ? e.message : 'Could not add', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(d: Delegate) {
    await api.revokeDelegate(d.id, me.id)
    if (acting?.id === d.id) setActing(null)
    toast(t('helpers.removed', { name: d.name }))
    onChange()
  }

  const full = (list?.length ?? 0) >= 2
  return (
    <Card>
      <CardHead icon={<HandHeart size={16} />} title={t('helpers.title')} sub={t('helpers.sub')} />
      {!list ? <Skeleton lines={2} /> : list.length === 0 ? <div className="small muted">{t('helpers.none')}</div> : list.map((d) => {
        const on = acting?.id === d.id
        return (
          <div key={d.id} className={`helper-row ${on ? 'on' : ''}`}>
            <span className="helper-initial" aria-hidden>{d.name.slice(0, 1).toUpperCase()}</span>
            <span className="grow"><b>{d.name}</b><small>{t(`relation.${d.relation}`)}</small></span>
            {on ? (
              <button className="btn btn-sm" onClick={() => setActing(null)}>{t('helpers.stop')}</button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => setActing({ unitId: me.id, id: d.id, name: d.name, relation: d.relation })}>{t('helpers.use', { name: d.name })}</button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => remove(d)}>{t('btn.remove')}</button>
          </div>
        )
      })}
      {list && !full && (
        <div className="helper-add">
          <div className="grid-2">
            <label className="field">{t('helpers.name')}<input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setWhy(null) }} /></label>
            <label className="field">{t('helpers.relation')}
              <select value={relation} onChange={(e) => setRelation(e.target.value as Delegate['relation'])}>
                {RELATIONS.map((r) => <option key={r} value={r}>{t(`relation.${r}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="switch-row consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('helpers.consent', { name: name.trim() || '…' })}</span>
          </label>
          {why && <div className="tone-check"><Lock size={15} /><div><b>{t(`${why}.title`)}</b>{t(`${why}.body`)}</div></div>}
          <button className="btn btn-sm btn-primary" disabled={busy || !consent || name.trim().length < 2} onClick={add}><UserPlus size={14} /> {t('helpers.add')}</button>
        </div>
      )}
      {full && <div className="small muted">{t('helpers.max')}</div>}
    </Card>
  )
}

/** PDPA: see everything Jiran5 holds about this household, as a file. */
function YourData({ me }: { me: UnitInfo }) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const blob = await api.exportData(me.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jiran5-my-data-${me.id}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast(t('data.downloading'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not prepare your data', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHead icon={<Download size={16} />} title={t('data.title')} sub={t('data.sub')} />
      <button className="btn btn-sm" disabled={busy} onClick={download}><Download size={14} /> {t('data.download')}</button>
      <div className="small muted">{t('data.note')}</div>
      <div className="small muted">{t('data.leave')}</div>
    </Card>
  )
}

function ToggleRow({ icon, title, sub, on, disabled, onChange }: { icon: React.ReactNode; title: string; sub: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
      <span className="toggle-icon">{icon}</span>
      <span className="grow"><b>{title}</b><small>{sub}</small></span>
      <input type="checkbox" className="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
