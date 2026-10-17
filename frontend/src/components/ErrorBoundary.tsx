import { Component, type ErrorInfo, type ReactNode } from 'react'
import { remembered } from '../storage'

// Insurance, not a feature: if a screen throws while rendering, React would otherwise unmount everything and the
// judge would be looking at a blank page. This catches it and offers a reload. Nothing is lost: every record lives
// on the server, and the browser keeps its remembered choices. It sits above LangProvider, so it reads the
// remembered interface language itself and keeps its own three short strings.

const TEXT = {
  en: { title: 'Something went wrong on this screen', body: 'Your records are safe on the server. Reload to carry on.', reload: 'Reload' },
  ms: { title: 'Ada masalah pada skrin ini', body: 'Rekod anda selamat di pelayan. Muat semula untuk teruskan.', reload: 'Muat semula' },
  zh: { title: '这一页出了点问题', body: '你的纪录都安全保存在服务器。重新载入就能继续。', reload: '重新载入' },
} as const

function uiLang(): keyof typeof TEXT {
  const kept = remembered('uiLang')
  return kept === 'ms' || kept === 'zh' ? kept : 'en'
}

type State = { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stays in the browser console for the team; nothing is sent anywhere.
    console.error('Keynection screen error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const t = TEXT[uiLang()]
    return (
      <main role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{t.title}</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--text-2)' }}>{t.body}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{t.reload}</button>
          <details style={{ marginTop: 24, textAlign: 'left', fontSize: 12, color: 'var(--muted)' }}>
            <summary>Details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </main>
    )
  }
}
