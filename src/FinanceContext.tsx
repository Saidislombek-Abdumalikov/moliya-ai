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
  const persistAuthState = (data: { userId: string; sessionToken?: string; access_token?: string; refresh_token?: string; onboarding?: any; cards?: any[]; transactions?: any[] }) => {
    setUserId(data.userId)
    localStorage.setItem('user_id_v1', data.userId)
    if (data.sessionToken) {
      localStorage.setItem('user_session_token_v1', data.sessionToken)
    }
    localStorage.setItem('user_logged_in_v1', 'true')
    if (data.onboarding) {
      setOnboarding(data.onboarding)
      localStorage.setItem('user_onboarding_v1', JSON.stringify(data.onboarding))
    }
    if (Array.isArray(data.cards) && data.cards.length > 0) {
      setCards(data.cards)
      localStorage.setItem('user_cards_v1', JSON.stringify(data.cards))
    }
    if (Array.isArray(data.transactions)) {
      setCustomTransactions(data.transactions)
      localStorage.setItem('user_transactions_v1', JSON.stringify(data.transactions))
    }
    window.dispatchEvent(new Event('user_logged_in_updated'))
  }

  // 1. Authenticate: Real Supabase Auth session + custom token fallback
  useEffect(() => {
    async function authenticate() {
      try {
        console.log('[AUTH] Initializing authentication...');

        // ===== STEP 0: Check for existing real Supabase Auth session =====
        const { data: existingSession } = await supabase.auth.getSession()
        if (existingSession?.session?.user) {
          const tgId = existingSession.session.user.user_metadata?.telegram_id
          if (tgId) {
            const profileId = `moliya_user_tg_${tgId}`
            setUserId(profileId)
            localStorage.setItem('user_id_v1', profileId)
            localStorage.setItem('user_logged_in_v1', 'true')
            console.log('[AUTH] ✅ Restored from existing Supabase Auth session')
            window.dispatchEvent(new Event('user_logged_in_updated'))
            setIsAuthReady(true)
            return
          }
        }

        // ===== STEP 1: Check for URL ?s= parameter (session token from bot URL) =====
        const urlParams = new URLSearchParams(window.location.search)
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
                // Set real Supabase Auth session
                if (data.access_token && data.refresh_token) {
                  await setSupabaseSession(data.access_token, data.refresh_token)
                }
                persistAuthState({ userId: data.userId, sessionToken: sessionParam, access_token: data.access_token, refresh_token: data.refresh_token, onboarding: data.onboarding, cards: data.cards, transactions: data.transactions })
                // Clean URL
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

        // ===== STEP 2: Check for URL ?req= parameter (polling redirect) =====
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
                persistAuthState({ userId: data.userId, sessionToken: data.sessionToken, access_token: data.access_token, refresh_token: data.refresh_token, onboarding: data.onboarding })
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

        // ===== STEP 3: Check stored 60-day custom session token =====
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
                persistAuthState({ userId: data.userId, sessionToken, access_token: data.access_token, refresh_token: data.refresh_token, onboarding: data.onboarding, cards: data.cards, transactions: data.transactions })
                console.log('[AUTH] ✅ Authenticated via stored session token')
                setIsAuthReady(true)
                return
              }
            }
          } catch (err) {
            console.error('[AUTH] Session validation network error:', err)
          }
        }

        // ===== STEP 4: Telegram Mini App native container check =====
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
        if (tg && (initData || initDataUnsafe?.user?.id)) {
          try {
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
                persistAuthState({ userId: data.userId, sessionToken: data.sessionToken, access_token: data.access_token, refresh_token: data.refresh_token, onboarding: data.onboarding, cards: data.cards, transactions: data.transactions })
                console.log('[AUTH] ✅ Authenticated via Telegram Mini App initData')
                setIsAuthReady(true)
                return
              }
            }
          } catch (err) {
            console.error('[AUTH] Telegram initData auth error:', err)
          }
        }

        // ===== STEP 5: Local fallback (returning user with localStorage) =====
        const savedUserId = localStorage.getItem('user_id_v1')
        if (savedUserId && localStorage.getItem('user_logged_in_v1') === 'true') {
          setUserId(savedUserId)
          console.log('[AUTH] Restored from localStorage fallback (no Supabase Auth session)')
        }
      } catch (e) {
        console.error('[AUTH] Authentication error:', e)
      } finally {
        setIsAuthReady(true)
      }
    }
    authenticate()
  }, [])

  // Listen for Supabase Auth state changes (auto-refresh, sign-out, etc.)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AUTH] onAuthStateChange event:', event)
      if (event === 'SIGNED_OUT') {
        // User was signed out, clear local state
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

  // 2. Start Telegram Login with Polling & Instant Visibility Listeners
  const startTelegramLogin = async (onVerified?: () => void) => {
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'req_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const botUrl = `https://t.me/moliya_v2bot?start=req_${requestId}`;
    const tgDeepLink = `tg://resolve?domain=moliya_v2bot&start=req_${requestId}`;

    try {
      const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        // FIX: Use window.open() instead of window.location.href to keep the page alive
        // so that the polling continues even after Telegram opens
        const opened = window.open(tgDeepLink, '_blank');
        if (!opened) {
          // Fallback: try the https URL which is more likely to work with window.open
          const opened2 = window.open(botUrl, '_blank');
          if (!opened2) {
            // Last resort: use href but the polling might break — this is the old broken behavior
            window.location.href = botUrl;
          }
        }
      } else {
        const link = document.createElement('a');
        link.href = botUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      window.open(botUrl, '_blank') || (window.location.href = botUrl);
    }

    // Register with backend
    fetch('/api/auth/create-login-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    }).catch(() => {});

    let intervalId: any = null;
    let isFinished = false;

    const checkVerification = async () => {
      if (isFinished) return;
      try {
        const res = await fetch(`/api/auth/check-login-request?requestId=${requestId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'VERIFIED' && data.userId) {
            isFinished = true;
            if (intervalId) clearInterval(intervalId);
            window.removeEventListener('focus', onTabActive);
            document.removeEventListener('visibilitychange', onTabActive);

            // Set real Supabase Auth session if available
            if (data.access_token && data.refresh_token) {
              await setSupabaseSession(data.access_token, data.refresh_token)
            }

            setUserId(data.userId);
            localStorage.setItem('user_id_v1', data.userId);
            if (data.sessionToken) {
              localStorage.setItem('user_session_token_v1', data.sessionToken);
            }
            localStorage.setItem('user_logged_in_v1', 'true');

            const currentOnboarding = JSON.parse(localStorage.getItem('user_onboarding_v1') || '{}');
            const savedLang = localStorage.getItem('user_selected_language_v1');
            const updatedOnboarding = {
              ...currentOnboarding,
              ...(data.onboarding || {}),
              completed: true,
              language: savedLang || data.onboarding?.language || currentOnboarding.language || 'uz',
              phone: data.phone || data.onboarding?.phone || currentOnboarding.phone || '',
            };

            setOnboarding(updatedOnboarding);
            localStorage.setItem('user_onboarding_v1', JSON.stringify(updatedOnboarding));

            window.dispatchEvent(new Event('user_logged_in_updated'));
            if (onVerified) onVerified();
          }
        }
      } catch (err) {
        console.error('[AUTH] Polling error:', err);
      }
    };

    const onTabActive = () => {
      if (document.visibilityState === 'visible' || document.hasFocus()) {
        checkVerification();
      }
    };

    window.addEventListener('focus', onTabActive);
    document.addEventListener('visibilitychange', onTabActive);

    intervalId = setInterval(checkVerification, 1000);

    const cancel = () => {
      isFinished = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', onTabActive);
      document.removeEventListener('visibilitychange', onTabActive);
    };

    setTimeout(() => {
      cancel();
    }, 120000);

    return { requestId, cancel };
  };

  // 3. Supabase Real-Time User & Data Syncing
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

  // Context Functions with Supabase Persistence
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

    const updated = [newTx, ...customTransactions];
    setCustomTransactions(updated);
    localStorage.setItem('user_transactions_v1', JSON.stringify(updated));
    window.dispatchEvent(new Event('user_transactions_updated'));

    if (userId) {
      await supabase.from('users').update({
        transactions: updated,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }
  };

  const deleteTransaction = async (id: string | number) => {
    const idStr = String(id);
    const updatedDeleted = Array.from(new Set([...deletedTxIds, idStr]));
    setDeletedTxIds(updatedDeleted);
    localStorage.setItem('user_deleted_tx_ids_v1', JSON.stringify(updatedDeleted));

    const updatedTxs = customTransactions.filter(t => String(t.id) !== idStr);
    setCustomTransactions(updatedTxs);
    localStorage.setItem('user_transactions_v1', JSON.stringify(updatedTxs));
    window.dispatchEvent(new Event('user_transactions_updated'));

    if (userId) {
      await supabase.from('users').update({
        transactions: updatedTxs,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }
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
    // Clear custom tokens
    localStorage.removeItem('user_logged_in_v1');
    localStorage.removeItem('user_session_token_v1');
    localStorage.removeItem('user_id_v1');
    localStorage.removeItem('user_onboarding_v1');
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
