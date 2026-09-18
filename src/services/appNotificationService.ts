import { supabase } from '../supabase';

export interface AppNotificationItem {
  id: string;
  title: string;
  message: string;
  imageUrl?: string | null;
  target: string; // 'all' | 'web' | 'telegram' | 'vip' | 'free' | userId
  actionUrl?: string | null;
  isPinned?: boolean;
  priority?: 'high' | 'normal';
  createdAt: string;
  isRead?: boolean;
}

const READ_STORAGE_KEY_PREFIX = 'moliya_read_notifs_';

export function getReadNotificationIds(userId?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const key = READ_STORAGE_KEY_PREFIX + (userId || 'anon');
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveReadNotificationIds(ids: Set<string>, userId?: string | null): void {
  if (typeof window === 'undefined') return;
  const key = READ_STORAGE_KEY_PREFIX + (userId || 'anon');
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {}
}

export function isEligibleNotification(
  notif: { target?: string },
  opts: { isTelegram: boolean; isPremium: boolean; userId?: string | null }
): boolean {
  const target = (notif.target || 'all').toLowerCase().trim();
  if (target === 'all') return true;
  if (target === 'telegram' && opts.isTelegram) return true;
  if (target === 'web' && !opts.isTelegram) return true;
  if (target === 'vip' && opts.isPremium) return true;
  if (target === 'free' && !opts.isPremium) return true;
  if (opts.userId && target === opts.userId.toLowerCase()) return true;
  return false;
}

/**
 * Fetch latest notifications targeted for this user
 */
export async function fetchUserNotifications(opts: {
  userId?: string | null;
  isPremium?: boolean;
  isTelegram?: boolean;
}): Promise<AppNotificationItem[]> {
  try {
    const { data, error } = await supabase
      .from('app_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(35);

    if (error || !data) {
      console.warn('[NOTIFS] Error fetching app notifications:', error?.message);
      return [];
    }

    const readIds = getReadNotificationIds(opts.userId);
    const isTelegram = Boolean(opts.isTelegram);
    const isPremium = Boolean(opts.isPremium);

    const filtered: AppNotificationItem[] = [];
    for (const item of data) {
      if (isEligibleNotification(item, { isTelegram, isPremium, userId: opts.userId })) {
        filtered.push({
          id: item.id,
          title: item.title || 'Moliya AI Xabarnomasi',
          message: item.message || '',
          imageUrl: item.image_url || null,
          target: item.target || 'all',
          actionUrl: item.action_url || null,
          isPinned: Boolean(item.is_pinned),
          priority: item.priority || 'high',
          createdAt: item.created_at || new Date().toISOString(),
          isRead: readIds.has(item.id)
        });
      }
    }

    return filtered;
  } catch (err) {
    console.error('[NOTIFS] Failed to fetch notifications:', err);
    return [];
  }
}

/**
 * Mark an individual notification as read
 */
export function markNotificationAsRead(notificationId: string, userId?: string | null): void {
  const readIds = getReadNotificationIds(userId);
  readIds.add(notificationId);
  saveReadNotificationIds(readIds, userId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('moliya_notification_read', { detail: { notificationId } }));
  }
}

/**
 * Mark all notifications as read
 */
export function markAllNotificationsAsRead(ids: string[], userId?: string | null): void {
  const readIds = getReadNotificationIds(userId);
  for (const id of ids) {
    readIds.add(id);
  }
  saveReadNotificationIds(readIds, userId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('moliya_notifications_all_read'));
  }
}

/**
 * Request Web browser notification permission (for Web App mode)
 */
export async function requestWebNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return false;
}

/**
 * Display native OS / Web push notification if permission granted
 */
export function triggerNativeWebNotification(title: string, message: string, actionUrl?: string | null): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body: message,
        icon: '/logo.png',
        badge: '/logo.png',
      });
      n.onclick = () => {
        window.focus();
        if (actionUrl) {
          if (actionUrl.startsWith('http')) {
            window.open(actionUrl, '_blank');
          } else {
            window.location.hash = actionUrl;
          }
        }
      };
    } catch {}
  }
}

/**
 * Real-time subscription to new notifications via Supabase Realtime
 */
export function subscribeToNotifications(
  opts: {
    userId?: string | null;
    isPremium?: boolean;
    isTelegram?: boolean;
  },
  onNewNotification: (notif: AppNotificationItem) => void
): () => void {
  try {
    const channelName = `live_notifs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_notifications' },
        (payload) => {
          const item = payload.new;
          if (item && isEligibleNotification(item, {
            isTelegram: Boolean(opts.isTelegram),
            isPremium: Boolean(opts.isPremium),
            userId: opts.userId
          })) {
            const formatted: AppNotificationItem = {
              id: item.id,
              title: item.title || 'Moliya AI Yangilik',
              message: item.message || '',
              imageUrl: item.image_url || null,
              target: item.target || 'all',
              actionUrl: item.action_url || null,
              isPinned: Boolean(item.is_pinned),
              priority: item.priority || 'high',
              createdAt: item.created_at || new Date().toISOString(),
              isRead: false
            };

            // Trigger Telegram Mini App haptic feedback if available
            try {
              const tg = (window as any).Telegram?.WebApp;
              if (tg?.HapticFeedback?.notificationOccurred) {
                tg.HapticFeedback.notificationOccurred('success');
              }
            } catch {}

            // Trigger Web Push notification if allowed
            triggerNativeWebNotification(formatted.title, formatted.message, formatted.actionUrl);

            onNewNotification(formatted);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn('[NOTIFS] Realtime subscription error:', err);
    return () => {};
  }
}
