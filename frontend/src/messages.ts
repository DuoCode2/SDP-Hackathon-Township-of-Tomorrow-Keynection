import type { Lang, Relation, Renovation } from './api'
import { dateIn, noisyHours, tIn } from './i18n'

export type { Lang }

/** The languages a household can read in, and write its introduction or renovation notice in. */
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'zh', name: '中文' },
  { code: 'ta', name: 'தமிழ்' },
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
    case 'ta':
      // Written with AI help: a native speaker should review it before a pilot.
      return (
        `வணக்கம்! நான் ${label}-இல் வசிக்கும் ${name}. நாங்கள் இப்போதுதான் குடிவந்தோம் — உங்களைச் சந்தித்ததில் மகிழ்ச்சி!` +
        (r
          ? ` ${start} முதல் ${end} வரை எங்கள் வீட்டில் புதுப்பிப்பு வேலை (${r.scope}) நடக்கும். சத்தமான வேலை நேரம்: ${shown}. ` +
            `ஒப்பந்ததாரர்: ${contractor}. முன்கூட்டியே மன்னிக்கவும் — எப்போது வேண்டுமானாலும் எனக்குச் செய்தி அனுப்புங்கள்!`
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
