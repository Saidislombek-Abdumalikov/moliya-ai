import React, { useState, useEffect } from 'react'
import { motion } from 'motion/react'

export interface CountdownResult {
  days: number
  hours: number
  minutes: number
  seconds: number
  isExpired: boolean
  isLifetime: boolean
  badgeText: string
  fullText: string
}

export function usePremiumCountdown(
  expiresAt: string | null | undefined,
  isLifetime: boolean = false
): CountdownResult {
  const calculate = (): CountdownResult => {
    if (isLifetime || !expiresAt) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: false,
        isLifetime: true,
        badgeText: 'Doimiy VIP',
        fullText: 'Cheksiz / Doimiy obuna',
      }
    }

    const expTime = new Date(expiresAt).getTime()
    const now = Date.now()
    const diff = expTime - now

    if (diff <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: true,
        isLifetime: false,
        badgeText: 'Muddati tugagan',
        fullText: 'Obuna muddati tugagan',
      }
    }

    const totalSeconds = Math.floor(diff / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    let badgeText = ''
    if (days >= 1) {
      badgeText = `${days}k ${hours}s ${minutes}d`
    } else if (hours >= 1) {
      badgeText = `${hours}s ${minutes}d ${seconds}s`
    } else {
      badgeText = `${minutes}d ${seconds}s`
    }

    const parts: string[] = []
    if (days > 0) parts.push(`${days} kun`)
    if (hours > 0 || days > 0) parts.push(`${hours} soat`)
    parts.push(`${minutes} daqiqa`)
    parts.push(`${seconds} soniya`)

    return {
      days,
      hours,
      minutes,
      seconds,
      isExpired: false,
      isLifetime: false,
      badgeText,
      fullText: parts.join(' '),
    }
  }

  const [countdown, setCountdown] = useState<CountdownResult>(calculate)

  useEffect(() => {
    setCountdown(calculate())
    const interval = setInterval(() => {
      setCountdown(calculate())
    }, 1000)

    return () => clearInterval(interval)
  }, [expiresAt, isLifetime])

  return countdown
}

/**
 * Format Uzbek date string: "11-oktabr, 2026 21:00"
 */
export function formatUzbekDateTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Cheksiz / Doimiy'
  try {
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate
    const months = [
      'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
      'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
    ]
    const day = d.getDate()
    const month = months[d.getMonth()]
    const year = d.getFullYear()
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${day}-${month}, ${year} ${hours}:${mins}`
  } catch {
    return isoDate
  }
}

/**
 * Compact Pill Badge for HomeScreen Top Navigation Bar
 */
export const PremiumCountdownBadge: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
  onClick?: () => void
}> = ({ expiresAt, isLifetime, onClick }) => {
  const cd = usePremiumCountdown(expiresAt, isLifetime)

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
        boxShadow: '0 2px 10px rgba(245, 158, 11, 0.15)',
        transition: 'all 0.2s ease',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 13 }}>👑</span>
      <span style={{ letterSpacing: -0.2 }}>
        VIP · {cd.badgeText}
      </span>
    </motion.button>
  )
}

/**
 * 4-Segment Live Digital Countdown Blocks
 * [ Days ] : [ Hours ] : [ Mins ] : [ Secs ]
 */
export const PremiumCountdownTimer: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
}> = ({ expiresAt, isLifetime }) => {
  const cd = usePremiumCountdown(expiresAt, isLifetime)

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
          Cheksiz Doimiy VIP Obuna
        </p>
        <p style={{ fontSize: 12, color: '#7E22CE', opacity: 0.85 }}>
          Hech qanday muddat cheklovisiz barcha AI imkoniyatlari faol!
        </p>
      </div>
    )
  }

  const timeBlocks = [
    { label: 'Kun', value: String(cd.days).padStart(2, '0') },
    { label: 'Soat', value: String(cd.hours).padStart(2, '0') },
    { label: 'Daqiqa', value: String(cd.minutes).padStart(2, '0') },
    { label: 'Soniya', value: String(cd.seconds).padStart(2, '0') },
  ]

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
        border: '1.5px solid #FDE68A',
        borderRadius: 20,
        padding: '16px 16px',
        marginBottom: 20,
        boxShadow: '0 4px 14px rgba(245, 158, 11, 0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#B45309',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>⏳</span> Tugashiga qoldi:
        </span>
        {expiresAt && (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#92400E', opacity: 0.85 }}>
            {formatUzbekDateTime(expiresAt)} gacha
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {timeBlocks.map((block, i) => (
          <div
            key={i}
            style={{
              background: '#FFFFFF',
              border: '1.5px solid #FCD34D',
              borderRadius: 14,
              padding: '10px 4px',
              textAlign: 'center',
              boxShadow: '0 2px 6px rgba(245, 158, 11, 0.06)',
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: '#78350F',
                letterSpacing: -0.5,
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {block.value}
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#B45309',
                marginTop: 3,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}
            >
              {block.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Interactive Banner for ProfileScreen VIP Card
 */
export const PremiumCountdownBanner: React.FC<{
  expiresAt: string | null | undefined
  isLifetime?: boolean
  onClick?: () => void
}> = ({ expiresAt, isLifetime, onClick }) => {
  const cd = usePremiumCountdown(expiresAt, isLifetime)

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
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
            VIP Premium Faol
          </p>
        </div>
        <p style={{ fontSize: 18, fontWeight: 900, color: '#FFFFFF', marginBottom: 3 }}>
          {cd.isLifetime ? 'Cheksiz / Doimiy' : `⏳ Qoldi: ${cd.badgeText}`}
        </p>
        <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
          {cd.isLifetime
            ? 'Barcha AI funksiyalar va hisobotlar cheksiz'
            : cd.fullText}
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
        Batafsil
      </button>
    </div>
  )
}
