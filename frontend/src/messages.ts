import type { Relation, Renovation } from './api'

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
  switch (lang) {
    case 'ms':
      return (
        `Hai! Saya ${name} dari ${label}. Kami baru berpindah masuk — gembira berkenalan!` +
        (r
          ? ` Kami akan mengubah suai (${r.scope}) dari ${r.start} hingga ${r.end}. Kerja bising hanya ${r.noisy_hours}. ` +
            `Kontraktor: ${contractor}. Mohon maaf awal-awal — hubungi saya bila-bila masa!`
          : '')
      )
    case 'zh':
      return (
        `你好！我是 ${label} 的 ${name}，刚搬进来，很高兴认识你！` +
        (r
          ? `我们 ${r.start} 至 ${r.end} 会装修（${r.scope}），会吵的工程只在 ${r.noisy_hours}。` +
            `承包商：${contractor}。先说声不好意思，有事随时找我！`
          : '')
      )
    default:
      return (
        `Hi! I'm ${name} from ${label}. We've just moved in — nice to meet you!` +
        (r
          ? ` We'll be renovating (${r.scope}) from ${r.start} to ${r.end}. Noisy work only ${r.noisy_hours}. ` +
            `Contractor: ${contractor}. Sorry in advance — message me anytime!`
          : '')
      )
  }
}
