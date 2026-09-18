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
          initial={{ y: -60, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -60, opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_: any, info: any) => {
            if (info.offset.y < -25) {
              onClose();
            }
          }}
          onClick={onClick}
          style={{
            pointerEvents: 'auto',
            width: 'auto',
            maxWidth: 420,
            minWidth: 260,
            background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            borderRadius: 9999,
            padding: '7px 10px 7px 12px',
            boxShadow: '0 10px 30px rgba(124, 58, 237, 0.18), 0 3px 10px rgba(15, 23, 42, 0.08)',
            border: '1.5px solid #EDE9FE',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          {/* Animated Notification Bell Badge */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 14,
              flexShrink: 0,
              boxShadow: '0 3px 8px rgba(124, 58, 237, 0.35)',
              position: 'relative',
            }}
          >
            <span>🔔</span>
            <span
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#10B981',
                border: '1.5px solid #FFFFFF',
              }}
            />
          </div>

          {/* Title Only - single line with clean ellipsis */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#1E1B4B',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              }}
            >
              {notification.title}
            </span>
          </div>

          {/* Action indicator pill */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#7C3AED',
              background: '#F5F3FF',
              padding: '4px 9px',
              borderRadius: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <span>Ochish</span>
            <span style={{ fontSize: 10 }}>↗</span>
          </div>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Yopish"
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#F1F5F9',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#64748B',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
              transition: 'background 0.15s ease',
            }}
          >
            ✕
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
