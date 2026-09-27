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
          top: 12,
          left: 0,
          right: 0,
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 12px',
          pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ y: -60, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -60, opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_: any, info: any) => {
            if (info.offset.y < -20) onClose();
          }}
          onClick={onClick}
          style={{
            pointerEvents: 'auto',
            width: '100%',
            maxWidth: 380,
            background: 'rgba(255, 255, 255, 0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 16,
            padding: '10px 12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)',
            border: '1px solid rgba(0, 0, 0, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            userSelect: 'text',
          }}
        >
          {/* App icon */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            🔔
          </div>

          {/* Title + app name */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#7C3AED', letterSpacing: '0.01em' }}>
                Moliya AI
              </span>
              <span style={{ fontSize: 10, color: '#A0A0A0' }}>hozirgina</span>
            </div>
            <p style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#1A1A1A',
              margin: 0,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {notification.title}
            </p>
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.06)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: '#999',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
            }}
          >
            ✕
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
