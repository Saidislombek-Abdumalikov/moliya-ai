import React, { createContext, useContext, useState, useEffect } from 'react'
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
  title?: string
  debtWho?: string
  messageId?: string | number
  cardId?: string
}

export const baseTransactions: Transaction[] = []

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
  updateOnboarding: (newData: Partial<OnboardingResult>) => Promise<void>
  saveCards: (updated: Card[]) => Promise<void>
  updateSecurity: (updated: SecurityOpts) => Promise<void>
  addTransaction: (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number }) => Promise<void>
  deleteTransaction: (id: string | number) => Promise<void>
  clearAllData: () => Promise<void>
  clearOnlyFinancialData: () => Promise<void>
  logout: () => void
  setDateRange: (range: { start: Date; end: Date }) => void
  startTelegramLogin: (onVerified?: () => void) => Promise<{ requestId: string; cancel: () => void }>
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined)

export const useFinance = () => {
  const context = useContext(FinanceContext)
  if (!context) throw new Error('useFinance must be used within a FinanceProvider')
  return context
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

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(() => {
    return localStorage.getItem('user_id_v1') || null
  })

  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(() => {
    try {
      const saved = localStorage.getItem('user_onboarding_v1')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [cards, setCards] = useState<Card[]>(() => {
    try {
      const saved = localStorage.getItem('user_cards_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [security, setSecurity] = useState<SecurityOpts>({
    pinEnabled: false,
    faceIdEnabled: false,
    pinCode: ''
  })

  const [customTransactions, setCustomTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('user_transactions_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [deletedTxIds, setDeletedTxIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('user_deleted_tx_ids_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [hasSampleData, setHasSampleDataState] = useState<boolean>(() => {
    const saved = localStorage.getItem('user_has_sample_v1')
    return saved === 'true'
  })

  const setHasSampleData = async (val: boolean) => {
    setHasSampleDataState(val)
    localStorage.setItem('user_has_sample_v1', String(val))
    if (userId) {
      supabase.from('users').update({ has_sample_data: val, updated_at: new Date().toISOString() }).eq('id', userId).then(() => {});
    }
  }

  const [loading] = useState(false)
  const [isAuthReady, setIsAuthReady] = useState(false)

  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  })
  void dateRange;

  // Helper: Persist auth state after successful verification
  const persistAuthState = (data: { userId: string; sessionToken?: string; onboarding?: any; cards?: any[]; transactions?: any[] }) => {
    const prevUserId = localStorage.getItem('user_id_v1')
    if (prevUserId && prevUserId !== data.userId) {
      console.log('[AUTH] Switching user profile cache from', prevUserId, 'to', data.userId)
      localStorage.removeItem('user_cards_v1')
      localStorage.removeItem('user_transactions_v1')
      localStorage.removeItem('user_onboarding_v1')
      localStorage.removeItem('user_session_token_v1')
    }

    setUserId(data.userId)
    localStorage.setItem('user_id_v1', data.userId)
    if (data.sessionToken) {
      localStorage.setItem('user_session_token_v1', data.sessionToken)
    }
    localStorage.setItem('user_logged_in_v1', 'true')
    // Always mark onboarding as completed on successful auth —
    // the user should never see onboarding again after logging in
    localStorage.setItem('user_onboarding_completed_v1', 'true')
    if (data.onboarding) {
      setOnboarding(data.onboarding)
      localStorage.setItem('user_onboarding_v1', JSON.stringify(data.onboarding))
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
  useEffect(() => {
    async function authenticate() {
      try {
        console.log('[AUTH] Initializing authentication...');

        // ===== STEP 0: Telegram Mini App native container check (HIGHEST PRIORITY) =====
        const tg = (window as any).Telegram?.WebApp
        if (tg) {
          try {
            if (typeof tg.ready === 'function') tg.ready()
            if (typeof tg.expand === 'function') tg.expand()
          } catch (tgErr) {
            console.error('[AUTH] Telegram WebApp error:', tgErr)
          }
        }
        const initData = tg?.initData || ''
        const initDataUnsafe = tg?.initDataUnsafe
        const currentTgId = initDataUnsafe?.user?.id ? String(initDataUnsafe.user.id) : null

        if (tg && (initData || currentTgId)) {
          try {
            console.log('[AUTH] Telegram Mini App detected, active Telegram user:', currentTgId)
            const cachedUserId = localStorage.getItem('user_id_v1')
            if (currentTgId && cachedUserId && cachedUserId !== `moliya_user_tg_${currentTgId}`) {
              console.log('[AUTH] User switch detected in Telegram Mini App:', cachedUserId, '->', `moliya_user_tg_${currentTgId}`)
              localStorage.removeItem('user_session_token_v1')
              localStorage.removeItem('user_cards_v1')
              localStorage.removeItem('user_transactions_v1')
              localStorage.removeItem('user_onboarding_v1')
              await supabase.auth.signOut().catch(() => {})
            }

            const res = await fetch('/api/auth/telegram', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ initData, initDataUnsafe })
            })
            if (res.ok) {
              const data = await res.json()
              if (data.userId) {
                if (data.access_token && data.refresh_token) {
                  await setSupabaseSession(data.access_token, data.refresh_token)
                }
                persistAuthState({
                  userId: data.userId,
                  sessionToken: data.sessionToken,
                  onboarding: data.onboarding,
                  cards: data.cards,
                  transactions: data.transactions
                })
                console.log('[AUTH] ✅ Authenticated via Telegram Mini App initData for:', data.userId)
                setIsAuthReady(true)
                return
              }
            } else {
              const errData = await res.json().catch(() => ({}))
              console.error('[AUTH] Telegram initData verification failed:', errData)
            }
          } catch (err) {
            console.error('[AUTH] Telegram initData auth error:', err)
          }
        }

        // ===== STEP 1: Check for URL ?code= parameter (exchange code from bot) =====
        const urlParams = new URLSearchParams(window.location.search)
        const exchangeCode = urlParams.get('code')
        if (exchangeCode && exchangeCode.length >= 16) {
          try {
            console.log('[AUTH] Found ?code= URL parameter, exchanging...')
            const res = await fetch('/api/auth/exchange-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: exchangeCode }),
            })
            if (res.ok) {
              const data = await res.json()
              if (data.access_token && data.refresh_token && data.userId) {
                await setSupabaseSession(data.access_token, data.refresh_token)
                persistAuthState({
                  userId: data.userId,
                  sessionToken: data.sessionToken,
                  onboarding: data.onboarding,
                  cards: data.cards,
                  transactions: data.transactions
                })
                // Clean URL
                const cleanUrl = window.location.pathname + window.location.hash
                window.history.replaceState({}, document.title, cleanUrl)
                console.log('[AUTH] ✅ Authenticated via exchange code')
                setIsAuthReady(true)
                return
              }
            }
          } catch (err) {
            console.error('[AUTH] Error exchanging code:', err)
          }
          // Clean URL even if exchange failed
          const cleanUrl = window.location.pathname + window.location.hash
          window.history.replaceState({}, document.title, cleanUrl)
        }

        // ===== STEP 2: Check for existing real Supabase Auth session =====
        const { data: existingSession } = await supabase.auth.getSession()
        if (existingSession?.session?.user) {
          const user = existingSession.session.user
          const tgId = user.user_metadata?.telegram_id || (user.email?.startsWith('tg') ? user.email.replace(/^tg/, '').replace(/@.*$/, '') : null)
          if (tgId) {
            const profileId = `moliya_user_tg_${tgId}`
            setUserId(profileId)
            localStorage.setItem('user_id_v1', profileId)
            localStorage.setItem('user_logged_in_v1', 'true')
            localStorage.setItem('user_onboarding_completed_v1', 'true')
            console.log('[AUTH] ✅ Restored from existing Supabase Auth session for:', profileId)
            window.dispatchEvent(new Event('user_logged_in_updated'))
            setIsAuthReady(true)
            return
          }
        }

        // ===== STEP 3: Check for URL ?s= parameter (legacy — validate-session) =====
        const sessionParam = urlParams.get('s')
        if (sessionParam) {
          try {
            console.log('[AUTH] Found ?s= URL parameter, validating session token...')
            const res = await fetch('/api/auth/validate-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionToken: sessionParam }),
            })
            if (res.ok) {
              const data = await res.json()
              if (data.valid && data.userId) {
                if (data.access_token && data.refresh_token) {
                  await setSupabaseSession(data.access_token, data.refresh_token)
                }
                persistAuthState({ userId: data.userId, sessionToken: sessionParam, onboarding: data.onboarding, cards: data.cards, transactions: data.transactions })
                const cleanUrl = window.location.pathname + window.location.hash
                window.history.replaceState({}, document.title, cleanUrl)
                console.log('[AUTH] ✅ Authenticated via ?s= URL token')
                setIsAuthReady(true)
                return
              }
            }
          } catch (err) {
            console.error('[AUTH] Error validating ?s= token:', err)
          }
        }

        // ===== STEP 4: Check for URL ?req= parameter (polling redirect) =====
        const reqParam = urlParams.get('req')
        if (reqParam) {
          try {
            const res = await fetch(`/api/auth/check-login-request?requestId=${reqParam}`)
            if (res.ok) {
              const data = await res.json()
              if (data.status === 'VERIFIED' && data.userId) {
                if (data.access_token && data.refresh_token) {
                  await setSupabaseSession(data.access_token, data.refresh_token)
                }
                persistAuthState({ userId: data.userId, sessionToken: data.sessionToken, onboarding: data.onboarding })
                const cleanUrl = window.location.pathname + window.location.hash
                window.history.replaceState({}, document.title, cleanUrl)
                console.log('[AUTH] ✅ Authenticated via ?req= URL parameter')
                setIsAuthReady(true)
                return
              }
            }
          } catch (reqErr) {
            console.error('[AUTH] Error checking ?req= login request:', reqErr)
          }
        }

        // ===== STEP 5: Check stored 60-day custom session token =====
        const sessionToken = localStorage.getItem('user_session_token_v1')
        if (sessionToken) {
          try {
            const res = await fetch('/api/auth/validate-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionToken }),
            })
            if (res.ok) {
              const data = await res.json()
              if (data.valid && data.userId) {
                if (data.access_token && data.refresh_token) {
                  await setSupabaseSession(data.access_token, data.refresh_token)
                }
                persistAuthState({ userId: data.userId, sessionToken, onboarding: data.onboarding, cards: data.cards, transactions: data.transactions })
                console.log('[AUTH] ✅ Authenticated via stored session token')
                setIsAuthReady(true)
                return
              }
            }
          } catch (err) {
            console.error('[AUTH] Session validation network error:', err)
          }
        }

        // ===== STEP 6: Resume polling for pending login request (mobile redirect recovery) =====
        const pendingRequestId = localStorage.getItem('moliya_pending_request_id')
        if (pendingRequestId) {
          console.log('[AUTH] Found pending login request, resuming polling...')
          resumePolling(pendingRequestId)
        }

        // ===== STEP 7: Local fallback =====
        const savedUserId = localStorage.getItem('user_id_v1')
        if (savedUserId && localStorage.getItem('user_logged_in_v1') === 'true') {
          setUserId(savedUserId)
          localStorage.setItem('user_onboarding_completed_v1', 'true')
          console.log('[AUTH] Restored from localStorage fallback')
        }
      } catch (e) {
        console.error('[AUTH] Authentication error:', e)
      } finally {
        setIsAuthReady(true)
      }
    }
    authenticate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ═══════════════════════════════════════════════════════════
  // Supabase Auth State Listener
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AUTH] onAuthStateChange event:', event)
      if (event === 'SIGNED_OUT') {
        setUserId(null)
        localStorage.removeItem('user_logged_in_v1')
        localStorage.removeItem('user_session_token_v1')
        localStorage.removeItem('user_id_v1')
        window.dispatchEvent(new Event('user_logged_in_updated'))
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        console.log('[AUTH] Token refreshed successfully')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // ═══════════════════════════════════════════════════════════
  // POLLING HELPER — resumes polling for a login request
  // Used both during initial login and after mobile redirect recovery
  // ═══════════════════════════════════════════════════════════
  function resumePolling(requestId: string, onVerified?: () => void) {
    let intervalId: any = null
    let isFinished = false

    const checkVerification = async () => {
      if (isFinished) return
      try {
        const res = await fetch(`/api/auth/check-login-request?requestId=${requestId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'VERIFIED' && data.userId) {
            isFinished = true
            if (intervalId) clearInterval(intervalId)
            window.removeEventListener('focus', onTabActive)
            document.removeEventListener('visibilitychange', onTabActive)

            // Set real Supabase Auth session if available
            if (data.access_token && data.refresh_token) {
              await setSupabaseSession(data.access_token, data.refresh_token)
            }

            const currentOnboarding = JSON.parse(localStorage.getItem('user_onboarding_v1') || '{}')
            const savedLang = localStorage.getItem('user_selected_language_v1')
            const updatedOnboarding = {
              ...currentOnboarding,
              ...(data.onboarding || {}),
              completed: true,
              language: savedLang || data.onboarding?.language || currentOnboarding.language || 'uz',
              phone: data.phone || data.onboarding?.phone || currentOnboarding.phone || '',
            }

            persistAuthState({
              userId: data.userId,
              sessionToken: data.sessionToken,
              onboarding: updatedOnboarding,
              cards: data.cards,
              transactions: data.transactions,
            })

            localStorage.removeItem('moliya_pending_request_id')
            if (onVerified) onVerified()
          }
        }
      } catch (err) {
        console.error('[AUTH] Polling error:', err)
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

    intervalId = setInterval(checkVerification, 1500)

    // Auto-cancel after 2 minutes
    setTimeout(() => {
      if (!isFinished) {
        isFinished = true
        if (intervalId) clearInterval(intervalId)
        window.removeEventListener('focus', onTabActive)
        document.removeEventListener('visibilitychange', onTabActive)
      }
    }, 120000)

    return () => {
      isFinished = true
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
  const startTelegramLogin = async (onVerified?: () => void) => {
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'req_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const botUrl = `https://t.me/moliya_v2bot?start=req_${requestId}`;
    const tgDeepLink = `tg://resolve?domain=moliya_v2bot&start=req_${requestId}`;

    // Save the request ID BEFORE navigating away so we can resume on return
    localStorage.setItem('moliya_pending_request_id', requestId)

    // Register with backend first
    fetch('/api/auth/create-login-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    }).catch(() => {});

    // Start polling immediately (works when desktop, also works when page isn't destroyed)
    resumePolling(requestId, onVerified)

    try {
      const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        // On mobile, window.open() is blocked by popup blockers.
        // window.location.href is the only reliable way to open Telegram.
        // The requestId is saved in localStorage so polling resumes when user returns.
        window.location.href = tgDeepLink;
      } else {
        // On desktop, open in new tab
        const link = document.createElement('a');
        link.href = botUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      window.location.href = botUrl;
    }

    return {
      requestId,
      cancel: () => {
        localStorage.removeItem('moliya_pending_request_id')
      }
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Supabase Real-Time User & Data Syncing
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!userId || !isAuthReady) return;

    // Load initial user document from Supabase
    supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          if (data.onboarding) {
            setOnboarding(data.onboarding);
            localStorage.setItem('user_onboarding_v1', JSON.stringify(data.onboarding));
          }
          if (Array.isArray(data.cards)) {
            setCards(data.cards);
            localStorage.setItem('user_cards_v1', JSON.stringify(data.cards));
          }
          if (Array.isArray(data.transactions)) {
            setCustomTransactions(data.transactions);
            localStorage.setItem('user_transactions_v1', JSON.stringify(data.transactions));
          }
        }
      });

    // Realtime channel listener for instant multi-device syncing
    const channel = supabase
      .channel(`user-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
        (payload: any) => {
          const newData = payload.new;
          if (newData) {
            if (newData.onboarding) {
              setOnboarding(newData.onboarding);
              localStorage.setItem('user_onboarding_v1', JSON.stringify(newData.onboarding));
            }
            if (Array.isArray(newData.cards)) {
              setCards(newData.cards);
              localStorage.setItem('user_cards_v1', JSON.stringify(newData.cards));
            }
            if (Array.isArray(newData.transactions)) {
              setCustomTransactions(newData.transactions);
              localStorage.setItem('user_transactions_v1', JSON.stringify(newData.transactions));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, isAuthReady]);

  // ═══════════════════════════════════════════════════════════
  // Context Functions with Supabase Persistence
  // ═══════════════════════════════════════════════════════════
  const updateOnboarding = async (newData: Partial<OnboardingResult>) => {
    const updated = onboarding ? { ...onboarding, ...newData } : (newData as OnboardingResult);
    setOnboarding(updated);
    localStorage.setItem('user_onboarding_v1', JSON.stringify(updated));

    if (userId) {
      const nowIso = new Date().toISOString();
      await supabase.from('users').upsert({
        id: userId,
        name: updated.name || '—',
        phone: updated.phone || null,
        telegram: updated.telegram || '—',
        telegram_id: updated.telegramId || null,
        language: updated.language || 'uz',
        is_premium: !!updated.isPremium,
        onboarding: updated,
        updated_at: nowIso
      }, { onConflict: 'id' });
    }
  };

  const saveCards = async (updatedCards: Card[]) => {
    setCards(updatedCards);
    localStorage.setItem('user_cards_v1', JSON.stringify(updatedCards));

    if (userId) {
      await supabase.from('users').update({
        cards: updatedCards,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }
  };

  const updateSecurity = async (updatedSec: SecurityOpts) => {
    setSecurity(updatedSec);
  };

  const addTransaction = async (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number }) => {
    const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    const newTx: Transaction = {
      id: tx.id ? String(tx.id) : (Date.now().toString() + Math.random().toString(36).substring(2, 6)),
      type: tx.type,
      amount: tx.amount,
      note: tx.note,
      category: tx.category,
      title: tx.title,
      debtWho: tx.debtWho,
      messageId: tx.messageId,
      cardId: tx.cardId || 'cash',
      date: tx.date || localISOTime
    };

    setCustomTransactions(prev => {
      const updated = [newTx, ...prev];
      localStorage.setItem('user_transactions_v1', JSON.stringify(updated));
      window.dispatchEvent(new Event('user_transactions_updated'));
  
      if (userId) {
        supabase.from('users').update({
          transactions: updated,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }
      return updated;
    });
  };

  const deleteTransaction = async (id: string | number) => {
    const idStr = String(id);
    const updatedDeleted = Array.from(new Set([...deletedTxIds, idStr]));
    setDeletedTxIds(updatedDeleted);
    localStorage.setItem('user_deleted_tx_ids_v1', JSON.stringify(updatedDeleted));

    setCustomTransactions(prev => {
      const updatedTxs = prev.filter(t => String(t.id) !== idStr);
      localStorage.setItem('user_transactions_v1', JSON.stringify(updatedTxs));
      window.dispatchEvent(new Event('user_transactions_updated'));
  
      if (userId) {
        supabase.from('users').update({
          transactions: updatedTxs,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }
      return updatedTxs;
    });
  };

  const clearAllData = async () => {
    if (userId) {
      await supabase.from('users').delete().eq('id', userId);
    }
    localStorage.clear();
    setOnboarding(null);
    setCards([]);
    setCustomTransactions([]);
    setDeletedTxIds([]);
    setHasSampleDataState(false);
  };

  const clearOnlyFinancialData = async () => {
    if (userId) {
      await supabase.from('users').update({
        transactions: [],
        cards: [],
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }
    localStorage.removeItem('user_transactions_v1');
    localStorage.removeItem('user_cards_v1');
    setCustomTransactions([]);
    setCards([]);
  };

  const logout = () => {
    // Sign out from real Supabase Auth
    supabase.auth.signOut().catch(() => {});
    // Clear all custom tokens and cached data
    localStorage.removeItem('user_logged_in_v1');
    localStorage.removeItem('user_session_token_v1');
    localStorage.removeItem('user_id_v1');
    localStorage.removeItem('user_onboarding_v1');
    localStorage.removeItem('user_onboarding_completed_v1');
    localStorage.removeItem('user_onboarding_pre_completed_v1');
    localStorage.removeItem('user_cards_v1');
    localStorage.removeItem('user_transactions_v1');
    localStorage.removeItem('user_security_v1');
    localStorage.removeItem('user_has_sample_v1');
    localStorage.removeItem('moliya_pending_request_id');
    setUserId(null);
    setOnboarding(null);
    setCards([]);
    setCustomTransactions([]);
    setDeletedTxIds([]);
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
        updateOnboarding,
        saveCards,
        updateSecurity,
        addTransaction,
        deleteTransaction,
        clearAllData,
        clearOnlyFinancialData,
        logout,
        setDateRange,
        startTelegramLogin,
      }}
    >
      {children}
    </FinanceContext.Provider>
  )
}
