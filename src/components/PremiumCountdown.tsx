import React, { useState, useEffect } from 'react'
import { motion } from 'motion/react'

export interface PremiumDaysInfo {
  isPremium: boolean
  isLifetime: boolean
  isExpired: boolean
  remainingDays: number
  badgeLabel: string
  remainingText: string
  formattedExpiry: string
  statusBadge: string
  fullPlanName: string
}

export interface CountdownResult extends PremiumDaysInfo {
  days: number
  hours: number
  minutes: number
  seconds: number
  badgeText: string
  fullText: string
}

/**
 * Format clean localized expiration date string (e.g. "24-sentabr, 2026")
 * Does not include distracting seconds or minutes.
 */
export function formatExpiryDate(isoDate: string | null | undefined, lang: string = 'uz'): string {
  if (!isoDate) {
    if (lang === 'ru') return 'Бессрочно'
    if (lang === 'en') return 'Lifetime'
    if (lang === 'uz_cyrl') return 'Чексиз'
    return 'Cheksiz / Doimiy'
  }

  try {
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate

    const monthsUz = [
      'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
      'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
    ]
    const monthsUzCyrl = [
      'январ', 'феврал', 'март', 'апрел', 'май', 'июн',
      'июл', 'август', 'сентабр', 'октабр', 'ноябр', 'декабр'
    ]
    const monthsRu = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ]
    const monthsEn = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ]

    const day = d.getDate()
    const month = d.getMonth()
    const year = d.getFullYear()

    if (lang === 'ru') return `${day} ${monthsRu[month]} ${year} г.`
    if (lang === 'en') return `${monthsEn[month]} ${day}, ${year}`
    if (lang === 'uz_cyrl') return `${day}-${monthsUzCyrl[month]}, ${year}`
    return `${day}-${monthsUz[month]}, ${year}`
  } catch {
    return isoDate
  }
}

/**
 * Backwards-compatible alias for formatExpiryDate
 */
export function formatUzbekDateTime(isoDate: string | null | undefined): string {
  return formatExpiryDate(isoDate, 'uz')
}

/**
 * Centralized deterministic day-based premium calculation
 * Single source of truth across the entire Mini App.
 */
export function getPremiumDaysInfo(
  expiresAt: string | null | undefined,
  isLifetime: boolean = false,
  lang: string = 'uz'
): PremiumDaysInfo {
  if (isLifetime || !expiresAt) {
    return {
      isPremium: true,
      isLifetime: true,
      isExpired: false,
      remainingDays: 0,
      badgeLabel: '⭐ Full Premium',
      remainingText: lang === 'ru' ? 'Бессрочный' : (lang === 'en' ? 'Lifetime' : (lang === 'uz_cyrl' ? 'Чексиз / Доимий' : 'Cheksiz / Doimiy')),
      formattedExpiry: lang === 'ru' ? 'Бессрочный доступ' : (lang === 'en' ? 'Lifetime access' : (lang === 'uz_cyrl' ? 'Чексиз муддат' : 'Cheksiz obuna')),
      statusBadge: lang === 'ru' ? 'Активен' : (lang === 'en' ? 'Active' : 'Faol'),
      fullPlanName: 'Full Premium'
    }
  }

  const expTime = new Date(expiresAt).getTime()
  const now = Date.now()
  const diff = expTime - now

  if (diff <= 0) {
    return {
      isPremium: false,
      isLifetime: false,
      isExpired: true,
      remainingDays: 0,
      badgeLabel: 'Premium',
      remainingText: lang === 'ru' ? 'Срок действия истек' : (lang === 'en' ? 'Premium expired' : (lang === 'uz_cyrl' ? 'Премиум муддати тугаган' : 'Premium muddati tugagan')),
      formattedExpiry: formatExpiryDate(expiresAt, lang),
      statusBadge: lang === 'ru' ? 'Истек' : (lang === 'en' ? 'Expired' : 'Muddati tugagan'),
      fullPlanName: 'Full Premium'
    }
  }

  // Calculate remaining days cleanly with ceiling, never negative
  const remainingDays = Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)))

  let remainingText = ''
  if (remainingDays === 1) {
    remainingText = lang === 'ru' ? 'Остался 1 день' : (lang === 'en' ? '1 day remaining' : (lang === 'uz_cyrl' ? '1 кун қолди' : '1 kun qoldi'))
  } else {
    remainingText = lang === 'ru' ? `Осталось ${remainingDays} дн.` : (lang === 'en' ? `${remainingDays} days remaining` : (lang === 'uz_cyrl' ? `${remainingDays} кун қолди` : `${remainingDays} kun qoldi`))
  }

  return {
    isPremium: true,
    isLifetime: false,
    isExpired: false,
    remainingDays,
    badgeLabel: '⭐ Full Premium',
    remainingText,
    formattedExpiry: formatExpiryDate(expiresAt, lang),
    statusBadge: lang === 'ru' ? 'Активен' : (lang === 'en' ? 'Active' : 'Faol'),
    fullPlanName: 'Full Premium'
  }
}

/**
 * Hook to retrieve day-based premium status.
 * Replaces high-frequency 1000ms timer with clean relaxed periodic check.
 */
export function usePremiumCountdown(
  expiresAt: string | null | undefined,
  isLifetime: boolean = false,
  lang: string = 'uz'
): CountdownResult {
  const [info, setInfo] = useState<PremiumDaysInfo>(() => getPremiumDaysInfo(expiresAt, isLifetime, lang))

  useEffect(() => {
    setInfo(getPremiumDaysInfo(expiresAt, isLifetime, lang))

    // Check once every 60 seconds (no need for 1-second CPU burn)
    const interval = setInterval(() => {
      setInfo(getPremiumDaysInfo(expiresAt, isLifetime, lang))
    }, 60000)

    return () => clearInterval(interval)
  }, [expiresAt, isLifetime, lang])

  return {
    ...info,
    days: info.remainingDays,
    hours: 0,
    minutes: 0,
    seconds: 0,
    badgeText: info.remainingText,
    fullText: info.remainingText
  }
}

/**
 * Compact Pill Badge for HomeScreen Top Navigation Bar
 */
export const PremiumCountdownBadge: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
  onClick?: () => void
  lang?: string
}> = ({ onClick }) => {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
        border: '1.5px solid #FCD34D',
        borderRadius: 14,
        padding: '7px 12px',
        cursor: 'pointer',
        fontWeight: 700,
        color: '#92400E',
        fontSize: 12,
        fontFamily: 'inherit',
        boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)',
        transition: 'all 0.2s ease',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 13 }}>⭐</span>
      <span style={{ letterSpacing: -0.2 }}>Full Premium</span>
    </motion.button>
  )
}

export const PremiumNavBadge = PremiumCountdownBadge

/**
 * Clean Day Status Card for Modals (HomeScreen and ProfileScreen)
 * Communicates duration strictly in DAYS.
 * Eliminates digit counter boxes and ticking seconds.
 */
export const PremiumCountdownTimer: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
  lang?: string
}> = ({ expiresAt, isLifetime, lang = 'uz' }) => {
  const cd = usePremiumCountdown(expiresAt, isLifetime, lang)

  if (cd.isLifetime) {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, #FDF4FF 0%, #FAF5FF 100%)',
          border: '1.5px solid #E9D5FF',
          borderRadius: 18,
          padding: '16px 18px',
          textAlign: 'center',
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 4 }}>✨ 👑 ✨</div>
        <p style={{ fontSize: 16, fontWeight: 800, color: '#6B21A8', marginBottom: 4 }}>
          {lang === 'ru' ? 'Бессрочный Full Premium' : (lang === 'en' ? 'Lifetime Full Premium' : (lang === 'uz_cyrl' ? 'Чексиз Доимий VIP Обуна' : 'Cheksiz Doimiy VIP Obuna'))}
        </p>
        <p style={{ fontSize: 12, color: '#7E22CE', opacity: 0.85 }}>
          {lang === 'ru' ? 'Все AI функции доступны без ограничений по времени!' : (lang === 'en' ? 'All AI features are active with no expiration date!' : (lang === 'uz_cyrl' ? 'Ҳеч қандай муддат чекловсиз барча AI имкониятлари фаол!' : 'Hech qanday muddat cheklovisiz barcha AI imkoniyatlari faol!'))}
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
        border: '1.5px solid #FDE68A',
        borderRadius: 20,
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 4px 14px rgba(245, 158, 11, 0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#B45309',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>👑</span> Full Premium
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            padding: '3px 9px',
            borderRadius: 12,
            background: cd.isExpired ? '#FEE2E2' : '#D1FAE5',
            color: cd.isExpired ? '#DC2626' : '#059669',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {cd.statusBadge}
        </span>
      </div>

      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: '#78350F',
          letterSpacing: -0.4,
          marginBottom: 4,
        }}
      >
        {cd.remainingText}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', opacity: 0.85 }}>
        {lang === 'ru' ? 'Срок действия: ' : (lang === 'en' ? 'Expires: ' : (lang === 'uz_cyrl' ? 'Амал қилиш муддати: ' : 'Amal qilish muddati: '))}
        <span style={{ fontWeight: 700 }}>{cd.formattedExpiry}</span>
      </div>
    </div>
  )
}

export const PremiumDaysCard = PremiumCountdownTimer

/**
 * Interactive Banner for ProfileScreen VIP Card
 * Displays clean plan name, days remaining, and expiration date.
 */
export const PremiumCountdownBanner: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
  onClick?: () => void
  lang?: string
}> = ({ expiresAt, isLifetime, onClick, lang = 'uz' }) => {
  const cd = usePremiumCountdown(expiresAt, isLifetime, lang)

  return (
    <div
      onClick={onClick}
      style={{
        background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
        borderRadius: 20,
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(217, 119, 6, 0.25)',
        transition: 'transform 0.2s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -24,
          right: -24,
          width: 110,
          height: 110,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
        }}
      />
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 13 }}>👑</span>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.95)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Full Premium
          </p>
        </div>
        <p style={{ fontSize: 19, fontWeight: 900, color: '#FFFFFF', marginBottom: 3, letterSpacing: -0.3 }}>
          {cd.remainingText}
        </p>
        <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
          {cd.isLifetime
            ? (lang === 'ru' ? 'Все AI функции и отчеты без ограничений' : (lang === 'en' ? 'All AI features and reports unlimited' : (lang === 'uz_cyrl' ? 'Барча AI функциялар ва ҳисоботлар чексиз' : 'Barcha AI funksiyalar va hisobotlar cheksiz')))
            : `${lang === 'ru' ? 'Срок действия' : (lang === 'en' ? 'Expires' : (lang === 'uz_cyrl' ? 'Амал қилиш муддати' : 'Amal qilish muddati'))}: ${cd.formattedExpiry}`}
        </p>
      </div>

      <button
        style={{
          padding: '10px 16px',
          borderRadius: 12,
          border: 'none',
          background: 'rgba(255,255,255,0.22)',
          color: '#FFFFFF',
          fontSize: 13,
          fontWeight: 800,
          fontFamily: 'inherit',
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          flexShrink: 0,
          marginLeft: 12,
          zIndex: 2,
        }}
      >
        {lang === 'ru' ? 'Подробнее' : (lang === 'en' ? 'Details' : (lang === 'uz_cyrl' ? 'Батафсил' : 'Batafsil'))}
      </button>
    </div>
  )
}

export const PremiumStatusBanner = PremiumCountdownBanner

