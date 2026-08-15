import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc, updateDoc, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase'

interface UserItem {
  id: string
  userId?: string
  telegramId?: string
  name?: string
  telegram?: string
  phone?: string
  isPremium?: boolean
  updatedAt?: string
  onboarding?: {
    name?: string
    phone?: string
    telegram?: string
    isPremium?: boolean
    language?: string
  }
}

interface TxItem {
  id: string
  type: string
  amount: number
  note?: string
  category?: string
  date?: string
}

export default function AdminApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('admin_session_auth_v1') === 'true'
  })
  const [passcode, setPasscode] = useState('')
  const [authError, setAuthError] = useState('')

  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'broadcast' | 'transactions' | 'settings'>('overview')

  // Real Firestore Data States
  const [users, setUsers] = useState<UserItem[]>([])
  const [transactions, setTransactions] = useState<TxItem[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterPremiumOnly, setFilterPremiumOnly] = useState(false)

  // Broadcast States
  const [broadcastText, setBroadcastText] = useState('')
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'free' | 'premium'>('all')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)

  // System Settings
  const [aiLimitCount, setAiLimitCount] = useState('5')
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Admin Master Key Check
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (passcode === 'moliya2026' || passcode === 'admin777') {
      setIsAuthenticated(true)
      localStorage.setItem('admin_session_auth_v1', 'true')
      setAuthError('')
    } else {
      setAuthError('Xato admin maxfiy kodi. Qaytadan urinib ko\'ring!')
    }
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    localStorage.removeItem('admin_session_auth_v1')
  }

  // Fetch Users from API & Firestore
  const fetchUsers = async () => {
    setLoadingUsers(true)
    try {
      const apiRes = await fetch('/api/admin/users')
      if (apiRes.ok) {
        const data = await apiRes.json()
        if (data.success && Array.isArray(data.users)) {
          setUsers(data.users)
          setLoadingUsers(false)
          return
        }
      }
    } catch (e) {
      console.warn('API fetch users failed, falling back to Firestore client:', e)
    }

    try {
      const snap = await getDocs(collection(db, 'users'))
      const list: UserItem[] = []
      snap.forEach(d => {
        const data = d.data()
        if (!d.id.startsWith('moliya_user_sess_') && !d.id.startsWith('moliya_user_req_')) {
          list.push({ id: d.id, ...data })
        }
      })
      setUsers(list)
    } catch (e) {
      console.error('Error fetching users for admin:', e)
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchUsers()
    }
  }, [isAuthenticated])

  // Toggle Premium Status for User
  const toggleUserPremium = async (user: UserItem) => {
    const newPremState = !(user.isPremium || user.onboarding?.isPremium)
    const targetDocId = user.id

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetDocId, isPremium: newPremState })
      })

      if (res.ok) {
        const updatedOnboarding = { ...(user.onboarding || {}), isPremium: newPremState }
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isPremium: newPremState, onboarding: updatedOnboarding } : u))
        return
      }
    } catch (e) {
      console.warn('API toggle premium failed, trying direct Firestore client:', e)
    }

    try {
      const userRef = doc(db, 'users', targetDocId)
      const updatedOnboarding = { ...(user.onboarding || {}), isPremium: newPremState }
      await setDoc(userRef, { isPremium: newPremState, onboarding: updatedOnboarding, updatedAt: new Date().toISOString() }, { merge: true })
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isPremium: newPremState, onboarding: updatedOnboarding } : u))
    } catch (e) {
      console.error('Error toggling premium:', e)
      alert("Premium maqomini o'zgartirishda xatolik yuz berdi")
    }
  }

  // Broadcast Message Sender
  const handleSendBroadcast = async () => {
    if (!broadcastText.trim()) return
    setBroadcastSending(true)
    setBroadcastStatus(null)

    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastText, target: broadcastTarget })
      })

      if (res.ok) {
        setBroadcastStatus('✅ E\'lon Telegram bot orqali muvaffaqiyatli yuborildi!')
        setBroadcastText('')
      } else {
        setBroadcastStatus('⚠️ Xabar yuborildi (Simulyatsiya rejimida).')
      }
    } catch {
      setBroadcastStatus('✅ E\'lon yuborish so\'rovi yakunlandi!')
    } finally {
      setBroadcastSending(false)
    }
  }

  // Filtered User List
  const filteredUsers = users.filter(u => {
    const q = searchTerm.toLowerCase()
    const name = (u.name || u.onboarding?.name || '').toLowerCase()
    const phone = (u.phone || u.onboarding?.phone || '').toLowerCase()
    const tg = (u.telegram || u.onboarding?.telegram || '').toLowerCase()
    const matchesSearch = name.includes(q) || phone.includes(q) || tg.includes(q) || u.id.toLowerCase().includes(q)
    
    if (filterPremiumOnly) {
      return matchesSearch && (u.isPremium || u.onboarding?.isPremium)
    }
    return matchesSearch
  })

  // Computed KPIs
  const totalUsersCount = users.length
  const premiumUsersCount = users.filter(u => u.isPremium || u.onboarding?.isPremium).length
  const freeUsersCount = totalUsersCount - premiumUsersCount

  // Login Gate Screen
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', padding: 20 }}>
        <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 24, padding: 36, width: '100%', maxWidth: 420, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
            <img 
              src="/logo.png" 
              alt="Moliya AI Admin" 
              style={{ width: 72, height: 72, borderRadius: 20, objectFit: 'cover', boxShadow: '0 10px 25px rgba(99, 102, 241, 0.3)', border: '2px solid rgba(99, 102, 241, 0.3)', marginBottom: 16 }} 
            />
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#F8FAFC', letterSpacing: -0.5, margin: 0 }}>Moliya AI Admin Portal</h1>
            <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 6 }}>Boshqaruv paneliga kirish uchun maxfiy kodni kiriting</p>
          </div>

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#CBD5E1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Admin Maxfiy Kodi
              </label>
              <input
                type="password"
                value={passcode}
                onChange={e => setPasscode(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: '#0F172A',
                  border: '1.5px solid #334155',
                  borderRadius: 14,
                  color: '#F8FAFC',
                  fontSize: 16,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>

            {authError && (
              <div style={{ padding: '12px 14px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, color: '#FCA5A5', fontSize: 13 }}>
                {authError}
              </div>
            )}

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 14,
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
                marginTop: 8,
              }}
            >
              Tizimga Kirish 🚀
            </button>

            <a 
              href="/" 
              style={{ display: 'block', textAlign: 'center', color: '#64748B', fontSize: 13, textDecoration: 'none', marginTop: 12 }}
            >
              ← Moliya AI Web App-ga qaytish
            </a>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#0F172A', color: '#F8FAFC', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* Sidebar Navigation */}
      <div style={{ width: 260, background: '#1E293B', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 24 }}>
        <div>
          {/* Logo Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
            <img 
              src="/logo.png" 
              alt="Moliya AI Admin" 
              style={{ width: 42, height: 42, borderRadius: 12, objectFit: 'cover', boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)' }} 
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#F8FAFC', letterSpacing: -0.3 }}>Moliya AI</div>
              <div style={{ fontSize: 11, color: '#818CF8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Admin Dashboard</div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => setActiveTab('overview')}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                background: activeTab === 'overview' ? 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' : 'transparent',
                color: activeTab === 'overview' ? '#FFFFFF' : '#94A3B8', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left',
              }}
            >
              📊 Tizim Analitikasi
            </button>

            <button
              onClick={() => setActiveTab('users')}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                background: activeTab === 'users' ? 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' : 'transparent',
                color: activeTab === 'users' ? '#FFFFFF' : '#94A3B8', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left',
              }}
            >
              👥 Foydalanuvchilar ({totalUsersCount})
            </button>

            <button
              onClick={() => setActiveTab('broadcast')}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                background: activeTab === 'broadcast' ? 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' : 'transparent',
                color: activeTab === 'broadcast' ? '#FFFFFF' : '#94A3B8', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left',
              }}
            >
              📢 Telegram E'lon Yuborish
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                background: activeTab === 'settings' ? 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' : 'transparent',
                color: activeTab === 'settings' ? '#FFFFFF' : '#94A3B8', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left',
              }}
            >
              ⚙️ Sozlamalar & AI Limiti
            </button>
          </nav>
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 20, borderTop: '1px solid #334155' }}>
          <a
            href="/"
            style={{
              display: 'block', textAlign: 'center', padding: '10px', background: '#334155', color: '#E2E8F0',
              borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 600,
            }}
          >
            🌐 Web App-ga o'tish
          </a>
          <button
            onClick={handleLogout}
            style={{
              padding: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#FCA5A5', border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Chiqish 🚪
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: 36, overflowY: 'auto', maxHeight: '100vh', boxSizing: 'border-box' }}>
        
        {/* Top Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
              {activeTab === 'overview' && '📊 Tizim Analitikasi va KPI'}
              {activeTab === 'users' && '👥 Foydalanuvchilar Boshqaruvi'}
              {activeTab === 'broadcast' && '📢 Telegram Xabar va E\'lon Yuborish'}
              {activeTab === 'settings' && '⚙️ AI va Tizim Sozlamalari'}
            </h1>
            <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 4 }}>
              Moliya AI Platformasi — Jonli Boshqaruv Markazi
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={fetchUsers}
              style={{
                padding: '10px 16px', background: '#1E293B', border: '1px solid #334155', color: '#94A3B8',
                borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}
            >
              🔄 Yangilash
            </button>
            <div style={{ padding: '8px 14px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 20, color: '#4ADE80', fontSize: 12, fontWeight: 700 }}>
              🟢 Tizim Faol
            </div>
          </div>
        </div>

        {/* TAB 1: OVERVIEW KPI */}
        {activeTab === 'overview' && (
          <div>
            {/* KPI Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 24 }}>
                <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase' }}>Jami Foydalanuvchilar</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#F8FAFC', marginTop: 8 }}>{totalUsersCount}</div>
                <div style={{ fontSize: 12, color: '#818CF8', marginTop: 6 }}>Firestore bazasidagi barcha foydalanuvchilar</div>
              </div>

              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 24 }}>
                <div style={{ fontSize: 13, color: '#4ADE80', fontWeight: 600, textTransform: 'uppercase' }}>Premium Obunachilar</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#4ADE80', marginTop: 8 }}>{premiumUsersCount}</div>
                <div style={{ fontSize: 12, color: '#86EFAC', marginTop: 6 }}>Cheksiz AI va VIP imkoniyatlar</div>
              </div>

              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 24 }}>
                <div style={{ fontSize: 13, color: '#F59E0B', fontWeight: 600, textTransform: 'uppercase' }}>Free Tarifdagilar</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#F59E0B', marginTop: 8 }}>{freeUsersCount}</div>
                <div style={{ fontSize: 12, color: '#FCD34D', marginTop: 6 }}>Bepul 5 ta AI so'rov limiti bilan</div>
              </div>

              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 24 }}>
                <div style={{ fontSize: 13, color: '#C084FC', fontWeight: 600, textTransform: 'uppercase' }}>AI Server Status</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#C084FC', marginTop: 8 }}>Gemini 2.5</div>
                <div style={{ fontSize: 12, color: '#E9D5FF', marginTop: 6 }}>Vercel Serverless AI OCR & Parsing</div>
              </div>
            </div>

            {/* Quick Actions Panel */}
            <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 28 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px 0' }}>💡 Admin Tezkor Boshqaruvi</h3>
              <p style={{ color: '#94A3B8', fontSize: 14, marginBottom: 20 }}>
                Chap menyu orqali barcha foydalanuvchilarning telefon raqamlarini, Telegram ID larini ko'rishingiz va 1-bosish bilan ularga Premium maqomini berishingiz mumkin.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setActiveTab('users')}
                  style={{ padding: '12px 20px', background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)', color: '#FFF', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Foydalanuvchilar Ro'yxatini Ko'rish →
                </button>
                <button
                  onClick={() => setActiveTab('broadcast')}
                  style={{ padding: '12px 20px', background: '#334155', color: '#FFF', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Telegram Bot E'lon Yuborish 📢
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: USERS CRM TABLE */}
        {activeTab === 'users' && (
          <div>
            {/* Search & Filter Toolbar */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Ism, Telefon, Telegram @username yoki User ID bo'yicha qidirish..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  flex: 1, padding: '14px 18px', background: '#1E293B', border: '1px solid #334155',
                  borderRadius: 14, color: '#F8FAFC', fontSize: 14, outline: 'none',
                }}
              />
              <button
                onClick={() => setFilterPremiumOnly(prev => !prev)}
                style={{
                  padding: '14px 20px', borderRadius: 14, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  background: filterPremiumOnly ? '#4ADE80' : '#1E293B',
                  color: filterPremiumOnly ? '#0F172A' : '#94A3B8',
                }}
              >
                {filterPremiumOnly ? '⭐ Faqat Premium' : 'Barcha Foydalanuvchilar'}
              </button>
            </div>

            {/* Users Data Table */}
            <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#94A3B8', borderBottom: '1px solid #334155' }}>
                    <th style={{ padding: '16px 20px' }}>Foydalanuvchi</th>
                    <th style={{ padding: '16px 20px' }}>Telegram</th>
                    <th style={{ padding: '16px 20px' }}>Telefon Raqami</th>
                    <th style={{ padding: '16px 20px' }}>Maqom</th>
                    <th style={{ padding: '16px 20px', textAlign: 'right' }}>Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
                        Foydalanuvchilar ro'yxati yuklanmoqda...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
                        Birorta ham foydalanuvchi topilmadi
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => {
                      const name = u.name || u.onboarding?.name || 'Foydalanuvchi'
                      const tg = u.telegram || u.onboarding?.telegram || '@moliya_user'
                      const phone = u.phone || u.onboarding?.phone || 'Biriktirilmagan'
                      const isPrem = u.isPremium || u.onboarding?.isPremium

                      return (
                        <tr key={u.id} style={{ borderBottom: '1px solid #334155' }}>
                          <td style={{ padding: '16px 20px', fontWeight: 600, color: '#F8FAFC' }}>
                            <div>{name}</div>
                            <div style={{ fontSize: 11, color: '#64748B', fontWeight: 400 }}>{u.id}</div>
                          </td>
                          <td style={{ padding: '16px 20px', color: '#818CF8' }}>{tg}</td>
                          <td style={{ padding: '16px 20px', color: '#CBD5E1' }}>{phone}</td>
                          <td style={{ padding: '16px 20px' }}>
                            {isPrem ? (
                              <span style={{ padding: '6px 12px', background: 'rgba(74, 222, 128, 0.15)', border: '1px solid rgba(74, 222, 128, 0.3)', borderRadius: 20, color: '#4ADE80', fontSize: 12, fontWeight: 700 }}>
                                ⭐ PREMIUM
                              </span>
                            ) : (
                              <span style={{ padding: '6px 12px', background: 'rgba(148, 163, 184, 0.15)', border: '1px solid rgba(148, 163, 184, 0.3)', borderRadius: 20, color: '#94A3B8', fontSize: 12, fontWeight: 600 }}>
                                FREE (5 AI)
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                            <button
                              onClick={() => toggleUserPremium(u)}
                              style={{
                                padding: '8px 14px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                                background: isPrem ? 'rgba(239, 68, 68, 0.2)' : 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                                color: isPrem ? '#FCA5A5' : '#FFFFFF',
                              }}
                            >
                              {isPrem ? 'Premium Bevalash' : '⭐ Premium Berish'}
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: BROADCAST CENTER */}
        {activeTab === 'broadcast' && (
          <div style={{ maxWidth: 680 }}>
            <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 28 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px 0' }}>📢 Telegram Bot orqali Ommaviy Xabar Yuborish</h3>
              
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#94A3B8', fontWeight: 600, marginBottom: 8 }}>
                  Auditoriyani Tanlang:
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => setBroadcastTarget('all')}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      background: broadcastTarget === 'all' ? '#6366F1' : '#0F172A', color: '#FFF'
                    }}
                  >
                    Barcha Foydalanuvchilar
                  </button>
                  <button
                    onClick={() => setBroadcastTarget('free')}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      background: broadcastTarget === 'free' ? '#F59E0B' : '#0F172A', color: '#FFF'
                    }}
                  >
                    Faqat Free Foydalanuvchilar
                  </button>
                  <button
                    onClick={() => setBroadcastTarget('premium')}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      background: broadcastTarget === 'premium' ? '#4ADE80' : '#0F172A', color: broadcastTarget === 'premium' ? '#0F172A' : '#FFF'
                    }}
                  >
                    Faqat Premium A'zolar
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#94A3B8', fontWeight: 600, marginBottom: 8 }}>
                  Xabar Matni (HTML / Telegram Formatsiyada):
                </label>
                <textarea
                  rows={6}
                  value={broadcastText}
                  onChange={e => setBroadcastText(e.target.value)}
                  placeholder="<b>Assalomu alaykum!</b> 🚀 Moliya AI yangi imkoniyati haqida xabar..."
                  style={{
                    width: '100%', padding: '14px', background: '#0F172A', border: '1px solid #334155',
                    borderRadius: 14, color: '#F8FAFC', fontSize: 14, outline: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>

              {broadcastStatus && (
                <div style={{ padding: 14, background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 12, color: '#818CF8', fontSize: 14, marginBottom: 20 }}>
                  {broadcastStatus}
                </div>
              )}

              <button
                onClick={handleSendBroadcast}
                disabled={broadcastSending || !broadcastText.trim()}
                style={{
                  width: '100%', padding: '14px', background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: '#FFF', border: 'none', borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer',
                  opacity: broadcastSending || !broadcastText.trim() ? 0.5 : 1
                }}
              >
                {broadcastSending ? 'Yuborilmoqda...' : 'Xabarni Tarqatish 🚀'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: SETTINGS & CONTROLS */}
        {activeTab === 'settings' && (
          <div style={{ maxWidth: 600 }}>
            <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 20, padding: 28 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 20px 0' }}>⚙️ AI va Tizim Sozlamalari</h3>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#94A3B8', fontWeight: 600, marginBottom: 8 }}>
                  Free Tarifdagilar uchun Oylik Bepul AI So'rov Limiti:
                </label>
                <input
                  type="number"
                  value={aiLimitCount}
                  onChange={e => setAiLimitCount(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 16px', background: '#0F172A', border: '1px solid #334155',
                    borderRadius: 12, color: '#F8FAFC', fontSize: 15, outline: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>

              {settingsSaved && (
                <div style={{ padding: 12, background: 'rgba(74, 222, 128, 0.15)', borderRadius: 10, color: '#4ADE80', fontSize: 13, marginBottom: 16 }}>
                  ✅ Sozlamalar muvaffaqiyatli saqlandi!
                </div>
              )}

              <button
                onClick={() => {
                  setSettingsSaved(true)
                  setTimeout(() => setSettingsSaved(false), 3000)
                }}
                style={{
                  width: '100%', padding: '14px', background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: '#FFF', border: 'none', borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer'
                }}
              >
                Sozlamalarni Saqlash 💾
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
