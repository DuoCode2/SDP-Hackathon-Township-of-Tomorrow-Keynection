import { useState } from 'react'
import { CircleCheck, Download, FileUp, ListChecks, TriangleAlert, Upload } from 'lucide-react'
import { api, ApiError, type ImportReport, type PhaseInfo } from '../api'
import { useT } from '../i18n'
import { Card, CardHead, useToast } from '../ui'

const TEMPLATE = [
  'unit,label,type,street,row,facing_row,pos,block,floor,owner,handover,language',
  'C21-01,No. 1 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,north,south,1,,,Tan Ah Kow,2026-09-01,zh',
  'C21-03,No. 3 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,north,south,2,,,Siti Aminah,2026-09-01,ms',
  'C21-02,No. 2 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,south,north,1,,,Rajesh Kumar,2026-09-01,ta',
  'C22-01,No. 1 Jln Contoh 2/2,semi-d,Jalan Contoh 2/2,,,1,,,Grace Ng,2026-09-03,en',
  'B-1-1,B-1-1,apartment,,,,1,B,1,Lim Mei Ling,1/9/2026,zh',
].join('\n') + '\n'

// [the column as named in the CSV, the key of what goes in it: `sdp.imp.col.<key>`]
const COLUMNS: [string, string][] = [
  ['unit', 'unit'], ['label', 'label'], ['type', 'type'], ['street', 'street'], ['row / facing_row', 'row'],
  ['pos', 'pos'], ['block / floor', 'block'], ['owner', 'owner'], ['handover', 'handover'], ['language', 'language'],
]

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Pilot: a real phase from SDP's handover list. Every line and every circle is checked first; a list with any
 *  mistake can't be saved. Importing again adds homes and corrects homes still to join, never one that joined. */
export default function PhaseImport({ phases, current, onImported }: {
  phases: PhaseInfo[]
  current: PhaseInfo | null
  onImported: (phaseId: string) => void
}) {
  const t = useT()
  const toast = useToast()
  const [target, setTarget] = useState<string>(current?.id ?? 'new')
  const [name, setName] = useState('')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const existing = target === 'new' ? undefined : target
  const phaseName = (existing ? phases.find((p) => p.id === existing)?.name : name)?.trim() ?? ''

  async function check(text: string | undefined = file?.text) {
    if (!text || phaseName.length < 2) return
    setBusy(true)
    setProblem(null)
    try {
      setReport(await api.previewImport(phaseName, text, existing))
    } catch (e) {
      setReport(null)
      setProblem(e instanceof Error ? e.message : t('sdp.imp.err.check'))
    } finally {
      setBusy(false)
    }
  }

  async function pick(f: File | undefined) {
    setReport(null)
    setProblem(null)
    setFile(null)
    if (!f) return
    if (f.size > 1_000_000) {
      setProblem(t('sdp.imp.err.size'))
      return
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer())
    } catch {
      setProblem(t('sdp.imp.err.utf8'))
      return
    }
    setFile({ name: f.name, text })
    void check(text)
  }

  async function save() {
    if (!file || !report) return
    setBusy(true)
    try {
      const r = await api.saveImport(phaseName, file.text, existing)
      toast(t('sdp.imp.toast', { phase: r.phase.name, a: r.added, b: r.updated }))
      setFile(null)
      setReport(null)
      onImported(r.phase.id)
    } catch (e) {
      const sent = e instanceof ApiError && e.code === 'import'
      toast(sent ? t('sdp.imp.err.fix') : e instanceof Error ? e.message : t('sdp.imp.err.save'), 'error')
      if (sent) void check()
    } finally {
      setBusy(false)
    }
  }

  const blocking = (report?.errors.length ?? 0) + (report?.more_errors ?? 0)
  const changes = (report?.added ?? 0) + (report?.updated ?? 0)
  const maxBar = report ? Math.max(1, ...Object.values(report.circle_sizes)) : 1
  return (
    <Card className="import-card">
      <CardHead icon={<FileUp size={16} />} title={t('sdp.imp.title')} sub={t('sdp.imp.sub')} />
      <div className="grid-2">
        <label className="field">{t('sdp.imp.phase')}
          <select value={target} onChange={(e) => { setTarget(e.target.value); setReport(null) }}>
            <option value="new">{t('sdp.imp.newPhase')}</option>
            {phases.map((p) => <option key={p.id} value={p.id}>{t('sdp.imp.addTo', { name: p.name, n: p.homes })}</option>)}
          </select>
        </label>
        {target === 'new' && (
          <label className="field">{t('sdp.imp.name')}
            <input value={name} maxLength={80} placeholder={t('sdp.imp.name.eg')} onChange={(e) => { setName(e.target.value); setReport(null) }}
              onBlur={() => { if (file && !report) void check() }} />
          </label>
        )}
      </div>
      <div className="btn-row">
        <label className={`btn btn-sm file-btn ${busy || phaseName.length < 2 ? 'disabled' : ''}`}>
          <Upload size={14} /> {file ? t('sdp.imp.chooseAnother', { name: file.name }) : t('sdp.imp.choose')}
          <input type="file" accept=".csv,text/csv" disabled={busy || phaseName.length < 2}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
        </label>
        <button className="btn btn-sm" onClick={() => download('keynection-handover-list-template.csv', TEMPLATE)}><Download size={14} /> {t('sdp.imp.template')}</button>
      </div>
      {phaseName.length < 2 && <small className="muted">{t('sdp.imp.nameFirst')}</small>}
      <details className="import-help">
        <summary>{t('sdp.imp.columns')}</summary>
        <dl>{COLUMNS.map(([c, k]) => <div key={c}><dt className="mono">{c}</dt><dd>{t(`sdp.imp.col.${k}`)}</dd></div>)}</dl>
        <p className="small muted">{t('sdp.imp.noIc')}</p>
      </details>
      {problem && <div className="tone-check" role="alert"><TriangleAlert size={15} /><div>{problem}</div></div>}
      {busy && !report && <div className="mono muted">{t('sdp.imp.checking')}</div>}

      {report && (
        <div className="import-report">
          <div className="kpi-mini">
            <div><b>{report.homes.toLocaleString('en-MY')}</b><span>{t('sdp.imp.kpi.homes', { phase: phaseName })}</span></div>
            <div><b>{report.added}</b><span>{t('sdp.imp.kpi.new')}</span></div>
            <div><b>{report.updated}</b><span>{t('sdp.imp.kpi.corrected')}</span></div>
            <div><b>{report.unchanged + report.kept}</b><span>{t('sdp.imp.kpi.unchanged')}</span></div>
          </div>
          {(report.streets.length > 0 || report.blocks.length > 0) && (
            <div className="small muted">{t('sdp.imp.streets', { a: report.streets.join(', ') || '–', b: report.blocks.join(', ') || '–' })}</div>
          )}
          {blocking > 0 ? (
            <div className="import-issues errors" role="alert">
              <b><TriangleAlert size={14} /> {t('sdp.imp.toFix', { n: blocking.toLocaleString('en-MY') })}</b>
              <ul>{report.errors.map((e, i) => <li key={i}><span className="mono">{e.line ? t('sdp.imp.line', { n: e.line }) : t('sdp.imp.list')}</span> {e.message}</li>)}</ul>
              {report.more_errors > 0 && <small>{t('sdp.imp.more', { n: report.more_errors })}</small>}
            </div>
          ) : (
            <div className="import-ok"><CircleCheck size={15} /> {t('sdp.imp.ok')}</div>
          )}
          {report.warnings.length > 0 && (
            <div className="import-issues warnings">
              <b>{t('sdp.imp.warnings', { n: report.warnings.length + report.more_warnings })}</b>
              <ul>{report.warnings.map((w, i) => <li key={i}><span className="mono">{w.line ? t('sdp.imp.line', { n: w.line }) : t('sdp.imp.list')}</span> {w.message}</li>)}</ul>
            </div>
          )}
          <div className="bars">
            {Object.entries(report.circle_sizes).map(([size, n]) => (
              <div key={size} className="bar-row">
                <span>{t('sdp.ph.sizes.n', { size })}</span>
                <i style={{ width: `${(n / maxBar) * 100}%` }} />
                <b>{n.toLocaleString('en-MY')}</b>
              </div>
            ))}
          </div>
          <details className="import-help" open={report.sample.length <= 12}>
            <summary><ListChecks size={14} /> {t('sdp.imp.sample', { n: report.sample.length })}</summary>
            <table className="zone-table">
              <tbody>{report.sample.map((h) => <tr key={h.unit}><td>{h.label}</td><td className="muted">{h.circle.join(', ') || t('sdp.imp.noNeighbours')}</td></tr>)}</tbody>
            </table>
          </details>
          <button className="btn btn-primary" disabled={busy || blocking > 0 || changes === 0} onClick={save}>
            <CircleCheck size={15} /> {changes === 0 ? t('sdp.imp.nothing') : t('sdp.imp.save', { n: changes.toLocaleString('en-MY'), phase: phaseName })}
          </button>
          <small className="muted">{t('sdp.imp.saved')}</small>
        </div>
      )}
    </Card>
  )
}
