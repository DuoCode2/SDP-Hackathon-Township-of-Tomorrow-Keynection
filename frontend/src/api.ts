import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser'

export type Relation = 'left' | 'right' | 'across-left' | 'across' | 'across-right' | 'above' | 'below' | 'above-2' | 'below-2' | 'contact'
export type WorksType = 'wet' | 'hacking' | 'structural' | 'light'

export interface UnitInfo {
  id: string
  phase_id: string
  kind: 'terrace' | 'apartment'
  label: string
  /** Terrace houses: the road the house is on. */
  street?: string | null
  resident_name: string
  row: string | null
  facing_row: string | null
  block: string | null
  floor: number | null
  pos: number
  lang: Lang
  handover_date: string
  renovating?: boolean
  /** False until the household joins and agrees to the privacy notice; resident_name is then just the unit label. */
  joined: boolean
}

/** The language a household reads its messages in. Tamil covers what residents receive (quick replies, alerts,
 *  notices, the privacy notice); the screens themselves are in English, Malay and Chinese (UiLang). */
export type Lang = 'en' | 'ms' | 'zh' | 'ta'

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
  council_permit?: 'approved' | 'applied' | 'not_needed' | null
  permit_ref?: string | null
  works_type?: WorksType
  management_approval?: 'approved' | 'pending' | null
  /** Times inside the noisy hours kept quiet for neighbours, planned from their quiet times. */
  quiet_breaks?: TimeWindow[]
}

export interface TimeWindow {
  start: string
  end: string
}

export type QuietReason = 'baby' | 'night_shift' | 'work_from_home' | 'elderly' | 'other'

/** A household's own quiet times: private, used only to plan renovation hours around it. */
export interface QuietTimes {
  windows: (TimeWindow & { why?: QuietReason | null })[]
  max_windows: number
  max_minutes: number
}

/** Noisy hours planned around the quiet times of the homes a renovation reaches: times and counts, never whose. */
export interface QuietPlan {
  noisy_from: string
  noisy_to: string
  quiet_breaks: TimeWindow[]
  noisy_minutes: number
  homes_with_quiet_times: number
  avoided: number
  not_avoided: number
  /** Homes that would have works on two sides at once, and the first start date that avoids it. */
  double_works: { homes: number; clear_from: string } | null
}

/** Whether a notice's noisy hours keep clear of the reader's quiet times, fixed when it was sent. */
export type QuietState = 'avoided' | 'overlap' | null
/** Where the moment a concern was raised falls against the notice. */
export type Timing = 'within_hours' | 'quiet_break' | 'outside_hours' | 'not_a_work_day' | 'outside_dates'

/** A home outside your circle: its place in the phase, never its resident (unless you are connected). */
export interface NearbyHome extends Omit<UnitInfo, 'resident_name' | 'lang' | 'handover_date'> {
  hint: string
  hint_key: 'same_row' | 'across_road' | 'floors_above' | 'floors_below' | 'same_floor' | 'level'
  hint_n: number
  contact: 'none' | 'requested' | 'incoming' | 'connected' | 'declined'
  resident_name?: string
}

export interface Directory {
  circle: (Neighbour & { known: boolean; bio?: string; lang: Lang | null })[]
  nearby: NearbyHome[]
  works: string[]
  ring2_label: string
  township_homes: number
}

export interface ImpactItem extends Omit<UnitInfo, 'resident_name' | 'lang' | 'handover_date'> {
  relation: Relation
  reason: string
  reason_key: string
  resident_name?: string
}

export interface ContactRequest {
  id: number
  from: NearbyHome & { resident_name?: string }
  to: NearbyHome & { resident_name?: string }
  reason: string
  reason_label: string
  note: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  responded_at: string | null
  mine: boolean
}

export interface Notice {
  id: number
  audience: string
  title: string
  body: string
  author: string
  created_at: string
}

// Server text comes as English (the record) plus a code and values the app shows in the reader's language.
export type GateCode = 'unknown' | 'revoked' | 'not_started' | 'ended' | 'sunday' | 'outside_hours' | 'allowed'

export interface GateEntry {
  allowed: boolean
  reason: string
  reason_code: GateCode | null
  reason_values: Record<string, string>
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
  gate_open: string
  gate_close: string
  house_rules: string[]
  house_rule_codes: string[]
}

export interface GateResult {
  allowed: boolean
  reason: string
  reason_code: GateCode
  reason_values: Record<string, string>
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
  clock: WarrantyClock
}

export interface WarrantyClock {
  handover_date: string
  dlp_ends: string
  within_dlp: boolean
  dlp_months_left: number
  notice_date: string
  repair_due: string
  repair_days: number
  days_elapsed: number
  days_left: number
  overdue: boolean
  closed_on_time: boolean
}

export type ConcernStatus = 'open' | 'acknowledged' | 'resolved' | 'escalated' | 'closed_by_estate'
export type ConcernCategory = 'noise_hours' | 'debris' | 'access' | 'damage' | 'workers' | 'other'

export interface Concern {
  type: 'concern'
  id: number
  intro_id: number
  scope: string | null
  timing: Timing | null
  from_unit_id: string
  from_label: string
  from_name: string
  to_unit_id: string
  to_label: string
  to_name: string
  category: ConcernCategory
  category_label: string
  note: string
  status: ConcernStatus
  response_note: string | null
  estate_note: string | null
  reminders: number
  acted_by?: string | null
  created_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  escalated_at: string | null
  closed_at: string | null
  concerns_on_renovation?: number
}

export interface ChatMessage {
  type: 'message'
  id: number
  kind: 'text' | 'quick' | 'system' | 'voice'
  reactions: { emoji: string; unit_id: string }[]
  duration: number | null
  expired?: boolean
  sent_by?: string | null
  from_unit_id: string | null
  to_unit_id: string
  author: string | null
  text: string
  lang: Lang
  translated: boolean
  /** Translated by Claude (a typed message), not one of the pre-translated quick replies. */
  by_ai: boolean
  original: string | null
  created_at: string
  read_at: string | null
  // Automatic notices only: shown in the reader's language from these (text is the English record).
  code: string | null
  values: Record<string, string>
}

export interface ChatIntro {
  type: 'intro'
  id: number
  from_unit_id: string
  to_unit_id: string
  text: string
  lang: Lang
  acked_at: string | null
  created_at: string
  renovation: Renovation | null
  sent_by?: string | null
  /** For a reader of another language: text and renovation.scope are Claude's translation of these. */
  translated: boolean
  by_ai: boolean
  original: string | null
  original_scope: string | null
  quiet: QuietState
}

export interface ChatWave {
  type: 'wave'
  id: number
  from_unit_id: string
  to_unit_id: string
  created_at: string
  seen_at: string | null
}

export type ThreadItem = ChatMessage | ChatIntro | Concern | ChatWave

export interface Profile {
  unit_id: string
  bio: string
  accept_requests: boolean
  allow_waves: boolean
  quiet_mode: boolean
  lang: Lang
  easy_mode: boolean
  whatsapp_alerts: boolean
  joined: boolean
  blocked: { id: string; label: string; resident_name: string }[]
}

export interface JoinInfo {
  unit_id: string
  label: string
  kind: 'terrace' | 'apartment'
  phase: string
  suggested_name: string
  lang: Lang
  consent_version: string
  circle_size: number
  expires_at: string
}

export interface PaperNotice {
  id: number
  status: 'to_print' | 'printed' | 'delivered' | 'superseded'
  created_at: string
  printed_at: string | null
  delivered_at: string | null
  delivered_by: string | null
  unit_id: string
  unit_label: string
  lang: Lang
  intro_id: number
  from_label: string
  from_name: string
  sent_by: string | null
  message: string
  /** The message is printed in the household's language, translated by Claude. */
  translated?: boolean
  renovation: Renovation | null
}

export interface FrontDesk {
  households: number
  joined: number
  not_joined: { id: string; label: string; kind: string; code_issued_at: string | null; code_expires_at: string | null }[]
  paper_notices: PaperNotice[]
}

export interface WhatsAppOutbox {
  channel: 'whatsapp' | 'app' | 'paper'
  lang: Lang
  business_name?: string
  /** scheduled: an alert Keynection will send by itself at that time (a photo reminder, a check after the works). */
  messages: { at: string; kind: string; scheduled: boolean; text: string; buttons: string[] }[]
}

export interface PhaseLayout {
  lorongs: number
  houses_per_row: number
  facing: boolean
  blocks: number
  floors: number
  units_per_floor: number
}

export interface PhasePlan {
  homes: number
  terrace_homes: number
  apartment_homes: number
  circle_sizes: Record<string, number>
  avg_circle: number
  fewer_neighbours: number
  avg_ring2: number
  notice_zone: Record<WorksType, { avg: number; max: number }>
  took_ms: number
  checks: string[]
  units: { id: string; label: string; kind: string; circle: string[] }[]
}

export interface Official {
  name: string
  verified: boolean
  notices: Notice[]
  unread: number
}
export type ContactState = 'none' | 'requested_by_me' | 'requested_by_them' | 'mutual'

export type Preview =
  | { kind: 'renovation' } | { kind: 'wave' } | { kind: 'text'; text: string } | { kind: 'voice'; duration: number }
  | { kind: 'concern'; category: string } | { kind: 'system'; code: string; values: Record<string, string>; text: string }

export interface Conversation extends Neighbour {
  last: string | null  // English, for the record
  last_preview: Preview | null  // the same as data, shown in the reader's language
  last_at: string | null
  unread: number
  blocked: boolean
  contact: ContactState
  open_concerns: number
  renovating: boolean
}

export interface Thread {
  neighbour: Neighbour
  my_lang: Lang
  items: ThreadItem[]
  contact: ContactState
  blocked: boolean
  their_renovations: { intro_id: number; scope: string; start: string; end: string }[]
  quick_replies: { key: string; text: string; arrives?: string }[]
  concern_categories: Record<ConcernCategory, string>
}

export interface ModerationReport {
  id: number
  reason: string
  status: 'open' | 'warned' | 'dismissed'
  created_at: string
  message: { id: number; kind?: string; text: string; duration?: number | null; voice_url?: string | null; sent_at: string; from_label: string; from_name: string }
  reporter_label: string
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
export interface TriageCode {
  code: string
  shapes?: ('line' | 'patch')[]
  label?: string
  scope?: string
  taken?: string
  seen?: string
  start?: string
}

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
  // reasons: the English record; codes: the same reasons as data, so the app can show them in the reader's
  // language (cases recorded before codes existed have none, and fall back to the English).
  hint: { suggestion: Suggestion; headline: string; reasons: string[]; codes?: TriageCode[] }
  images: { before: string; after: string; overlay: string } | null
  // proposed: the neighbour says the renovation caused it and waits for the renovating owner;
  // disputed: the renovating owner disagreed, so an inspector (or a warranty claim) settles it.
  status: 'open' | 'proposed' | 'disputed' | 'decided'
  decision: Decision | null
  decision_note: string | null
  response_note: string | null
  proposed_at: string | null
  proposed_by: string | null
  decided_by: 'reporter' | 'renovating_owner' | 'both_owners' | null
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
  households_joined: number
  paper_notices_pending: number
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
  messages_sent: number
  contacts_shared: number
  concerns_raised: number
  noise_concerns: number
  quiet_times_kept: number
  quiet_times_missed: number
  concerns_settled_by_neighbours: number
  concerns_escalated: number
  concerns_with_estate: number
  reports_open: number
  warranty_overdue: number
  contact_requests: number
  contact_requests_accepted: number
  waves: number
  circle_pairs: number
  known_pairs: number
  days_to_first_hello: number | null
  households_reached_out: number
  active_circles_30d: number
}

export interface Delegate {
  id: number
  name: string
  relation: 'child' | 'spouse' | 'sibling' | 'caregiver' | 'other'
  created_at: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public suggestion?: string) {
    super(message)
  }
}

/** Demo or pilot mode, and in pilot mode who this phone is signed in as. */
export interface AuthMe {
  mode: 'demo' | 'pilot'
  signed_in: boolean
  kind?: 'household' | 'staff'
  unit_id?: string | null
  /** A household's phase. */
  phase_id?: string | null
  name?: string
  role?: 'estate' | 'sdp' | null
  /** How many digital keys (passkeys) this household or staff member has. */
  passkeys?: number
}

/** A phase of a township, with the streets and blocks notices can go to. */
export interface PhaseInfo {
  id: string
  name: string
  note: string | null
  imported_by: string | null
  imported_at: string | null
  homes: number
  joined: number
  streets: string[]
  blocks: string[]
}

/** What importing SDP's handover list would do (or did). Lines are the file's own line numbers. */
export interface ImportReport {
  errors: { line: number; message: string }[]
  more_errors: number
  warnings: { line: number; message: string }[]
  more_warnings: number
  homes: number
  added: number
  updated: number
  unchanged: number
  kept: number
  streets: string[]
  blocks: string[]
  circle_sizes: Record<string, number>
  sample: { unit: string; label: string; circle: string[] }[]
}

/** One welcome-pack card: the owner's own one-time join code. */
export interface WelcomeCard {
  unit_id: string
  label: string
  street: string | null
  block: string | null
  owner: string | null
  handover_date: string
  lang: Lang
  token: string
  expires_at: string
}

/** A WebAuthn ceremony the server started: the browser answers `options`, then sends back `challenge_id`. */
export interface KeyCeremony<T> {
  challenge_id: string
  options: T
}

/** Whether Claude is on for translation and notice writing on this server. */
export interface AiStatus {
  on: boolean
  model: string | null
}

/** One sentence turned into notice fields. Empty fields are left for the owner; "unsure" names what was dropped. */
export interface RenovationDraft {
  /** The language the owner wrote in: the notice is written in it, and each neighbour gets a translation. */
  language: Lang
  works_type: WorksType
  scope: string | null
  start: string | null
  end: string | null
  noisy_from: string | null
  noisy_to: string | null
  weekdays_only: boolean | null
  contractor: string | null
  why: string
  missing: string[]
  unsure: ('dates' | 'hours')[]
}

// Whether the server answered the last request. Screens show a loading skeleton until their data arrives,
// so without this a dropped connection would look like endless loading.
let reachable = true
const reachabilityListeners = new Set<(ok: boolean) => void>()
function setReachable(ok: boolean) {
  if (ok === reachable) return
  reachable = ok
  reachabilityListeners.forEach((f) => f(ok))
}
export function onReachability(listener: (ok: boolean) => void): () => void {
  reachabilityListeners.add(listener)
  listener(reachable)
  return () => { reachabilityListeners.delete(listener) }
}

// Online the whole site sits behind a shared password, and only that check answers 401. A 401 means this browser's
// sign-in has ended (a new password, or 30 days): go to the password page rather than leave screens empty.
// The fresh address skips any copy of the app the browser kept.
let signingIn = false
function signInAgain(status: number, path = '') {
  // A sign-in step that fails (a key or code refused) is answered on the sign-in screen itself, not by reloading.
  if (status !== 401 || signingIn || ['/api/auth/signin', '/api/auth/code', '/api/auth/passkeys'].some((p) => path.startsWith(p))) return
  signingIn = true
  window.location.replace(`/?signin=${Date.now()}`)
}

let phaseId = 'demo'
/** Which phase SDP's screens and the phase listing show (demo mode: the fictional one). */
export function setPhaseId(id: string): void {
  phaseId = id
}
const inPhase = (path: string) => `${path}${path.includes('?') ? '&' : '?'}phase_id=${encodeURIComponent(phaseId)}`

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    setReachable(false)  // network down, or nothing listening
    throw new ApiError(0, "Can't reach Keynection right now. Check your connection and try again.")
  }
  // 502–504 come from the dev proxy (or a gateway) when the API itself is down.
  setReachable(!(res.status >= 502 && res.status <= 504))
  signInAgain(res.status, path)
  if (!res.ok) {
    let message = `${res.status}`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (body.detail?.code) throw new ApiError(res.status, body.detail.message, body.detail.code, body.detail.suggestion)
      else message = Array.isArray(body.detail) ? (body.detail[0]?.msg ?? message) : JSON.stringify(body.detail)
    } catch (e) {
      if (e instanceof ApiError) throw e
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
  units: () => request<UnitInfo[]>(inPhase('/api/units')),
  phases: () => request<PhaseInfo[]>('/api/phases'),
  card: (unitId: string) =>
    request<{ neighbours: (Neighbour & { known: boolean })[]; known_count: number }>(`/api/units/${unitId}/card`),
  sendIntro: (body: { from_unit_id: string; message: string; lang: string; renovation?: Renovation; to_unit_ids?: string[]; delegate_id?: number }) =>
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
  decide: (incidentId: number, unitId: string, decision: Decision | 'dispute', note: string, delegateId?: number) =>
    request<Incident>(`/api/incidents/${incidentId}/decision`,
      json('POST', { unit_id: unitId, decision, note, delegate_id: delegateId ?? null })),

  works: (unitId: string) => request<Works>(`/api/units/${unitId}/works`),
  issuePass: (introId: number, unitId: string) =>
    request<Pass & { token: string; qr_payload: string }>(`/api/intros/${introId}/passes`, json('POST', { unit_id: unitId })),
  revokePass: (passId: number, unitId: string) => request<Pass>(`/api/passes/${passId}/revoke`, json('POST', { unit_id: unitId })),
  scan: (token: string, at?: string) => request<GateResult>('/api/gate/scan', json('POST', { token, at: at ?? null })),
  contractorView: (token: string) => request<ContractorView>(`/api/passes/view?token=${encodeURIComponent(token)}`),

  myWarranty: (unitId: string) => request<WarrantyTicket[]>(`/api/units/${unitId}/warranty`),
  warrantyQueue: () => request<WarrantyTicket[]>(inPhase('/api/warranty')),
  /** SDP's subcontractor photographs the finished repair (pilot); the owner still decides whether it is done. */
  submitRepair: (ticketId: number, subcontractor: string, file: File) => {
    const form = new FormData()
    form.append('subcontractor', subcontractor)
    form.append('file', file)
    return request<WarrantyTicket>(`/api/warranty/${ticketId}/repair`, { method: 'POST', body: form })
  },
  submitDemoRepair: (ticketId: number, name: string, subcontractor: string) =>
    request<WarrantyTicket>(`/api/warranty/${ticketId}/repair/demo`, json('POST', { name, subcontractor })),
  respondToRepair: (ticketId: number, unitId: string, decision: 'accept' | 'reject', note: string, delegateId?: number) =>
    request<WarrantyTicket>(`/api/warranty/${ticketId}/owner`, json('POST', { unit_id: unitId, decision, note, delegate_id: delegateId ?? null })),

  history: (unitId: string) =>
    request<{ events: HistoryEvent[]; chain_ok: boolean; first_bad_index: number | null }>(`/api/units/${unitId}/history`),
  dashboard: () => request<Dashboard>(inPhase('/api/dashboard')),

  directory: (unitId: string) => request<Directory>(`/api/units/${unitId}/directory`),
  impact: (unitId: string, works: WorksType) => request<ImpactItem[]>(`/api/units/${unitId}/impact?works_type=${works}`),
  requestContact: (from: string, to: string, reason: string, note: string) =>
    request<ContactRequest>('/api/contact-requests', json('POST', { from_unit_id: from, to_unit_id: to, reason, note })),
  contactRequests: (unitId: string) => request<{ incoming: ContactRequest[]; outgoing: ContactRequest[] }>(`/api/units/${unitId}/contact-requests`),
  respondContact: (id: number, unitId: string, accept: boolean) =>
    request<ContactRequest>(`/api/contact-requests/${id}/respond`, json('POST', { unit_id: unitId, accept })),
  notices: (unitId: string) => request<Notice[]>(`/api/units/${unitId}/notices`),
  allNotices: () => request<Notice[]>(inPhase('/api/notices')),
  postNotice: (audience: string, title: string, body: string) => request<Notice>(inPhase('/api/notices'), json('POST', { audience, title, body })),
  wave: (from: string, to: string) => request('/api/waves', json('POST', { from_unit_id: from, to_unit_id: to })),
  react: (messageId: number, unitId: string, emoji: string) =>
    request<{ emoji: string; unit_id: string }[]>(`/api/messages/${messageId}/react`, json('POST', { unit_id: unitId, emoji })),
  sendVoice: (from: string, to: string, blob: Blob, duration: number, delegateId?: number) => {
    const form = new FormData()
    if (delegateId) form.append('delegate_id', String(delegateId))
    form.append('from_unit_id', from)
    form.append('to_unit_id', to)
    form.append('duration', String(Math.max(1, Math.min(60, Math.round(duration)))))
    form.append('file', blob, 'voice')
    return request<ChatMessage>('/api/messages/voice', { method: 'POST', body: form })
  },
  voiceUrl: (messageId: number, unitId: string) => `/api/messages/${messageId}/voice?unit_id=${encodeURIComponent(unitId)}`,
  profile: (unitId: string) => request<Profile>(`/api/units/${unitId}/profile`),
  updateProfile: (unitId: string, patch: Partial<Omit<Profile, 'unit_id' | 'blocked'>>) =>
    request<Profile>(`/api/units/${unitId}/profile`, json('PUT', patch)),
  official: (unitId: string) => request<Official>(`/api/units/${unitId}/official`),
  delegates: (unitId: string) => request<Delegate[]>(`/api/units/${unitId}/delegates`),
  addDelegate: (unitId: string, name: string, relation: Delegate['relation'], consent: boolean) =>
    request<Delegate>(`/api/units/${unitId}/delegates`, json('POST', { name, relation, consent })),
  revokeDelegate: (id: number, unitId: string) => request(`/api/delegates/${id}/revoke`, json('POST', { unit_id: unitId })),
  exportData: async (unitId: string) => {
    const res = await fetch(`/api/units/${unitId}/export`)
    signInAgain(res.status)
    if (!res.ok) throw new ApiError(res.status, 'Could not prepare your data')
    return res.blob()
  },
  officialRead: (unitId: string) => request(`/api/units/${unitId}/official/read`, { method: 'POST' }),
  conversations: (unitId: string) => request<Conversation[]>(`/api/units/${unitId}/conversations`),
  thread: (unitId: string, otherId: string) => request<Thread>(`/api/units/${unitId}/conversations/${otherId}`),
  markRead: (unitId: string, otherId: string) => request(`/api/units/${unitId}/conversations/${otherId}/read`, { method: 'POST' }),
  aiStatus: () => request<AiStatus>('/api/ai'),
  authMe: () => request<AuthMe>('/api/auth/me'),
  signinOptions: () => request<KeyCeremony<PublicKeyCredentialRequestOptionsJSON>>('/api/auth/signin/options', { method: 'POST' }),
  signin: (challengeId: string, credential: AuthenticationResponseJSON) =>
    request<AuthMe>('/api/auth/signin', json('POST', { challenge_id: challengeId, credential })),
  signout: () => request<{ ok: boolean }>('/api/auth/signout', { method: 'POST' }),
  redeemCode: (token: string) => request<AuthMe>('/api/auth/code', json('POST', { token })),
  passkeyOptions: () => request<KeyCeremony<PublicKeyCredentialCreationOptionsJSON>>('/api/auth/passkeys/options', { method: 'POST' }),
  addPasskey: (challengeId: string, credential: RegistrationResponseJSON) =>
    request<{ ok: boolean; passkeys: number }>('/api/auth/passkeys', json('POST', { challenge_id: challengeId, credential })),
  reentryCode: (unitId: string) => request<{ token: string; expires_at: string }>(`/api/units/${unitId}/reentry-code`, { method: 'POST' }),
  addStaff: (name: string, role: 'estate' | 'sdp') =>
    request<{ staff_id: number; token: string; expires_at: string }>('/api/staff', json('POST', { name, role })),
  quietTimes: (unitId: string) => request<QuietTimes>(`/api/units/${unitId}/quiet-times`),
  setQuietTimes: (unitId: string, windows: QuietTimes['windows']) =>
    request<QuietTimes>(`/api/units/${unitId}/quiet-times`, json('PUT', { windows })),
  quietPlan: (unitId: string, r: { works_type: WorksType; start: string; end: string; noisy_from: string; noisy_to: string }) =>
    request<QuietPlan>(`/api/units/${unitId}/quiet-plan?${new URLSearchParams(r)}`),
  renovationDraft: (unitId: string, text: string) =>
    request<RenovationDraft>('/api/ai/renovation-draft', json('POST', { unit_id: unitId, text })),
  sendMessage: (from: string, to: string, msg: { body?: string; quick_key?: string; keep_tone?: boolean }, delegateId?: number) =>
    request<ChatMessage>('/api/messages', json('POST', { from_unit_id: from, to_unit_id: to, ...msg, delegate_id: delegateId ?? null })),
  reportMessage: (messageId: number, unitId: string, reason: string) =>
    request(`/api/messages/${messageId}/report`, json('POST', { unit_id: unitId, reason })),
  setBlock: (unitId: string, otherId: string, blocked: boolean) =>
    request(`/api/units/${unitId}/blocks`, json('POST', { other_unit_id: otherId, blocked })),
  shareContact: (unitId: string, otherId: string) =>
    request<{ contact: ContactState }>(`/api/units/${unitId}/contact`, json('POST', { other_unit_id: otherId })),
  raiseConcern: (from: string, introId: number, category: ConcernCategory, note: string, delegateId?: number) =>
    request<Concern>('/api/concerns', json('POST', { from_unit_id: from, intro_id: introId, category, note, delegate_id: delegateId ?? null })),
  concernStep: (id: number, step: 'acknowledge' | 'resolve' | 'escalate', unitId: string, note = '') =>
    request<Concern>(`/api/concerns/${id}/${step}`, json('POST', { unit_id: unitId, note })),
  estateConcerns: () => request<Concern[]>(inPhase('/api/estate/concerns')),
  estateAction: (id: number, action: 'remind' | 'resolve', note = '') =>
    request<Concern>(`/api/concerns/${id}/estate`, json('POST', { action, note })),
  reports: () => request<ModerationReport[]>('/api/moderation/reports'),
  reviewReport: (id: number, outcome: 'warned' | 'dismissed') => request(`/api/reports/${id}/review`, json('POST', { outcome })),
  resetDemo: () => request('/api/demo/reset', { method: 'POST' }),
  issueJoinCode: (unitId: string) => request<{ token: string; expires_at: string }>(`/api/units/${unitId}/join-code`, { method: 'POST' }),
  joinLookup: (token: string) => request<JoinInfo>('/api/join/lookup', json('POST', { token })),
  join: (body: { token: string; display_name: string; lang: Lang; consent: boolean; whatsapp_alerts: boolean; easy_mode: boolean }) =>
    request<UnitInfo>('/api/join', json('POST', body)),
  frontDesk: () => request<FrontDesk>(inPhase('/api/estate/frontdesk')),
  paperStep: (id: number, step: 'printed' | 'delivered', staff: string) =>
    request<PaperNotice>(`/api/paper-notices/${id}/${step}`, json('POST', { staff_name: staff })),
  estateRenovation: (body: { unit_id: string; staff_name: string; owner_signed: boolean; message: string; lang: Lang; renovation: Renovation }) =>
    request<{ id: number; recipients: string[]; paper_notices: string[] }>('/api/estate/renovations', json('POST', body)),
  whatsapp: (unitId: string) => request<WhatsAppOutbox>(`/api/units/${unitId}/whatsapp`),
  planPhase: (layout: PhaseLayout) => request<PhasePlan>('/api/planner/preview', json('POST', layout)),
  previewImport: (name: string, csv: string, existing?: string) =>
    request<ImportReport>('/api/phases/import/preview', json('POST', { name, csv, phase_id: existing ?? null })),
  saveImport: (name: string, csv: string, existing?: string) =>
    request<{ phase: PhaseInfo; added: number; updated: number; unchanged: number; kept: number }>(
      '/api/phases/import', json('POST', { name, csv, phase_id: existing ?? null })),
  pushKey: () => request<{ key: string }>('/api/push/key'),
  pushStatus: () => request<{ devices: number }>('/api/push/status'),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<{ devices: number }>('/api/push/subscriptions', json('POST', sub)),
  pushUnsubscribe: (endpoint: string) => request<{ devices: number }>('/api/push/subscriptions/remove', json('POST', { endpoint })),
  pushTest: () => request<{ sent: number; failed: number }>('/api/push/test', { method: 'POST' }),
  welcomeSheet: (from?: string, to?: string) =>
    request<{ phase: string; codes: WelcomeCard[] }>(`/api/phases/${encodeURIComponent(phaseId)}/join-codes`,
      json('POST', { handover_from: from || null, handover_to: to || null })),
}
