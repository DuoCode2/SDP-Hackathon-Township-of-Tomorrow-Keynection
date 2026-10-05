export type Relation = 'left' | 'right' | 'across-left' | 'across' | 'across-right' | 'above' | 'below'

export interface UnitInfo {
  id: string
  phase_id: string
  kind: 'terrace' | 'apartment'
  label: string
  resident_name: string
  row: string | null
  facing_row: string | null
  block: string | null
  floor: number | null
  pos: number
}

export interface Neighbour extends UnitInfo {
  relation: Relation
}

export interface Renovation {
  scope: string
  start: string
  end: string
  noisy_hours: string
  noisy_from?: string
  noisy_to?: string
  weekdays_only?: boolean
  contractor?: string | null
  contractor_cidb_registered?: boolean | null
}

export interface GateEntry {
  allowed: boolean
  reason: string
  scanned_for: string
  created_at: string
}

export interface Pass {
  id: number
  intro_id: number
  unit_id: string
  contractor_name: string
  contractor_cidb: boolean
  valid_from: string
  valid_to: string
  entry_hours: string
  status: 'active' | 'revoked'
  created_at: string
  revoked_at: string | null
  gate_log: GateEntry[]
}

export interface WorkItem {
  intro_id: number
  from_unit_id: string
  from_label: string
  from_name: string
  relation_to_me: Relation | null
  renovation: Renovation
  neighbours_notified?: number
  prework_photos?: number
  passes?: Pass[]
}

export interface Works {
  mine: WorkItem[]
  nearby: WorkItem[]
  gate_hours: string
  house_rules: string[]
}

export interface GateResult {
  allowed: boolean
  reason: string
  scanned_for?: string
  pass: { contractor_name: string; contractor_cidb: boolean; unit_label: string; scope: string; valid_from: string; valid_to: string } | null
}

export interface ContractorView {
  status: string
  contractor_name: string
  unit_label: string
  scope: string
  start: string
  end: string
  noisy_hours: string
  entry_hours: string
  house_rules: string[]
  neighbours_notified: number
  prework_photos_on_record: number
}

export interface RepairCheck {
  aligned: boolean
  changed: boolean
  regions: Region[]
  verdict: 'restored' | 'still_changed' | 'unverified'
  compared_with: string
}

export interface WarrantyTicket {
  id: number
  unit_id: string
  unit_label: string
  resident_name: string
  incident_id: number | null
  subject: string
  status: 'open' | 'repair_submitted' | 'closed'
  subcontractor: string | null
  procore_ref: string | null
  defect_photo: Photo
  baseline_photo: Photo | null
  repair_photo: Photo | null
  repair_check: RepairCheck | null
  images: { before: string; after: string; overlay: string } | null
  owner_note: string | null
  reopen_count: number
  opened_at: string
  repaired_at: string | null
  closed_at: string | null
}

export interface InboxItem {
  id: number
  from_unit_id: string
  from_label: string
  from_name: string
  message: string
  lang: string
  renovation: Renovation | null
  created_at: string
  relation_to_me: Relation
  acked_at: string | null
}

export interface Quality {
  sharpness: number
  brightness: number
  width: number
  height: number
  checks: { sharp: boolean; well_lit: boolean; resolution: boolean }
  ok: boolean
}

export interface Photo {
  id: string
  unit_id: string
  kind: 'baseline' | 'followup'
  subject: string
  renovation_intro_id: number | null
  sha256: string
  width: number
  height: number
  quality: Quality
  created_at: string
  url: string
  thumb_url: string
}

export interface RenovationTask {
  intro_id: number
  from_unit_id: string
  from_label: string
  from_name: string
  relation_to_me: Relation
  renovation: Renovation
  needs_photo: boolean
  suggested_subject: string
  baseline: Photo | null
}

export type Suggestion = 'renovation' | 'warranty' | 'inspect' | 'no_change' | 'retake'
export type Decision = 'renovation' | 'warranty' | 'inspect' | 'no_action'

export interface Region {
  x: number
  y: number
  w: number
  h: number
  area_ratio: number
  shape: 'line' | 'patch'
}

export interface Incident {
  id: number
  reporter_unit_id: string
  reporter_label: string
  reporter_name: string
  renovation: { id: number; from_unit_id: string; from_label: string; from_name: string; renovation: Renovation | null } | null
  baseline: Photo
  followup: Photo
  comparison: { aligned: boolean; changed: boolean; change_ratio: number | null; regions: Region[] }
  hint: { suggestion: Suggestion; headline: string; reasons: string[] }
  images: { before: string; after: string; overlay: string } | null
  status: 'open' | 'decided'
  decision: Decision | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface Evidence {
  renovations: RenovationTask[]
  photos: Photo[]
  incidents: Incident[]
}

export interface HistoryEvent {
  id: number
  type: string
  payload: Record<string, unknown>
  created_at: string
  hash: string
}

export interface Dashboard {
  households: number
  intros_sent: number
  reply_rate: number | null
  households_with_a_known_neighbour: number
  renovations_registered: number
  renovations_with_prework_photos: number
  baseline_photos: number
  incidents: number
  incidents_decided: number
  decisions: Partial<Record<Decision, number>>
  passes_issued: number
  gate_allowed: number
  gate_denied: number
  warranty_open: number
  warranty_closed: number
  repairs_rejected: number
  home_histories_verified: number
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `${res.status}`
    try {
      const body = await res.json()
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024

export const api = {
  units: () => request<UnitInfo[]>('/api/units?phase_id=demo'),
  card: (unitId: string) =>
    request<{ neighbours: (Neighbour & { known: boolean })[]; known_count: number }>(`/api/units/${unitId}/card`),
  sendIntro: (body: { from_unit_id: string; message: string; lang: string; renovation?: Renovation }) =>
    request<{ id: number; recipients: string[] }>('/api/intros', json('POST', body)),
  inbox: (unitId: string) => request<InboxItem[]>(`/api/units/${unitId}/inbox`),
  waveBack: (introId: number, unitId: string) => request(`/api/intros/${introId}/ack`, json('POST', { unit_id: unitId })),

  evidence: (unitId: string) => request<Evidence>(`/api/units/${unitId}/evidence`),
  uploadPhoto: (unitId: string, file: File, kind: Photo['kind'], subject: string, renovationIntroId?: number) => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    form.append('subject', subject)
    if (renovationIntroId !== undefined) form.append('renovation_intro_id', String(renovationIntroId))
    return request<Photo>(`/api/units/${unitId}/photos`, { method: 'POST', body: form })
  },
  useDemoPhoto: (unitId: string, name: string, kind: Photo['kind'], subject: string, renovationIntroId?: number) =>
    request<Photo>(
      `/api/units/${unitId}/photos/demo`,
      json('POST', { name, kind, subject, renovation_intro_id: renovationIntroId ?? null }),
    ),
  reportIncident: (unitId: string, baselineId: string, followupId: string) =>
    request<Incident>(
      '/api/incidents',
      json('POST', { reporter_unit_id: unitId, baseline_photo_id: baselineId, followup_photo_id: followupId }),
    ),
  decide: (incidentId: number, decision: Decision, decidedBy: 'both_owners' | 'sdp_inspector', note: string) =>
    request<Incident>(`/api/incidents/${incidentId}/decision`, json('POST', { decision, decided_by: decidedBy, note })),

  works: (unitId: string) => request<Works>(`/api/units/${unitId}/works`),
  issuePass: (introId: number, unitId: string) =>
    request<Pass & { token: string; qr_payload: string }>(`/api/intros/${introId}/passes`, json('POST', { unit_id: unitId })),
  revokePass: (passId: number, unitId: string) => request<Pass>(`/api/passes/${passId}/revoke`, json('POST', { unit_id: unitId })),
  scan: (token: string, at?: string) => request<GateResult>('/api/gate/scan', json('POST', { token, at: at ?? null })),
  contractorView: (token: string) => request<ContractorView>(`/api/passes/view?token=${encodeURIComponent(token)}`),

  myWarranty: (unitId: string) => request<WarrantyTicket[]>(`/api/units/${unitId}/warranty`),
  warrantyQueue: () => request<WarrantyTicket[]>('/api/warranty?phase_id=demo'),
  submitDemoRepair: (ticketId: number, name: string, subcontractor: string) =>
    request<WarrantyTicket>(`/api/warranty/${ticketId}/repair/demo`, json('POST', { name, subcontractor })),
  respondToRepair: (ticketId: number, unitId: string, decision: 'accept' | 'reject', note: string) =>
    request<WarrantyTicket>(`/api/warranty/${ticketId}/owner`, json('POST', { unit_id: unitId, decision, note })),

  history: (unitId: string) =>
    request<{ events: HistoryEvent[]; chain_ok: boolean; first_bad_index: number | null }>(`/api/units/${unitId}/history`),
  dashboard: () => request<Dashboard>('/api/dashboard?phase_id=demo'),
  resetDemo: () => request('/api/demo/reset', { method: 'POST' }),
}
