import { effectiveTrialEnd } from '../shared/registrationTrial';
import { readSessionToken, saveSessionToken, clearSessionToken, authRequest, fetchWithTimeout, onceAsync, reusableAuthRequest, shouldRenewTelegramSession, tourDone, tourKey } from './clientSession'
import { telegramBotLink } from './telegramLinks'
import { waitForTelegramSdk, telegramLaunchData } from './telegramViewport'
import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import type { OnboardingResult } from './components/Onboarding'

export interface Card {
  id: string
  bank: string
  number: string
  name: string
  balance: string
  brand: 'uzcard' | 'humo' | 'visa' | 'mastercard'
}

export interface SecurityOpts {
  pinEnabled: boolean
  faceIdEnabled: boolean
  pinCode: string
}

export interface Transaction {
  id: string | number
  type: string
  amount: number | string
  note: string
  category: string
  date: string
  day?: number
  month?: number
  year?: number
  time?: string
  title?: string
  debtWho?: string
  debtRelationship?: string
  debtPersonId?: string
  debtDueDate?: string | null
  debtDateConfirmed?: boolean
  debtPaymentFor?: string
  debtDismissed?: string
  messageId?: string | number
  cardId?: string
}

export const baseTransactions: Transaction[] = []

export interface UserAccessState {
  isPremium: boolean
  isVip: boolean
  premiumExpiresAt: string | null
  unlimitedAi: boolean
  isTrial: boolean
}

export function isValidPhoneNumber(p?: string | null): boolean {
  if (!p) return false;
  const digits = String(p).replace(/\D/g, '');
  return /^\+[1-9]\d{7,14}$/.test(String(p).trim()) || (digits.length === 9);
}

export function isUserFullyRegistered(userDoc: any): boolean {
  if (!userDoc) return false;
  const phone = userDoc.phone || userDoc.onboarding?.phone;
  const hasPhone = isValidPhoneNumber(phone);
  const hasOferta = Boolean(
    userDoc.onboarding?.oferta_accepted === true ||
    userDoc.onboarding?.privacy_consent?.accepted === true
  );
  return Boolean(userDoc.onboarding?.completed === true && hasPhone && hasOferta);
}

export function computeAccessState(raw: any): UserAccessState {
  if (!raw) {
    return {
      isPremium: false,
      isVip: false,
      premiumExpiresAt: null,
      unlimitedAi: false,
      isTrial: false,
    }
  }

  // 1. Account blocked
  const isBlocked = Boolean(
    raw.is_blocked ||
    raw.isBlocked ||
    raw.onboarding?.is_blocked ||
    raw.device_info?.is_blocked ||
    String(raw.id || '').startsWith('restricted_')
  )
  if (isBlocked) {
    return {
      isPremium: false,
      isVip: false,
      premiumExpiresAt: null,
      unlimitedAi: false,
      isTrial: false,
    }
  }

  // 2. Unlimited AI
  const unlimitedAi = Boolean(raw.unlimited_ai ?? raw.unlimitedAi ?? raw.onboarding?.unlimitedAi)
  if (unlimitedAi) {
    return {
      isPremium: true,
      isVip: true,
      premiumExpiresAt: null,
      unlimitedAi: true,
      isTrial: false,
    }
  }

  // 3. VIP / Premium
  const rawIsPremium = raw.accessLevel !== 'TRIAL' && Boolean(raw.is_premium ?? raw.isPremium ?? raw.onboarding?.isPremium ?? raw.onboarding?.isVip)
  const expiresAt = raw.premium_expires_at || raw.premiumExpiresAt || raw.onboarding?.premium_expires_at || raw.onboarding?.premiumExpiresAt || null

  if (rawIsPremium) {
    if (!expiresAt) {
      return {
        isPremium: true,
        isVip: true,
        premiumExpiresAt: null,
        unlimitedAi: false,
        isTrial: false,
      }
    }
    const expiresMs = new Date(expiresAt).getTime()
    if (expiresMs > Date.now()) {
      return {
        isPremium: true,
        isVip: true,
        premiumExpiresAt: new Date(Math.max(expiresMs, Date.parse(effectiveTrialEnd(raw) || '') || 0)).toISOString(),
        unlimitedAi: false,
        isTrial: false,
      }
    }
  }

  const trialEnd = effectiveTrialEnd(raw);
  if (trialEnd && Date.parse(trialEnd) > Date.now()) {
    return {isPremium:true,isVip:false,premiumExpiresAt:trialEnd,unlimitedAi:false,isTrial:true};
  }

  return {
    isPremium: false,
    isVip: false,
    premiumExpiresAt: null,
    unlimitedAi: false,
    isTrial: false,
  }
}

interface FinanceContextType {
  userId: string | null
  onboarding: OnboardingResult | null
  cards: Card[]
  security: SecurityOpts
  customTransactions: Transaction[]
  deletedTxIds: string[]
  hasSampleData: boolean
  setHasSampleData: (val: boolean) => Promise<void>
  loading: boolean
  isAuthReady: boolean
  authError: string | null
  retryAuth: () => void
  isPremium: boolean
  isVip: boolean
  premiumExpiresAt: string | null
  unlimitedAi: boolean
  updateOnboarding: (newData: Partial<OnboardingResult>) => Promise<any>
  saveCards: (updated: Card[], adjustments?: Transaction[]) => Promise<boolean>
  deleteCard: (id: string) => Promise<void>
  updateSecurity: (updated: SecurityOpts) => Promise<any>
  addTransaction: (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number; day?: number; month?: number; year?: number; time?: string }) => Promise<any>
  debtAction: (tx:Transaction,operation:'pay'|'edit'|'dismiss',payload?:any)=>Promise<void>
  deleteTransaction: (id: string | number) => Promise<any>
  clearAllData: () => Promise<void>
  clearOnlyFinancialData: () => Promise<void>
  logout: () => void
  setDateRange: (range: { start: Date; end: Date }) => void
  startTelegramLogin: () => Promise<{ requestId: string; cancel: () => void }>
  resumeTelegramLogin: (requestId: string, onVerified?: () => void, onExpired?: () => void) => () => void
  cancelTelegramLogin: (requestId: string) => Promise<void>
  enableWebAppMode: () => void
  isWebAppMode: boolean
  refreshUserData: (targetId?: string | null) => Promise<{onboarding?: {completed?: boolean}} | undefined>
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined)

export const useFinance = () => {
  const context = useContext(FinanceContext)
  if (!context) throw new Error('useFinance must be used within a FinanceProvider')
  return context
}

// Helper: Detect if running in standalone PWA or Web App mode
// Helper: Detect if running in Web App mode (outside Telegram Mini App)
export function isWebApp(): boolean {
  return !isTelegramMiniApp();
}

// Helper: Check if client is allowed (both Telegram and Web App supported)
export function isAllowedClient(): boolean {
  return true;
}

// Helper: Enable standalone Web App mode
export function enableWebAppMode(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('moliya_web_app_mode', 'true');
  window.dispatchEvent(new Event('moliya_web_mode_enabled'));
}

// Helper: Detect if running inside a legitimate Telegram Mini App
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false

  const tg = (window as any).Telegram?.WebApp

  // 1. Valid non-empty Telegram HMAC initData (definitive Telegram proof)
  if (tg && typeof tg.initData === 'string' && tg.initData.trim().length > 0) return true

  // 2. Native mobile Telegram client proxy (Android / iOS webview bridge)
  const hasNativeProxy = Boolean(
    (window as any).TelegramWebviewProxy ||
    (window as any).webkit?.messageHandlers?.TelegramWebviewProxy
  )
  if (hasNativeProxy) return true

  // 3. Official Telegram desktop / native clients with known valid platform
  const platform = tg?.platform
  const knownNativePlatforms = ['ios', 'android', 'tdesktop', 'macos', 'unigram']
  if (platform && knownNativePlatforms.includes(platform)) return true

  // 4. Telegram Web running inside iframe on web.telegram.org
  const isInsideIframe = window.self !== window.top
  if (isInsideIframe && tg && tg.initDataUnsafe?.user?.id) return true

  // 5. URL explicitly carries Telegram WebApp data hash
  const hash = window.location.hash || ''
  if (hash.includes('tgWebAppData=') || hash.includes('tgWebAppVersion=') || new URLSearchParams(window.location.search).has('tgWebAppData')) return true

  // 6. initDataUnsafe has user AND platform is not unknown / plain browser
  if (tg?.initDataUnsafe?.user?.id && platform && platform !== 'unknown' && platform !== 'browser') {
    return true
  }

  return false
}

// Helper: Establish real Supabase Auth session from tokens
async function setSupabaseSession(accessToken: string, refreshToken: string): Promise<boolean> {
  try {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) {
      console.error('[AUTH] Failed to set Supabase session:', error.message)
      return false
    }
    console.log('[AUTH] ✅ Real Supabase Auth session established')
    return true
  } catch (err) {
    console.error('[AUTH] Error setting session:', err)
    return false
  }
}

// Helper: Secure client auth headers for authenticated backend APIs
export function getClientAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData) {
      headers['x-telegram-init-data'] = tg.initData;
    }
    const sessionToken = readSessionToken();
    if (sessionToken) {
      headers['authorization'] = `Bearer ${sessionToken}`;
      headers['x-session-token'] = sessionToken;
    }
  } catch {}
  return headers;
}

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isTg = isTelegramMiniApp()
  const [isWeb, setIsWeb] = useState<boolean>(() => isWebApp())
  const isClientAllowed = isTg || isWeb

  useEffect(() => {
    const handleWebMode = () => {
      setIsWeb(true)
    }
    window.addEventListener('moliya_web_mode_enabled', handleWebMode)
    window.addEventListener('storage', handleWebMode)
    return () => {
      window.removeEventListener('moliya_web_mode_enabled', handleWebMode)
      window.removeEventListener('storage', handleWebMode)
    }
  }, [])

  // Resolve Telegram WebApp user ONLY if legitimately in Telegram
  const tgUser = (isTg && typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user) || null
  const defaultTgUserId = tgUser?.id ? `moliya_user_tg_${tgUser.id}` : null

  const [userId, setUserId] = useState<string | null>(null);

  const [onboarding,setOnboarding]=useState<OnboardingResult | null>(null);

  const [accessState,setAccessState]=useState<UserAccessState>(()=>computeAccessState(null));

  const [cards,setCards]=useState<Card[]>([]);

  const [security, setSecurity] = useState<SecurityOpts>({
    pinEnabled: false,
    faceIdEnabled: false,
    pinCode: ''
  })

  const [customTransactions,setCustomTransactions]=useState<Transaction[]>([]);

  const [deletedTxIds, setDeletedTxIds] = useState<string[]>(() => {
    if (!isClientAllowed) return []
    try {
      const saved = localStorage.getItem('user_deleted_tx_ids_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [hasSampleData, setHasSampleDataState] = useState<boolean>(() => {
    if (!isClientAllowed) return false
    const saved = localStorage.getItem('user_has_sample_v1')
    return saved === 'true'
  })

  const setHasSampleData = async (val: boolean) => {
    setHasSampleDataState(val)
    localStorage.setItem('user_has_sample_v1', String(val))
    try {
      await fetch('/api/auth/sync-data', {
        method: 'POST',
        headers: getClientAuthHeaders(),
        body: JSON.stringify({ has_sample_data: val })
      });
    } catch (err) {
      console.warn('[FINANCE] Failed to update has_sample_data:', err);
    }
  }

  const [loading] = useState(false)
  const [isAuthReady,setIsAuthReady]=useState(false);
  const [authAttempt,setAuthAttempt]=useState(0);
  const [authError, setAuthError] = useState<string | null>(null)
  const logoutPending = useRef(false)

  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  })
  void dateRange;

  // Helper: Persist auth state after successful verification
  const persistAuthState = (data: { userId: string; sessionToken?: string; onboarding?: any; cards?: any[]; transactions?: any[]; phone?: string }) => {
    if (logoutPending.current) return;
    const prevUserId = localStorage.getItem('user_id_v1')
    if (prevUserId && prevUserId !== data.userId) {
      console.log('[AUTH] Switching user profile cache from', prevUserId, 'to', data.userId)
      localStorage.removeItem('user_cards_v1')
      localStorage.removeItem('user_transactions_v1')
      localStorage.removeItem('user_onboarding_v1')
      clearSessionToken()
    }

    setUserId(data.userId)
    setIsAuthReady(true)
    setAuthError(null)
    localStorage.setItem('user_id_v1', data.userId)
    if (data.sessionToken) {
      saveSessionToken(data.sessionToken)
    }
    // Authoritative onboarding and tour completion state from DB
    const phone = data.phone || data.onboarding?.phone;
    const hasPhone = isValidPhoneNumber(phone);
    const hasOferta = Boolean(
      data.onboarding?.oferta_accepted === true ||
      data.onboarding?.privacy_consent?.accepted === true
    );
    const isRegistered = Boolean(data.onboarding?.completed === true && hasPhone && hasOferta);

    if (isRegistered) {
      localStorage.setItem('user_logged_in_v1', 'true');
      localStorage.setItem(`user_onboarding_completed_${data.userId}`, 'true');
      localStorage.setItem('user_onboarding_completed_v1', 'true');
    } else {
      localStorage.removeItem('user_logged_in_v1');
      localStorage.removeItem(`user_onboarding_completed_${data.userId}`);
      localStorage.removeItem('user_onboarding_completed_v1');
    }
    const acc = computeAccessState({ ...data, ...(data.onboarding || {}) })
    setAccessState(acc)

    if (data.onboarding) {
      const enhancedOnboarding = {
        ...data.onboarding,
        tour_completed: tourDone(localStorage, data.userId, data.onboarding.tour_completed === true,data.onboarding.account_created_at || '',isTelegramMiniApp()?'telegram':'web'),
        isPremium: acc.isPremium,
        isVip: acc.isVip,
        premiumExpiresAt: acc.premiumExpiresAt,
        unlimitedAi: acc.unlimitedAi,
      }
      setOnboarding(enhancedOnboarding)
      localStorage.setItem('user_onboarding_v1', JSON.stringify(enhancedOnboarding))
    }
    const userCards = Array.isArray(data.cards) ? data.cards : []
    setCards(userCards)
    localStorage.setItem('user_cards_v1', JSON.stringify(userCards))

    const userTransactions = Array.isArray(data.transactions) ? data.transactions : []
    setCustomTransactions(userTransactions)
    localStorage.setItem('user_transactions_v1', JSON.stringify(userTransactions))

    // Clean saved pending request since auth is done
    localStorage.removeItem('moliya_pending_request_id')
    window.dispatchEvent(new Event('user_logged_in_updated'))
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN AUTHENTICATION EFFECT
  // Auth state: AUTH_INITIALIZING → AUTHENTICATED | UNAUTHENTICATED
  // ═══════════════════════════════════════════════════════════
  const bootstrapAuth = useRef<ReturnType<typeof onceAsync<{response: Response; data: any; code: string | null; stored: string | null} | null>> | null>(null);
  const retryAuth=()=>{
    bootstrapAuth.current=null;
    setAuthError(null);setIsAuthReady(false);setAuthAttempt(v=>v+1);
  };
  useEffect(() => {
    let active = true;
    if (!bootstrapAuth.current) bootstrapAuth.current = onceAsync(async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const stored = readSessionToken();
      const telegramLaunch = isTelegramMiniApp() || !!telegramLaunchData(undefined,url.hash,url.search);
      if (telegramLaunch && !telegramLaunchData((window as any).Telegram?.WebApp,url.hash,url.search))
        await waitForTelegramSdk(() => (window as any).Telegram?.WebApp,12000);
      const initData = telegramLaunchData((window as any).Telegram?.WebApp,url.hash,url.search);
      const request = stored ? authRequest(undefined,null,stored) : telegramLaunch
        ? (initData ? authRequest(initData, null, null) : null)
        : authRequest(undefined, code, null);
      if (!request) return null;
      let response = request.action==='exchange-code'
        ? await fetchWithTimeout('/api/auth/exchange-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)})
        : await reusableAuthRequest(request.action,request.body);
      let data = await response.json();
      if (telegramLaunch && shouldRenewTelegramSession(request.action,response.status,data,initData)) {
        response=await reusableAuthRequest('telegram',{initData});
        data=await response.json();
      }
      if (!telegramLaunch && request.action === 'validate-session' && code && (response.status === 401 || data.valid === false)) {
        response = await fetchWithTimeout('/api/auth/exchange-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
        data = await response.json();
      }
      return {response, data, code, stored};
    });
    const clear = () => {setUserId(null);setOnboarding(null);setCards([]);setCustomTransactions([]);setAccessState(computeAccessState(null));};
    async function authenticate() {
      setIsAuthReady(false);
      setAuthError(null);
      try {
        const result = await bootstrapAuth.current!();
        if (!active) return;
        if (!result) {
          clear();
          if (isTelegramMiniApp()) setAuthError('Telegram tasdiqlash ma’lumoti kelmadi. Botdan ilovani qayta oching.');
          return;
        }
        const {response, data, code, stored} = result;
        if (!response.ok || data.valid === false || !data.userId) {
          clear();
          if (response.status >= 500 || response.status === 429) throw Error('Server unavailable');
          if (response.status === 401 || response.status === 403 || data.valid === false) clearSessionToken();
          if (data.error === 'ACCOUNT_RESTRICTED') setAuthError('Hisobingiz cheklangan. Administrator bilan bog‘laning.');
          else setAuthError(isTelegramMiniApp()?'Telegramda qayta tasdiqlang.':'Telegram orqali qayta kiring.');
          return;
        }
        persistAuthState({...data, sessionToken: data.sessionToken || stored});
        if (code) {
          const url = new URL(window.location.href);
          url.searchParams.delete('code');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
      } catch {if (active) {clear();bootstrapAuth.current=null;setAuthError('Ulanib bo‘lmadi. Yana urinib ko‘ring.');}}
      finally {if (active) setIsAuthReady(true);}
    }
    void authenticate();
    return () => {active = false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authAttempt])

  // ═══════════════════════════════════════════════════════════
  // The backend session is authoritative. Supabase's legacy auth state must
  // never erase it on INITIAL_SESSION / SIGNED_OUT during page restoration.

  // ═══════════════════════════════════════════════════════════
  // POLLING HELPER — resumes polling for a login request
  // Used both during initial login and after mobile redirect recovery
  // ═══════════════════════════════════════════════════════════
  function resumePolling(requestId: string, onVerified?: () => void, onExpired?: () => void) {
    let intervalId: any = null
    let isFinished = false
    let inFlight = false
    let nextPollAt = 0

    const checkVerification = async () => {
      if (isFinished || inFlight || Date.now() < nextPollAt) return
      inFlight = true
      try {
        const res = await fetchWithTimeout(`/api/auth/check-login-request?requestId=${requestId}`)
        if (isFinished) return
        if (res.status === 429) {
          nextPollAt = Date.now() + Math.max(3, Number(res.headers.get('Retry-After')) || 15) * 1000;
          return;
        }
        if (res.ok) {
          const data = await res.json()
          if (isFinished) return
          if (data.status === 'VERIFIED' && data.userId) {
            isFinished = true
            if (intervalId) clearInterval(intervalId)
            window.removeEventListener('focus', onTabActive)
            document.removeEventListener('visibilitychange', onTabActive)

            // Set real Supabase Auth session if available
            if (data.access_token && data.refresh_token) {
              await setSupabaseSession(data.access_token, data.refresh_token)
            }

            const currentOnboarding: Partial<OnboardingResult> = {} // Never merge another account's cached registration or tour.
            const savedLang = localStorage.getItem('user_selected_language_v1')
            const updatedOnboarding = {
              ...currentOnboarding,
              ...(data.onboarding || {}),
              completed: data.onboarding?.completed === true,
              language: savedLang || data.onboarding?.language || currentOnboarding.language || 'uz',
              phone: data.phone || data.onboarding?.phone || currentOnboarding.phone || '',
            }

            logoutPending.current = false;
            persistAuthState({
              userId: data.userId,
              sessionToken: data.sessionToken,
              onboarding: updatedOnboarding,
              cards: data.cards,
              transactions: data.transactions,
            })

            localStorage.removeItem('moliya_pending_request_id')
            localStorage.removeItem('moliya_pending_request_time')
            if (onVerified) onVerified()
            return
          }
          if (['EXPIRED', 'CONSUMED', 'CANCELLED', 'FAILED'].includes(data.status)) {
            isFinished = true
            if (intervalId) clearInterval(intervalId)
            window.removeEventListener('focus', onTabActive)
            document.removeEventListener('visibilitychange', onTabActive)
            localStorage.removeItem('moliya_pending_request_id')
            localStorage.removeItem('moliya_pending_request_time')
            onExpired?.()
            return
          }
        }
      } catch (err) {
        console.error('[AUTH] Polling API error:', err)
      } finally {
        inFlight = false
      }

    }

    const onTabActive = () => {
      if (document.visibilityState === 'visible' || document.hasFocus()) {
        checkVerification()
      }
    }

    window.addEventListener('focus', onTabActive)
    document.addEventListener('visibilitychange', onTabActive)

    // Check immediately on return
    checkVerification()

    intervalId = setInterval(() => { if (document.visibilityState !== 'hidden') void checkVerification(); }, 3000)

    // Match the server's five-minute login request lifetime.
    const timeoutId = setTimeout(() => {
      if (!isFinished) {
        isFinished = true
        if (intervalId) clearInterval(intervalId)
        window.removeEventListener('focus', onTabActive)
        document.removeEventListener('visibilitychange', onTabActive)
        localStorage.removeItem('moliya_pending_request_id')
        localStorage.removeItem('moliya_pending_request_time')
        onExpired?.()
      }
    }, 5 * 60 * 1000)

    return () => {
      isFinished = true
      clearTimeout(timeoutId)
      if (intervalId) clearInterval(intervalId)
      window.removeEventListener('focus', onTabActive)
      document.removeEventListener('visibilitychange', onTabActive)
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Start Telegram Login
  // On mobile: uses window.location.href (the only reliable approach)
  // but saves requestId to localStorage so polling resumes on return
  // ═══════════════════════════════════════════════════════════
  const startTelegramLogin = async () => {
    // Generate clean alphanumeric request ID without hyphens (Telegram deep link parameters allow [a-zA-Z0-9_-])
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');

    const botUrl = telegramBotLink(`req_${requestId}`);

    // Multi-device and returning user recognition metadata
    const cachedUserId = localStorage.getItem('user_id_v1') || null;
    let clientDeviceId = localStorage.getItem('moliya_client_device_id');
    if (!clientDeviceId) {
      clientDeviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('moliya_client_device_id', clientDeviceId);
    }

    // Reserve a tab inside the click gesture so awaiting the server cannot block it.
    const mobile=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const loginTab=mobile?null:window.open('about:blank','_blank');
    if(loginTab)loginTab.opener=null;
    let loginResponse:Response;
    try { loginResponse=await fetchWithTimeout('/api/auth/create-login-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, cachedUserId, clientDeviceId }),
    });
    } catch(error) {loginTab?.close();throw error;}
    if(!loginResponse.ok) {loginTab?.close();throw new Error('Telegram orqali kirish vaqtincha ishlamayapti. Qayta urinib ko‘ring.');}

    // The request now exists on the server; save it before opening Telegram.
    localStorage.setItem('moliya_pending_request_id', requestId);
    localStorage.setItem('moliya_pending_request_time', String(Date.now()));

    try {
      if(mobile)window.location.href=botUrl;
      else if(loginTab)loginTab.location.replace(botUrl);
      // If popups are blocked, the login screen still offers a direct bot link.
    } catch {loginTab?.close();}

    return {
      requestId,
      cancel: () => {
        localStorage.removeItem('moliya_pending_request_id')
        localStorage.removeItem('moliya_pending_request_time')
      }
    };
  };

  const cancelTelegramLogin = async (requestId: string) => {
    const response=await fetchWithTimeout('/api/auth/cancel-login-request',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId})
    });
    if(!response.ok) throw new Error(response.status===409
      ? 'Tasdiqlash boshlangan. Natijani kuting yoki sahifani yangilang.'
      : 'Bekor qilish serverda saqlanmadi. Qayta urinib ko‘ring.');
  };

  // ═══════════════════════════════════════════════════════════
  // Context Functions with Supabase Persistence & Instant Sync
  // ═══════════════════════════════════════════════════════════
  const getEffectiveUserId = (): string | null => {
    if (userId) return userId;
    if (isTelegramMiniApp() && defaultTgUserId) return defaultTgUserId;
    const storedToken = readSessionToken();
    const stored = localStorage.getItem('user_id_v1');
    if (storedToken && stored && stored.startsWith('moliya_user_tg_')) return stored;
    return null;
  };

  // Dedicated data refresh function to keep Bot, Mini App, and Web App in sync
  const refreshSequence=useRef(0);
  const preferenceWrites=useRef(0);
  const sessionRenewal=useRef<Promise<any> | null>(null);
  const renewTelegramSession = () => {
    if (logoutPending.current) return Promise.reject(new Error('Chiqish davom etmoqda.'));
    const initData=(window as any).Telegram?.WebApp?.initData;
    if (!initData) return Promise.reject(new Error('Telegram tasdiqlash ma’lumoti topilmadi. Botdan ilovani qayta oching.'));
    if (!sessionRenewal.current) {
      sessionRenewal.current=(async () => {
        const response=await fetchWithTimeout('/api/auth/telegram',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData})
        });
        const data=await response.json();
        if (!response.ok || !data.userId || !data.sessionToken) throw new Error('Telegram sessiyasi yangilanmadi. Botdan ilovani qayta oching.');
        if (logoutPending.current) throw new Error('Chiqish davom etmoqda.');
        persistAuthState(data);
        return {id:data.userId,onboarding:data.onboarding};
      })().finally(() => {sessionRenewal.current=null;});
    }
    return sessionRenewal.current;
  };
  const refreshUserData = async (_targetId?: string | null) => {
    if(preferenceWrites.current>0)return;
    const refreshToken=readSessionToken();
    if(!refreshToken) {
      if ((window as any).Telegram?.WebApp?.initData) return renewTelegramSession();
      return;
    }
    const sequence=++refreshSequence.current;
    const response=await fetchWithTimeout('/api/auth/sync-data',{headers:getClientAuthHeaders()});
    if(sequence!==refreshSequence.current || refreshToken!==readSessionToken()) return;
    if(!response.ok) {
      if(response.status===401 && (window as any).Telegram?.WebApp?.initData) {
        try { return await renewTelegramSession(); }
        catch { /* Invalid or expired Telegram proof requires a fresh launch. */ }
      }
      if(response.status===401 || response.status===403) {
        setUserId(null);setOnboarding(null);setCards([]);setCustomTransactions([]);
        clearSessionToken();
        setAuthError(response.status===403
          ? 'Hisobga kirish cheklangan. Bot orqali holatni tekshiring.'
          : 'Telegram orqali qayta kiring.');
      }
      throw Error('Holatni tekshirib bo‘lmadi. Qayta urinib ko‘ring.');
    }
    const {user}=await response.json();
    if(!user?.id) throw Error('Foydalanuvchi holati kelmadi');
    if(sequence===refreshSequence.current && refreshToken===readSessionToken()) {
      persistAuthState({...user,userId:user.id});
      return user;
    }
  };

  // ═══════════════════════════════════════════════════════════
  // Supabase Real-Time User & Data Syncing
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isAllowedClient()) return;
    const activeId = getEffectiveUserId();
    if (!activeId) return;

    // Bootstrap already returned authoritative data. Coalesce focus events and
    // avoid starting overlapping automatic reads on slow mobile connections.
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try { await refreshUserData(activeId); } catch {} finally { refreshing = false; }
    };

    // 2. Refresh immediately when returning from Telegram Bot (tab focus or visibility change)
    const onFocusOrVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onFocusOrVisibility);
    window.addEventListener('focus', onFocusOrVisibility);
    window.addEventListener('user_sync_requested', onFocusOrVisibility);

    // 3. Refresh while active; returning from the bot still refreshes immediately.
    const syncInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refresh();
      }
    }, onboarding?.completed ? 30000 : 10000);

    // 4. Realtime channel listener for instant multi-device syncing
    return () => {
      document.removeEventListener('visibilitychange', onFocusOrVisibility);
      window.removeEventListener('focus', onFocusOrVisibility);
      window.removeEventListener('user_sync_requested', onFocusOrVisibility);
      clearInterval(syncInterval);

    };
  }, [userId, isAuthReady, onboarding?.completed]);

  const updateOnboarding = async (newData: Partial<OnboardingResult>): Promise<OnboardingResult> => {
    if(preferenceWrites.current>0)throw Error('Oldingi sozlama saqlanmoqda. Biroz kuting.');
    const targetUserId = getEffectiveUserId();
    const preferenceSession=readSessionToken();
    preferenceWrites.current++;
    ++refreshSequence.current;
    try {

    // 1. Optimistically update local state & storage immediately (preserving bot-authoritative identity fields)
    const updated = {
      ...(onboarding || {}),
      ...newData,
      phone: onboarding?.phone || '',
      oferta_accepted: onboarding?.oferta_accepted ?? false,
      privacy_consent: onboarding?.privacy_consent ?? null,
      registration_status: onboarding?.registration_status || 'unverified',
      completed: onboarding?.completed ?? false,
      telegramId: newData.telegramId || onboarding?.telegramId || ''
    } as OnboardingResult;

    setOnboarding(updated);
    localStorage.setItem('user_onboarding_v1', JSON.stringify(updated));
    if (updated.completed === true) {
      if (targetUserId) {
        localStorage.setItem(`user_onboarding_completed_${targetUserId}`, 'true');
      }
      localStorage.setItem('user_onboarding_completed_v1', 'true');
    }
    if (newData.tour_completed === true) {
      if (targetUserId) localStorage.setItem(tourKey(targetUserId,onboarding?.account_created_at || '',isTelegramMiniApp()?'telegram':'web'), 'true');
    }
    window.dispatchEvent(new Event('user_onboarding_updated'));

    const savePreferences = () => fetchWithTimeout('/api/auth/sync-data',
      {method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({onboarding:newData,...(newData.planned_payments ? {expectedPlannedPayments:onboarding?.planned_payments || []} : {})})});
    let response: Response;
    try { response = await savePreferences(); }
    catch (error) {
      if(preferenceSession!==readSessionToken())throw error;
      setOnboarding(onboarding);
      localStorage.setItem('user_onboarding_v1', JSON.stringify(onboarding));
      throw error;
    }
    // Bot and app may edit the same profile at the same instant. The backend
    // reads a fresh snapshot on each request, so one retry resolves that race.
    if(preferenceSession!==readSessionToken())throw Error('Sessiya o‘zgardi. Qayta kiring.');
    if (response.status === 409 && !newData.planned_payments) {
      try { response = await savePreferences(); }
      catch(error){if(preferenceSession===readSessionToken()){setOnboarding(onboarding);localStorage.setItem('user_onboarding_v1',JSON.stringify(onboarding));}throw error;}
    }
    if(preferenceSession!==readSessionToken())throw Error('Sessiya o‘zgardi. Qayta kiring.');
    if(!response.ok) {
      setOnboarding(onboarding);
      localStorage.setItem('user_onboarding_v1',JSON.stringify(onboarding));
      throw new Error('Sozlamalar saqlanmadi. Qayta urinib ko‘ring.');
    }

    return updated;
    } finally {
      preferenceWrites.current--;
      ++refreshSequence.current;
    }
  };

  const writeFinancial = async (financialAction:string,payload:unknown,expected:unknown=null) => {
    const sessionAtStart=readSessionToken();
    const response=await fetchWithTimeout('/api/auth/sync-data',{method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({financialAction,payload,expected})});
    if(sessionAtStart!==readSessionToken())throw Error('Sessiya o‘zgardi. Qayta kiring.');
    if(!response.ok){
      const failure=await response.json().catch(()=>({}));
      await refreshUserData().catch(()=>{});
      if(failure.error==='DEBT_HAS_PAYMENTS')throw Error('Bu qarzning qaytarish yozuvlari bor. Asosiy summa, hisob yoki yozuvni o‘chirish mumkin emas.');
      if(failure.error==='USE_DEBT_ACTION')throw Error('Qaytarish yozuvi qarz tarixiga bog‘langan. Qarz / Haqqim bo‘limini oching.');
      throw new Error(response.status===409 ? 'Ma’lumot boshqa qurilmada o‘zgargan. Yangilangan holatni tekshirib, qayta urinib ko‘ring.' : 'O‘zgarish saqlanmadi. Qayta urinib ko‘ring.');
    }
    // The server has committed. Show that confirmed write immediately; sync in the background.
    if(financialAction==='put_transaction'){
      ++refreshSequence.current;
      const committed=payload as Transaction;
      setCustomTransactions(current=>{const next=[committed,...current.filter(t=>String(t.id)!==String(committed.id))];try{localStorage.setItem('user_transactions_v1',JSON.stringify(next));}catch{}return next;});
      void refreshUserData().catch(()=>{});
    }else if(financialAction==='delete_transaction'){
      ++refreshSequence.current;
      const id=String((payload as {id:string}).id);
      setCustomTransactions(current=>{const next=current.filter(t=>String(t.id)!==id);try{localStorage.setItem('user_transactions_v1',JSON.stringify(next));}catch{}return next;});
      void refreshUserData().catch(()=>{});
    }else await refreshUserData().catch(()=>{});
  };
  const saveCards = async (updatedCards: Card[], adjustments: Transaction[] = []): Promise<boolean> => {
    try {await writeFinancial('save_cards_atomic',{cards:updatedCards,transactions:adjustments},{cards,transactions:customTransactions});return true;}
    catch(error){window.alert((error as Error).message);return false;}
  };

  const deleteCard = async (id: string) => {
    await writeFinancial('delete_card_atomic',{id},{cards,transactions:customTransactions});
  };

  const updateSecurity = async (updatedSec: SecurityOpts) => {
    setSecurity(updatedSec);
  };

  const debtAction=async(tx:Transaction,operation:'pay'|'edit'|'dismiss',payload:any={})=>{
    const token=readSessionToken();
    const response=await fetchWithTimeout('/api/auth/debts',{method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({txId:String(tx.id),operation,payload,expected:tx})});
    const data=await response.json();
    if(!response.ok){await refreshUserData().catch(()=>{});throw new Error(response.status===409?'Qarz o‘zgargan. Yangilangan holatni tekshiring.':data.code==='INVALID_PAYMENT_AMOUNT'?'Summa qolgan qarzdan oshmasin.':'Saqlanmadi. Qayta urinib ko‘ring.');}
    if(token!==readSessionToken() || logoutPending.current)throw Error('Sessiya o‘zgardi. Qayta kiring.');
    if(Array.isArray(data.transactions)){++refreshSequence.current;setCustomTransactions(data.transactions);try{localStorage.setItem('user_transactions_v1',JSON.stringify(data.transactions));}catch{}}
  };

  const addTransaction = async (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number; day?: number; month?: number; year?: number; time?: string }): Promise<Transaction> => {

    // Deterministic client date normalization: ensures real date, day, month, year, time
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    let finalDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let finalDay = now.getDate();
    let finalMonth = now.getMonth() + 1;
    let finalYear = now.getFullYear();
    let finalTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    if (tx.date && typeof tx.date === 'string' && tx.date.trim()) {
      const str = tx.date.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const [yStr, mStr, dStr] = str.slice(0, 10).split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          finalDate = `${y}-${pad(m)}-${pad(d)}`;
          finalDay = d;
          finalMonth = m;
          finalYear = y;
          const timeMatch = str.match(/T(\d{2}:\d{2})/);
          if (timeMatch) finalTime = timeMatch[1];
        }
      } else {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          finalDate = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
          finalDay = parsed.getDate();
          finalMonth = parsed.getMonth() + 1;
          finalYear = parsed.getFullYear();
          finalTime = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
        }
      }
    }

    const txId = tx.id ? String(tx.id) : (`tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    const previous=customTransactions.find(t=>String(t.id)===txId) || null;
    const isLoanType = tx.type === 'debt' || tx.type === 'lending';
    const newTx: Transaction = {
      ...previous,
      id: txId,
      type: tx.type || 'expense',
      amount: (['income','debt'].includes(tx.type)?1:-1)*Math.abs(Number(tx.amount)||0),
      note: tx.note || tx.title || tx.category || '',
      category: tx.category || 'Boshqa',
      title: tx.title || tx.note || tx.category || '',
      debtWho: isLoanType ? (tx.debtWho ?? previous?.debtWho) : undefined,
      debtRelationship: isLoanType ? (tx.debtRelationship ?? previous?.debtRelationship) : undefined,
      debtPersonId: isLoanType ? (tx.debtPersonId ?? previous?.debtPersonId) : undefined,
      debtDueDate: isLoanType ? (tx.debtDueDate===undefined?previous?.debtDueDate:tx.debtDueDate) : undefined,
      debtDateConfirmed: isLoanType ? (tx.debtDateConfirmed ?? previous?.debtDateConfirmed) : undefined,
      messageId: tx.messageId,
      cardId: tx.cardId || 'cash',
      date: finalDate,
      day: tx.day || finalDay,
      month: tx.month || finalMonth,
      year: tx.year || finalYear,
      time: tx.time || finalTime
    };

    await writeFinancial('put_transaction',newTx,previous);

    return newTx;
  };

  const deleteTransaction = async (id: string | number): Promise<boolean> => {
    const idStr = String(id);

    await writeFinancial('delete_transaction',{id:idStr},customTransactions.find(t=>String(t.id)===idStr) || null);

    return true;
  };

  const clearAllData = async () => {
    const targetUserId = userId;
    const targetTgId = tgUser?.id ? String(tgUser.id) : (onboarding?.telegramId ? String(onboarding.telegramId) : null);
    const initData = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) || '';
    const sessionToken = (typeof window !== 'undefined' && readSessionToken()) || '';

    // Call backend endpoint to sweep Telegram bot chat, remove custom keyboards, and purge user account
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }
      if (initData) {
        headers['x-telegram-init-data'] = initData;
      }
      const response = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId: targetUserId,
          telegramId: targetTgId,
          initData,
          sessionToken
        })
      });
      if(!response.ok) throw new Error('Hisob o‘chirilmadi. Qayta urinib ko‘ring.');
    } catch (apiErr) { throw apiErr; }

    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHE' });
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    setUserId(null);
    setOnboarding(null);
    setCards([]);
    setCustomTransactions([]);
    setDeletedTxIds([]);
    setHasSampleDataState(false);
    setIsAuthReady(true);
    window.dispatchEvent(new Event('user_logged_in_updated'));
  };

  const clearOnlyFinancialData = async () => {
    const response=await fetch('/api/auth/wipe-data',{method:'POST',headers:getClientAuthHeaders()});
    if(!response.ok) throw new Error('Ma’lumotlar o‘chirilmadi. Qayta urinib ko‘ring.');
    localStorage.removeItem('user_transactions_v1');
    localStorage.removeItem('user_cards_v1');
    setCustomTransactions([]);
    setCards([]);
  };

  const logout = async () => {
    // A Telegram reauthentication can rotate the canonical token. Revoke the
    // latest token, even when the user taps logout during that request.
    if (sessionRenewal.current) {
      try { await sessionRenewal.current; } catch {}
    }
    logoutPending.current = true;
    ++refreshSequence.current;
    const currentSessionToken = readSessionToken();
    const currentUid = userId || localStorage.getItem('user_id_v1');

    // Do not report successful logout while the server still accepts this token.
    if (currentSessionToken) {
      try {
        const response = await fetchWithTimeout('/api/auth/logout', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sessionToken:currentSessionToken,userId:currentUid})
        });
        if (!response.ok && response.status !== 401 && response.status !== 403) throw Error('logout failed');
      } catch {
        logoutPending.current = false;
        window.alert('Sessiyani serverda yopib bo‘lmadi. Ulanishni tekshirib, qayta urinib ko‘ring.');
        return;
      }
    }

    // 2. Sign out from real Supabase Auth
    supabase.auth.signOut().catch(() => {});

    // 3. Purge SW cache
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHE' });
    } catch {}

    // 4. Clear all tokens, flags, and cached data
    if (currentUid) {
      localStorage.removeItem(`user_onboarding_completed_${currentUid}`);
    }
    localStorage.removeItem('user_logged_in_v1');
    clearSessionToken();
    localStorage.removeItem('user_id_v1');
    localStorage.removeItem('user_onboarding_v1');
    localStorage.removeItem('user_onboarding_completed_v1');
    localStorage.removeItem('user_onboarding_pre_completed_v1');
    localStorage.removeItem('user_cards_v1');
    localStorage.removeItem('user_transactions_v1');
    localStorage.removeItem('user_security_v1');
    localStorage.removeItem('user_has_sample_v1');
    localStorage.removeItem('user_tour_completed_v2');
    localStorage.removeItem('moliya_pending_request_id');
    localStorage.removeItem('moliya_pending_request_time');

    // 5. Reset React states
    setUserId(null);
    setOnboarding(null);
    setCards([]);
    setCustomTransactions([]);
    setDeletedTxIds([]);
    setIsAuthReady(true);
    if (isTelegramMiniApp()) setAuthError('Sessiya yopildi. Qayta kirish uchun botdan ilovani oching.');
    window.dispatchEvent(new Event('user_logged_in_updated'));
  };

  return (
    <FinanceContext.Provider
      value={{
        userId,
        onboarding,
        cards,
        security,
        customTransactions,
        deletedTxIds,
        hasSampleData,
        setHasSampleData,
        loading,
        isAuthReady,
        authError,
        retryAuth,
        isPremium: accessState.isPremium,
        isVip: accessState.isVip,
        premiumExpiresAt: accessState.premiumExpiresAt,
        unlimitedAi: accessState.unlimitedAi,
        updateOnboarding,
        saveCards,
        deleteCard,
        updateSecurity,
        addTransaction,
        deleteTransaction,
        debtAction,
        clearAllData,
        clearOnlyFinancialData,
        logout,
        setDateRange,
        startTelegramLogin,
        resumeTelegramLogin: resumePolling,
        cancelTelegramLogin,
        enableWebAppMode,
        isWebAppMode: isWeb,
        refreshUserData,
      }}
    >
      {children}
    </FinanceContext.Provider>
  )
}
