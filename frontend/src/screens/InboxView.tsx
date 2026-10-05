import { useEffect, useState } from 'react'
import { CheckCheck, Hammer, Hand, Lock } from 'lucide-react'
import { api, type InboxItem, type UnitInfo } from '../api'
import { RELATION_LABEL } from '../messages'
import { Avatar, formatTime, shortRange, Skeleton, useToast } from '../ui'

// Simulated WhatsApp chat (dark theme). A real pilot would send these through the WhatsApp Cloud API.
export default function InboxView({ me, version, onChange }: { me: UnitInfo; version: number; onChange: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<InboxItem[] | null>(null)

  useEffect(() => {
    let live = true
    api.inbox(me.id).then((x) => live && setItems(x))
    return () => {
      live = false
    }
  }, [me.id, version])

  async function wave(item: InboxItem) {
    await api.waveBack(item.id, me.id)
    toast(`You waved back to ${item.from_name}`)
    onChange()
  }

  return (
    <section className="wa">
      <div className="wa-head">
        <Avatar name={me.resident_name} size={34} />
        <div className="grow">
          <strong>Neighbour circle · {me.label}</strong>
          <small>5 households · only people next to you</small>
        </div>
      </div>
      <div className="wa-body">
        <div className="wa-day"><Lock size={11} style={{ verticalAlign: -1 }} /> Phone numbers are shared only if both sides agree</div>
        {!items && <Skeleton lines={3} />}
        {items?.length === 0 && <div className="wa-day">No messages yet. When a neighbour says hello, it shows up here.</div>}
        {items?.map((m) => (
          <div key={m.id} className="bubble">
            <div className="bubble-from">
              {m.from_name} · {m.from_label} <span style={{ color: '#8696a0', fontWeight: 500 }}>({RELATION_LABEL[m.relation_to_me]})</span>
            </div>
            <div className="bubble-text">{m.message}</div>
            {m.renovation && (
              <div className="reno-card">
                <strong><Hammer size={12} style={{ verticalAlign: -1 }} /> Renovation notice</strong>
                <br />
                {m.renovation.scope} · {shortRange(m.renovation.start, m.renovation.end)}
                <br />
                Noisy work: {m.renovation.noisy_hours}
                <br />
                Contractor: {m.renovation.contractor || '–'}
                {m.renovation.contractor_cidb_registered ? ' · CIDB registered' : ''}
              </div>
            )}
            <div className="bubble-meta">
              {formatTime(m.created_at)} <CheckCheck size={14} color="#53bdeb" />
            </div>
            {m.acked_at ? (
              <div className="wa-done"><Hand size={14} /> You waved back</div>
            ) : (
              <div className="wa-actions">
                <button onClick={() => wave(m)}><Hand size={14} style={{ verticalAlign: -2 }} /> Wave back</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
