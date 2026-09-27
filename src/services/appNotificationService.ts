import {readSessionToken} from '../clientSession';

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

/**
 * Fetch latest notifications targeted for this user
 */
export async function fetchUserNotifications(opts: {
  userId?: string | null;
  isPremium?: boolean;
  isTelegram?: boolean;
}): Promise<AppNotificationItem[]> {
  const token=readSessionToken();
  if(!opts.userId||!token)return [];
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('/api/auth?action=notifications&platform='+(opts.isTelegram?'telegram':'web'),{
      headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'
    });
    if(!response.ok)return [];
    const data=await response.json();
    if(token!==readSessionToken()||!Array.isArray(data))return [];
    const readIds=getReadNotificationIds(opts.userId);
    return data.map(item=>({id:item.id,title:item.title||'Moliya AI',message:item.message||'',imageUrl:item.image_url||null,target:item.target,actionUrl:item.action_url||null,isPinned:Boolean(item.is_pinned),priority:item.priority,createdAt:item.created_at,isRead:readIds.has(item.id)}));
  }catch{return [];}finally{clearTimeout(timer)}
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

