import type { Relation, Renovation } from './api'
import { dateIn, noisyHours, tIn } from './i18n'

export type Lang = 'en' | 'ms' | 'zh'

export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'zh', name: '中文' },
  // TODO: Tamil template (the team brief asks for four languages).
]

export const RELATION_LABEL: Record<Relation, string> = {
  left: 'left neighbour',
  right: 'right neighbour',
  'across-left': 'across the road',
  across: 'directly across',
  'across-right': 'across the road',
  above: 'upstairs',
  below: 'downstairs',
  'above-2': 'two floors up',
  'below-2': 'two floors down',
  contact: 'connected by request',
}

export function introTemplate(lang: Lang, name: string, label: string, renovation?: Renovation): string {
  const r = renovation
  const contractor = r?.contractor ? r.contractor : '-'
  // Dates and noisy hours in the message's own language, so a Chinese notice doesn't carry English inside it.
  const start = r ? dateIn(lang, r.start) : '', end = r ? dateIn(lang, r.end) : ''
  const shown = r ? noisyHours(tIn(lang), r) : ''
  const hours = shown.charAt(0).toLowerCase() + shown.slice(1) // mid-sentence: "only weekdays 09:00–17:00"
  switch (lang) {
    case 'ms':
      return (
        `Hai! Saya ${name} dari ${label}. Kami baru berpindah masuk — gembira berkenalan!` +
        (r
          ? ` Kami akan mengubah suai (${r.scope}) dari ${start} hingga ${end}. Kerja bising hanya ${hours}. ` +
            `Kontraktor: ${contractor}. Mohon maaf awal-awal — hubungi saya bila-bila masa!`
          : '')
      )
    case 'zh':
      return (
        `你好！我是 ${label} 的 ${name}，刚搬进来，很高兴认识你！` +
        (r
          ? `我们 ${start} 至 ${end} 会装修（${r.scope}），会吵的工程只在${hours}。` +
            `承包商：${contractor}。先说声不好意思，有事随时找我！`
          : '')
      )
    default:
      return (
        `Hi! I'm ${name} from ${label}. We've just moved in — nice to meet you!` +
        (r
          ? ` We'll be renovating (${r.scope}) from ${start} to ${end}. Noisy work only ${hours}. ` +
            `Contractor: ${contractor}. Sorry in advance — message me anytime!`
          : '')
      )
  }
}
