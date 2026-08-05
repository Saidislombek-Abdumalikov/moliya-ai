import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in UI boundary:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100dvh',
            padding: '24px',
            textAlign: 'center',
            background: '#FFFFFF',
            color: '#1E1A3C',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: '#FEF2F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              marginBottom: 16,
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.1)',
            }}
          >
            ⚠️
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#1E1A3C' }}>
            Xatolik yuz berdi
          </h2>
          <p style={{ fontSize: 14, color: '#8B82C4', maxWidth: 320, marginBottom: 24, lineHeight: 1.5 }}>
            Ilova ishlashida kutilmagan xatolik yuzaga keldi. Sahifani qayta yuklab ko'ring.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '14px 28px',
              borderRadius: 14,
              background: '#7C3AED',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(124, 58, 237, 0.3)',
            }}
          >
            Qayta yuklash
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
