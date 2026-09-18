import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AppNotificationItem } from '../services/appNotificationService';

interface NotificationToastProps {
  notification: AppNotificationItem | null;
  onClose: () => void;
  onClick: () => void;
}

export default function NotificationToast({
  notification,
  onClose,
  onClick
}: NotificationToastProps) {
  if (!notification) return null;

  return (
    <AnimatePresence>
      <div
        style={{
          position: 'fixed',
          top: 14,
          left: 0,
          right: 0,
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 16px',
          pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ y: -70, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -70, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_: any, info: any) => {
            if (info.offset.y < -30) {
              onClose();
            }
          }}
          onClick={onClick}
          style={{
            pointerEvents: 'auto',
            width: '100%',
            maxWidth: 400,
            background: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(16px)',
            borderRadius: 20,
            padding: '12px 14px',
            boxShadow: '0 12px 36px rgba(124, 58, 237, 0.16), 0 4px 12px rgba(26, 21, 56, 0.08)',
            border: '1.5px solid #EDE9FE',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            cursor: 'pointer',
          }}
        >
          {/* Icon Badge */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 18,
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.28)',
            }}
          >
            🔔
          </div>

          {/* Text Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                Moliya AI
              </span>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>Hozirgina</span>
            </div>

            <p style={{ fontSize: 13, fontWeight: 700, color: '#1A1538', margin: '0 0 2px', lineHeight: 1.3, wordBreak: 'break-word' }}>
              {notification.title}
            </p>

            <p
              style={{
                fontSize: 12,
                color: '#64748B',
                margin: 0,
                lineHeight: 1.35,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {notification.message}
            </p>
          </div>

          {/* Dismiss Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#F1EEF9',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#64748B',
              cursor: 'pointer',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            ✕
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
