import { useState } from 'react'
import { CircleCheck, Download, FileUp, ListChecks, TriangleAlert, Upload } from 'lucide-react'
import { api, ApiError, type ImportReport, type PhaseInfo } from '../api'
import { Card, CardHead, useToast } from '../ui'

const TEMPLATE = [
  'unit,label,type,street,row,facing_row,pos,block,floor,owner,handover,language',
  'C21-01,No. 1 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,north,south,1,,,Tan Ah Kow,2026-09-01,zh',
  'C21-03,No. 3 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,north,south,2,,,Siti Aminah,2026-09-01,ms',
  'C21-02,No. 2 Jln Contoh 2/1,terrace,Jalan Contoh 2/1,south,north,1,,,Rajesh Kumar,2026-09-01,ta',
  'C22-01,No. 1 Jln Contoh 2/2,semi-d,Jalan Contoh 2/2,,,1,,,Grace Ng,2026-09-03,en',
  'B-1-1,B-1-1,apartment,,,,1,B,1,Lim Mei Ling,1/9/2026,zh',
].join('\n') + '\n'

const COLUMNS: [string, string][] = [
  ['unit', 'SDP’s unit code, unique (letters, digits, - _ .)'],
  ['label', 'What neighbours see, e.g. “No. 1 Jln 2/1”'],
  ['type', 'terrace (landed, semi-d…) or apartment'],
  ['street', 'Terrace: the road it is on'],
  ['row / facing_row', 'Terrace: one row of houses, and the row across the road. Number both from the same end'],
  ['pos', 'Position along the row or floor, from 1. A gap keeps semi-D pairs apart'],
  ['block / floor', 'Apartment'],
  ['owner', 'Name on SDP’s record: only for the join form and the welcome pack'],
  ['handover', 'Vacant possession: 2026-09-01 or 1/9/2026'],
  ['language', 'en, ms, zh or ta (the owner can change it)'],
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
      setProblem(e instanceof Error ? e.message : 'Could not check the list')
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
      setProblem('The list is larger than 1 MB. Split the phase into two lists.')
      return
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer())
    } catch {
      setProblem('This file isn’t saved as UTF-8, so Chinese or Tamil names would be lost. In Excel: Save As → “CSV UTF-8 (Comma delimited)”.')
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
      toast(`${r.phase.name}: ${r.added} homes added, ${r.updated} corrected`)
      setFile(null)
      setReport(null)
      onImported(r.phase.id)
    } catch (e) {
      const sent = e instanceof ApiError && e.code === 'import'
      toast(sent ? 'Some lines need fixing first: check the list again' : e instanceof Error ? e.message : 'Could not save', 'error')
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
      <CardHead icon={<FileUp size={16} />} title="Import SDP’s handover list"
        sub="One row per home, as a CSV. Every line and every circle is checked before anything is saved." />
      <div className="grid-2">
        <label className="field">Phase
          <select value={target} onChange={(e) => { setTarget(e.target.value); setReport(null) }}>
            <option value="new">A new phase…</option>
            {phases.map((p) => <option key={p.id} value={p.id}>Add to {p.name} ({p.homes} homes)</option>)}
          </select>
        </label>
        {target === 'new' && (
          <label className="field">Name residents will see
            <input value={name} maxLength={80} placeholder="e.g. Taman Contoh Phase 2" onChange={(e) => { setName(e.target.value); setReport(null) }}
              onBlur={() => { if (file && !report) void check() }} />
          </label>
        )}
      </div>
      <div className="btn-row">
        <label className={`btn btn-sm file-btn ${busy || phaseName.length < 2 ? 'disabled' : ''}`}>
          <Upload size={14} /> {file ? `Choose another file (${file.name})` : 'Choose the CSV file'}
          <input type="file" accept=".csv,text/csv" disabled={busy || phaseName.length < 2}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
        </label>
        <button className="btn btn-sm" onClick={() => download('keynection-handover-list-template.csv', TEMPLATE)}><Download size={14} /> Template</button>
      </div>
      {phaseName.length < 2 && <small className="muted">Name the new phase first.</small>}
      <details className="import-help">
        <summary>What goes in each column</summary>
        <dl>{COLUMNS.map(([c, d]) => <div key={c}><dt className="mono">{c}</dt><dd>{d}</dd></div>)}</dl>
        <p className="small muted">Phone numbers, e-mails and IC numbers are left out on purpose: owners give their own contact details when they join.</p>
      </details>
      {problem && <div className="tone-check" role="alert"><TriangleAlert size={15} /><div>{problem}</div></div>}
      {busy && !report && <div className="mono muted">CHECKING EVERY LINE…</div>}

      {report && (
        <div className="import-report">
          <div className="kpi-mini">
            <div><b>{report.homes.toLocaleString('en-MY')}</b><span>homes in {phaseName} after saving</span></div>
            <div><b>{report.added}</b><span>new</span></div>
            <div><b>{report.updated}</b><span>corrected (not joined yet)</span></div>
            <div><b>{report.unchanged + report.kept}</b><span>already there, unchanged</span></div>
          </div>
          {(report.streets.length > 0 || report.blocks.length > 0) && (
            <div className="small muted">Streets: {report.streets.join(', ') || '–'} · Blocks: {report.blocks.join(', ') || '–'}</div>
          )}
          {blocking > 0 ? (
            <div className="import-issues errors" role="alert">
              <b><TriangleAlert size={14} /> {blocking} line(s) to fix before saving</b>
              <ul>{report.errors.map((e, i) => <li key={i}><span className="mono">{e.line ? `Line ${e.line}` : 'List'}</span> {e.message}</li>)}</ul>
              {report.more_errors > 0 && <small>…and {report.more_errors} more</small>}
            </div>
          ) : (
            <div className="import-ok"><CircleCheck size={15} /> Every line can be used.</div>
          )}
          {report.warnings.length > 0 && (
            <div className="import-issues warnings">
              <b>Worth a look ({report.warnings.length + report.more_warnings})</b>
              <ul>{report.warnings.map((w, i) => <li key={i}><span className="mono">{w.line ? `Line ${w.line}` : 'List'}</span> {w.message}</li>)}</ul>
            </div>
          )}
          <div className="bars">
            {Object.entries(report.circle_sizes).map(([size, n]) => (
              <div key={size} className="bar-row">
                <span>{size} neighbours</span>
                <i style={{ width: `${(n / maxBar) * 100}%` }} />
                <b>{n.toLocaleString('en-MY')}</b>
              </div>
            ))}
          </div>
          <details className="import-help" open={report.sample.length <= 12}>
            <summary><ListChecks size={14} /> Each home’s circle ({report.sample.length})</summary>
            <table className="zone-table">
              <tbody>{report.sample.map((h) => <tr key={h.unit}><td>{h.label}</td><td className="muted">{h.circle.join(', ') || 'no neighbours'}</td></tr>)}</tbody>
            </table>
          </details>
          <button className="btn btn-primary" disabled={busy || blocking > 0 || changes === 0} onClick={save}>
            <CircleCheck size={15} /> {changes === 0 ? 'Nothing new to save' : `Save ${changes} home(s) to ${phaseName}`}
          </button>
          <small className="muted">Saved under your name. A household that has joined keeps its place and its own name.</small>
        </div>
      )}
    </Card>
  )
}
