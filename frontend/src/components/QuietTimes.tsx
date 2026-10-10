import { useEffect, useState } from 'react'
import { BellOff, Plus, Trash2 } from 'lucide-react'
import { api, type QuietReason, type QuietTimes } from '../api'
import { useT } from '../i18n'
import { Card, CardHead, useToast } from '../ui'

const REASONS: QuietReason[] = ['baby', 'night_shift', 'work_from_home', 'elderly', 'other']
type Window = QuietTimes['windows'][number]

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** A household's quiet times: when noisy work next door should pause. Only this household sees them (and why); a
 * neighbour registering a renovation gets hours planned around them without learning whose they are. */
export default function QuietTimesCard({ unitId }: { unitId: string }) {
  const t = useT()
  const toast = useToast()
  const [data, setData] = useState<QuietTimes | null>(null)
  const [rows, setRows] = useState<Window[] | null>(null) // null: not editing
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setRows(null)
    api.quietTimes(unitId).then((d) => live && setData(d)).catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [unitId])
  if (!data) return null

  const change = (i: number, patch: Partial<Window>) => setRows((r) => r && r.map((w, j) => (j === i ? { ...w, ...patch } : w)))

  async function save() {
    if (!rows) return
    const total = rows.reduce((sum, w) => sum + minutes(w.end) - minutes(w.start), 0)
    if (rows.some((w) => w.end <= w.start) || total > data!.max_minutes) {
      toast(t('qt.limit', { n: data!.max_windows, h: data!.max_minutes / 60 }), 'error')
      return
    }
    setBusy(true)
    try {
      setData(await api.setQuietTimes(unitId, rows))
      setRows(null)
      toast(t('qt.saved'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="quiet-card">
      <CardHead icon={<BellOff size={16} />} title={t('qt.title')} sub={t('qt.sub')}
        right={rows === null && <button className="btn btn-sm" onClick={() => setRows(data.windows)}>{t(data.windows.length ? 'qt.edit' : 'qt.add')}</button>} />
      {rows === null ? (
        data.windows.length > 0 ? (
          <div className="quiet-chips">
            {data.windows.map((w) => <span key={w.start} className="quiet-chip">{w.start}–{w.end}{w.why ? ` · ${t(`qt.why.${w.why}`)}` : ''}</span>)}
          </div>
        ) : <p className="muted small">{t('qt.none')}</p>
      ) : (
        <div className="quiet-edit">
          {rows.map((w, i) => (
            <div key={i} className="quiet-row">
              <label className="field">{t('qt.from')}<input type="time" value={w.start} onChange={(e) => change(i, { start: e.target.value })} /></label>
              <label className="field">{t('qt.to')}<input type="time" value={w.end} onChange={(e) => change(i, { end: e.target.value })} /></label>
              <label className="field">{t('qt.why')}
                <select value={w.why ?? ''} onChange={(e) => change(i, { why: (e.target.value || null) as QuietReason | null })}>
                  <option value="">–</option>
                  {REASONS.map((r) => <option key={r} value={r}>{t(`qt.why.${r}`)}</option>)}
                </select>
              </label>
              <button className="icon-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('btn.remove')}><Trash2 size={14} /></button>
            </div>
          ))}
          {rows.length < data.max_windows && (
            <button className="btn btn-sm" onClick={() => setRows([...rows, { start: '13:00', end: '15:00', why: null }])}><Plus size={14} /> {t('qt.add')}</button>
          )}
          <small className="muted">{t('qt.limit', { n: data.max_windows, h: data.max_minutes / 60 })}</small>
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => setRows(null)}>{t('btn.cancel')}</button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{t('qt.save')}</button>
          </div>
        </div>
      )}
    </Card>
  )
}
