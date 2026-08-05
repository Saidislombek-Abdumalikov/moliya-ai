import type { OnboardingResult } from './Onboarding'

interface Props {
  onboarding?: OnboardingResult | null
}

export default function AdminScreen({ onboarding }: Props) {
  const telegramId = ((onboarding as any)?.telegram || '').trim().toLowerCase()

  // Authorized Admin Telegram handles
  const ADMIN_HANDLES = ['@admin', '@jasur_moliya', '@saidislom']
  const isAdmin = telegramId !== '' && ADMIN_HANDLES.includes(telegramId)

  if (!isAdmin) {
    return (
      <div style={{ padding: 24, textAlign: 'center', marginTop: 100 }}>
        <h2 style={{ fontSize: 24, color: '#DC2626', fontWeight: 700 }}>Access Denied</h2>
        <p style={{ marginTop: 16, color: '#8B82C4' }}>You do not have permission to view this page. Telegram ID not found or mismatched.</p>
        <p style={{ marginTop: 8, color: '#1E1A3C', fontWeight: 600 }}>Your Telegram: {telegramId || 'Not Set'}</p>
        <button 
          onClick={() => window.location.href = '/'}
          style={{
            marginTop: 32, padding: '14px 24px', background: '#7C3AED', color: '#fff', 
            borderRadius: 12, border: 'none', fontWeight: 600, cursor: 'pointer'
          }}
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 20px', paddingBottom: 100 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1E1A3C', marginBottom: 24 }}>Admin Panel</h1>
      
      <div style={{ background: '#F5F4FA', borderRadius: 16, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 12 }}>Welcome, Admin</h2>
        <p style={{ color: '#8B82C4', fontSize: 14 }}>Your Telegram ID: <span style={{ color: '#7C3AED', fontWeight: 600 }}>{telegramId}</span> matches our records.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E4E1F4', borderRadius: 16, padding: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C', marginBottom: 16 }}>System Overview</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#FEF2F2', padding: 16, borderRadius: 12 }}>
            <p style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, textTransform: 'uppercase' }}>Users</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#991B1B', marginTop: 4 }}>1,024</p>
          </div>
          <div style={{ background: '#F0FDF4', padding: 16, borderRadius: 12 }}>
            <p style={{ fontSize: 12, color: '#16A34A', fontWeight: 600, textTransform: 'uppercase' }}>Active</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#14532D', marginTop: 4 }}>892</p>
          </div>
        </div>
      </div>
    </div>
  )
}
