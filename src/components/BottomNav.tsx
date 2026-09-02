import React from 'react'
import type { Screen } from '../App'

interface Props {
  active: Screen
  onChange: (s: Screen) => void
  language?: 'uz' | 'uz_cyrl' | 'ru' | 'en'
}

const translations = {
  uz: {
    home: 'Asosiy',
    calendar: 'Taqvim',
    analytics: 'Tahlil',
    profile: 'Profil',
  },
  uz_cyrl: {
    home: 'Асосий',
    calendar: 'Тақвим',
    analytics: 'Таҳлил',
    profile: 'Профиль',
  },
  ru: {
    home: 'Главная',
    calendar: 'Календарь',
    analytics: 'Анализ',
    profile: 'Профиль',
  },
  en: {
    home: 'Home',
    calendar: 'Calendar',
    analytics: 'Analytics',
    profile: 'Profile',
  },
}

const tabs: { id: Screen; key: 'home' | 'calendar' | 'analytics' | 'profile'; icon: (a: boolean) => React.ReactNode }[] = [
  {
    id: 'home',
    key: 'home',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 10.5L12 3L21 10.5V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V10.5Z"
          fill={a ? '#EDE9FE' : 'none'}
          stroke={a ? '#6D28D9' : '#8278A8'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'calendar',
    key: 'calendar',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="17" rx="2.5" fill={a ? '#EDE9FE' : 'none'} stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" />
        <path d="M16 2V6M8 2V6M3 10H21" stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" strokeLinecap="round" />
        {a && (
          <circle cx="12" cy="15" r="1.5" fill="#6D28D9" />
        )}
      </svg>
    ),
  },
  {
    id: 'analytics',
    key: 'analytics',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="14" width="4" height="7" rx="1.5" fill={a ? '#EDE9FE' : 'none'} stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" />
        <rect x="10" y="9" width="4" height="12" rx="1.5" fill={a ? '#EDE9FE' : 'none'} stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" />
        <rect x="17" y="4" width="4" height="17" rx="1.5" fill={a ? '#EDE9FE' : 'none'} stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" />
      </svg>
    ),
  },
  {
    id: 'profile',
    key: 'profile',
    icon: (a) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" fill={a ? '#EDE9FE' : 'none'} stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" />
        <path d="M4 20C4 17.8 7.6 16 12 16C16.4 16 20 17.8 20 20" stroke={a ? '#6D28D9' : '#8278A8'} strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
]

export default function BottomNav({ active, onChange, language = 'uz' }: Props) {
  const lang = (language in translations) ? language : 'uz'
  const t = translations[lang as keyof typeof translations]

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 430,
        background: 'rgba(255,255,255,0.97)',
        WebkitBackdropFilter: 'blur(16px)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid #DBD4F0',
        paddingBottom: 'env(safe-area-inset-bottom, 12px)',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 0 6px' }}>
        {tabs.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              id={`nav_tab_${tab.id}`}
              onClick={() => onChange(tab.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 20px', borderRadius: 12, transition: 'opacity 0.15s',
              }}
            >
              {tab.icon(isActive)}
              <span style={{
                fontSize: 10, fontWeight: isActive ? 600 : 500,
                color: isActive ? '#6D28D9' : '#8278A8',
                fontFamily: 'inherit',
                letterSpacing: '0.01em',
              }}>
                {t[tab.key]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
