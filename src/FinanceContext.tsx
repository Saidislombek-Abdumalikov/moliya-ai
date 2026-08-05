import React, { createContext, useContext, useState, useEffect } from 'react'
import { doc, onSnapshot, setDoc, collection, query, where, orderBy, getDocs, deleteDoc, limit } from 'firebase/firestore'
import { db } from './firebase'
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
  updateOnboarding: (newData: Partial<OnboardingResult>) => Promise<void>
  saveCards: (updated: Card[]) => Promise<void>
  updateSecurity: (updated: SecurityOpts) => Promise<void>
  addTransaction: (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number }) => Promise<void>
  deleteTransaction: (id: string | number) => Promise<void>
  clearAllData: () => Promise<void>
  setDateRange: (range: { start: Date; end: Date }) => void
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined)

export function useFinance() {
  const context = useContext(FinanceContext)
  if (!context) {
    throw new Error('useFinance must be used within a FinanceProvider')
  }
  return context
}

export const baseTransactions = [
  { id: 'sample-1', type: 'expense', name: 'Korzinka', category: 'Oziq-ovqat', amount: -85000, emoji: '🛒', color: '#FEF2F2', dot: '#DC2626' },
  { id: 'sample-2', type: 'income', name: 'Maosh', category: 'Daromad', amount: 4500000, emoji: '💼', color: '#F0FDF4', dot: '#16A34A' },
  { id: 'sample-3', type: 'expense', name: 'Netflix', category: "Ko'ngil ochar", amount: -49000, emoji: '🎬', color: '#FEF2F2', dot: '#DC2626' },
  { id: 'sample-4', type: 'expense', name: 'Uber', category: 'Transport', amount: -23000, emoji: '🚗', color: '#FEF2F2', dot: '#DC2626' },
  { id: 'sample-5', type: 'expense', name: 'Apelsin', category: 'Kommunal', amount: -120000, emoji: '💡', color: '#FEF2F2', dot: '#DC2626' },
]

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Get or create unique userId
  const [userId, setUserId] = useState<string | null>(() => {
    const saved = localStorage.getItem('user_id_v1')
    if (saved && saved.startsWith('moliya_user_')) {
      return saved
    }
    return null
  })

  // Synchronous state initialization from localStorage for instant boot
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

  const [security, setSecurity] = useState<SecurityOpts>(() => {
    try {
      const saved = localStorage.getItem('user_security_v1')
      return saved ? JSON.parse(saved) : { pinEnabled: false, faceIdEnabled: false, pinCode: '' }
    } catch {
      return { pinEnabled: false, faceIdEnabled: false, pinCode: '' }
    }
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
    if (saved === 'true') return true
    return false
  })

  const setHasSampleData = async (val: boolean) => {
    setHasSampleDataState(val)
    localStorage.setItem('user_has_sample_v1', String(val))
    if (userId) {
      await setDoc(doc(db, 'users', userId!), { hasSampleData: val }, { merge: true })
    }
  }

  const [loading, setLoading] = useState(true)

  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  })

  const [isAuthReady, setIsAuthReady] = useState(false)

  // Authenticate with Backend
  useEffect(() => {
    async function authenticate() {
      try {
        // 0. Check Deep Link URL parameters (e.g. ?tg_user_id=123456&name=Saidislom)
        const urlParams = new URLSearchParams(window.location.search);
        const urlTgUserId = urlParams.get('tg_user_id');
        const urlName = urlParams.get('name');
        const urlUsername = urlParams.get('username');
        const urlPhone = urlParams.get('phone');

        if (urlTgUserId) {
          const fullUserId = 'tg_user_' + urlTgUserId;
          setUserId(fullUserId);
          localStorage.setItem('user_id_v1', fullUserId);
          localStorage.setItem('user_logged_in_v1', 'true');

          const currentOnboarding = JSON.parse(localStorage.getItem('user_onboarding_v1') || '{}');
          const savedLang = localStorage.getItem('user_selected_language_v1');
          const updatedOnboarding = {
            ...currentOnboarding,
            completed: true,
            language: savedLang || currentOnboarding.language || 'uz',
            name: urlName || currentOnboarding.name || 'Telegram Foydalanuvchi',
            phone: urlPhone || currentOnboarding.phone || '',
            telegram: urlUsername ? (urlUsername.startsWith('@') ? urlUsername : '@' + urlUsername) : currentOnboarding.telegram || '@moliya_user',
            telegramId: urlTgUserId,
          };
          setOnboarding(updatedOnboarding);
          localStorage.setItem('user_onboarding_v1', JSON.stringify(updatedOnboarding));
          setIsAuthReady(true);
          return;
        }

        const tg = (window as any).Telegram?.WebApp;
        const tgUser = tg?.initDataUnsafe?.user;

        if (tgUser && tgUser.id) {
          const fullUserId = 'tg_user_' + tgUser.id;
          setUserId(fullUserId);
          localStorage.setItem('user_id_v1', fullUserId);
          localStorage.setItem('user_logged_in_v1', 'true');

          const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
          const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

          const currentOnboarding = JSON.parse(localStorage.getItem('user_onboarding_v1') || '{}');
          const updatedOnboarding = {
            ...currentOnboarding,
            completed: true,
            language: currentOnboarding.language || 'uz',
            name: tgName,
            telegram: tgUsername,
            telegramId: String(tgUser.id),
          };
          setOnboarding(updatedOnboarding);
          localStorage.setItem('user_onboarding_v1', JSON.stringify(updatedOnboarding));
          setIsAuthReady(true);
          return;
        }

        let res;
        if (tg && tg.initData) {
          res = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData })
          });
        } else {
          // Use fallback sandbox mode
          let uid = localStorage.getItem('mock_external_id')
          if (!uid) {
            uid = 'mock_' + Math.random().toString(36).substring(2, 11)
            localStorage.setItem('mock_external_id', uid)
          }
          try {
            res = await fetch('/api/auth/fallback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mockUid: uid })
            });
          } catch {
            // API unavailable — use local-only userId
            const localId = 'moliya_user_' + uid;
            setUserId(localId);
            localStorage.setItem('user_id_v1', localId);
            setIsAuthReady(true);
            return;
          }
        }
        
        if (res && res.ok && res.headers.get('content-type')?.includes('application/json')) {
          try {
            const data = await res.json();
            if (data.userId) {
              setUserId(data.userId);
              localStorage.setItem('user_id_v1', data.userId);
              if (data.user) {
                const tgName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
                const tgUsername = data.user.username ? '@' + data.user.username : '@moliya_user';
                const tgPhone = data.user.phone_number || '';
                
                const currentOnboarding = JSON.parse(localStorage.getItem('user_onboarding_v1') || '{}');
                const updatedOnboarding = {
                  ...currentOnboarding,
                  name: currentOnboarding.name || tgName,
                  telegram: tgUsername,
                  phone: tgPhone || currentOnboarding.phone || '',
                };
                setOnboarding(updatedOnboarding);
                localStorage.setItem('user_onboarding_v1', JSON.stringify(updatedOnboarding));
                localStorage.setItem('user_logged_in_v1', 'true');
              }
            } else {
              throw new Error('No userId in response');
            }
          } catch {
            // JSON parse failed or no userId — fallback
            let uid = localStorage.getItem('mock_external_id')
            if (!uid) {
              uid = 'mock_' + Math.random().toString(36).substring(2, 11)
              localStorage.setItem('mock_external_id', uid)
            }
            const localId = 'moliya_user_' + uid;
            setUserId(localId);
            localStorage.setItem('user_id_v1', localId);
          }
        } else {
          // API returned error or non-JSON — fallback to local userId
          let uid = localStorage.getItem('mock_external_id')
          if (!uid) {
            uid = 'mock_' + Math.random().toString(36).substring(2, 11)
            localStorage.setItem('mock_external_id', uid)
          }
          const localId = 'moliya_user_' + uid;
          setUserId(localId);
          localStorage.setItem('user_id_v1', localId);
        }
      } catch(e) {
        console.error('Authentication error:', e);
        // Final fallback — never leave userId null
        let uid = localStorage.getItem('mock_external_id')
        if (!uid) {
          uid = 'mock_' + Math.random().toString(36).substring(2, 11)
          localStorage.setItem('mock_external_id', uid)
        }
        const localId = 'moliya_user_' + uid;
        setUserId(localId);
        localStorage.setItem('user_id_v1', localId);
      } finally {
        setIsAuthReady(true);
      }
    }
    authenticate();
  }, [])

  // Sync to Firestore and LocalStorage
  useEffect(() => {
    if (!userId || !isAuthReady) return

    const docRef = doc(db, 'users', userId!)

    // Listen to real-time changes for user doc
    const unsubscribeUser = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data()
        
        if (data.onboarding !== undefined) {
          setOnboarding(data.onboarding)
          localStorage.setItem('user_onboarding_v1', JSON.stringify(data.onboarding))
        }
        if (data.cards !== undefined) {
          setCards(data.cards)
          localStorage.setItem('user_cards_v1', JSON.stringify(data.cards))
        }
        if (data.security !== undefined) {
          setSecurity(data.security)
          localStorage.setItem('user_security_v1', JSON.stringify(data.security))
        }
        if (data.deletedTxIds !== undefined) {
          setDeletedTxIds(data.deletedTxIds)
          localStorage.setItem('user_deleted_tx_ids_v1', JSON.stringify(data.deletedTxIds))
        }
      } else {
        // Seed Firestore if document doesn't exist yet but we have local data
        setDoc(docRef, {
          onboarding,
          cards,
          security,
          deletedTxIds,
        }, { merge: true }).catch((err) => {
          console.error('Error seeding user document:', err)
        })
      }
      setLoading(false)
    }, (error) => {
      console.error('Firestore listener error:', error)
      setLoading(false)
    })

    return () => unsubscribeUser()
  }, [userId, isAuthReady])


  const deleteTransaction = async (id: string | number) => {
    try {
      const idStr = String(id)
      const updated = Array.from(new Set([...deletedTxIds, idStr]))
      setDeletedTxIds(updated)
      localStorage.setItem('user_deleted_tx_ids_v1', JSON.stringify(updated))

      if (userId) {
        const userDocRef = doc(db, 'users', userId!)
        await setDoc(userDocRef, { deletedTxIds: updated }, { merge: true })

        const customTxRef = doc(db, 'users', userId!, 'transactions', idStr)
        await deleteDoc(customTxRef)
      }
    } catch (e) {
      console.error('Failed to delete transaction:', e)
    }
  }

  // Subcollection query for transactions
  useEffect(() => {
    if (!userId || !isAuthReady) return
      const txRef = collection(db, 'users', userId!, 'transactions')
      const q = query(
        txRef,
        orderBy('date', 'desc'),
        limit(1000)
      )

      const unsubscribeTx = onSnapshot(q, (snap: any) => {
        const txs: Transaction[] = []
        snap.forEach((doc: any) => txs.push({ id: doc.id, ...doc.data() } as Transaction))
        setCustomTransactions(txs)
        localStorage.setItem('user_transactions_v1', JSON.stringify(txs))
        window.dispatchEvent(new Event('user_transactions_updated'))
      }, (err: any) => {
        console.error('Transactions listener error:', err)
      })

      return () => unsubscribeTx()
  }, [userId, dateRange, isAuthReady])


  // Context Functions
  const updateOnboarding = async (newData: Partial<OnboardingResult>) => {
    const updated = onboarding ? { ...onboarding, ...newData } : (newData as OnboardingResult)
    setOnboarding(updated)
    localStorage.setItem('user_onboarding_v1', JSON.stringify(updated))

    try {
      await setDoc(doc(db, 'users', userId!), { onboarding: updated }, { merge: true })
    } catch (e) {
      console.error('Failed to update onboarding in Firestore:', e)
    }
  }

  const saveCards = async (updatedCards: Card[]) => {
    setCards(updatedCards)
    localStorage.setItem('user_cards_v1', JSON.stringify(updatedCards))

    try {
      await setDoc(doc(db, 'users', userId!), { cards: updatedCards }, { merge: true })
    } catch (e) {
      console.error('Failed to save cards in Firestore:', e)
    }
  }

  const updateSecurity = async (updatedSec: SecurityOpts) => {
    setSecurity(updatedSec)
    localStorage.setItem('user_security_v1', JSON.stringify(updatedSec))

    try {
      await setDoc(doc(db, 'users', userId!), { security: updatedSec }, { merge: true })
    } catch (e) {
      console.error('Failed to save security in Firestore:', e)
    }
  }

  const addTransaction = async (tx: Omit<Transaction, 'id' | 'date'> & { id?: string | number; date?: string; messageId?: string | number }) => {
    try {
      if (!userId) {
        console.error('Cannot add transaction without userId')
        return
      }

      if (tx.messageId) {
        const txRef = collection(db, 'users', userId, 'transactions')
        const q = query(txRef, where('messageId', '==', tx.messageId))
        const querySnapshot = await getDocs(q)
        if (!querySnapshot.empty) {
          console.log('Transaction with messageId already exists, ignoring:', tx.messageId)
          return
        }
      }

      const customTx: any = {
        type: tx.type || 'expense',
        amount: tx.amount || 0,
        note: tx.note || tx.category || 'Boshqa',
        category: tx.category || 'Boshqa',
        date: tx.date || new Date().toISOString(),
      }
      if (tx.messageId) customTx.messageId = tx.messageId;
      if (tx.title !== undefined) customTx.title = tx.title;
      if (tx.debtWho !== undefined) customTx.debtWho = tx.debtWho;
      if (tx.cardId !== undefined) customTx.cardId = tx.cardId;

      const docRef = tx.id ? doc(db, 'users', userId, 'transactions', String(tx.id)) : doc(collection(db, 'users', userId, 'transactions'))
      
      // Optimistic update
      const optimisticTx = { id: docRef.id, ...customTx } as Transaction
      setCustomTransactions(prev => {
        const exists = prev.some(p => p.id === optimisticTx.id)
        if (exists) return prev.map(p => p.id === optimisticTx.id ? optimisticTx : p)
        return [...prev, optimisticTx]
      })

      await setDoc(docRef, customTx)
    } catch (e) {
      console.error('Failed to add transaction to Firestore:', e)
    }
  }

  const clearAllData = async () => {
    try {
      if (!userId) return

      // Clear Firestore document — wipe all financial data but keep userId
      await setDoc(doc(db, 'users', userId), {
        onboarding: null,
        cards: [],
        security: { pinEnabled: false, faceIdEnabled: false, pinCode: '' },
        deletedTxIds: [],
        hasSampleData: false
      }, { merge: true })

      // Attempt to delete custom transactions from Firestore
      try {
        const txRef = collection(db, 'users', userId, 'transactions')
        const q = query(txRef)
        const snap = await getDocs(q)
        const deletePromises = snap.docs.map(d => deleteDoc(d.ref))
        await Promise.all(deletePromises)
      } catch (e) {
        console.error('Failed to delete transactions from Firestore:', e)
      }

      // Remove all financial localStorage keys, including onboarding
      localStorage.removeItem('user_onboarding_v1')
      localStorage.removeItem('user_cards_v1')
      localStorage.removeItem('user_security_v1')
      localStorage.removeItem('user_deleted_tx_ids_v1')
      localStorage.removeItem('user_transactions_v1')
      localStorage.setItem('user_has_sample_v1', 'false')

      // Clear all react state in memory
      setOnboarding(null)
      setCards([])
      setSecurity({ pinEnabled: false, faceIdEnabled: false, pinCode: '' })
      setDeletedTxIds([])
      setCustomTransactions([])
      setHasSampleDataState(false)
    } catch (e) {
      console.error('Failed to clear data:', e)
    }
  }

  if (!isAuthReady) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', background: '#FFFFFF' }}><p>Loading...</p></div>
  }

  if (!userId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100dvh', background: '#FFFFFF', padding: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#e53e3e' }}>Authentication Error</h2>
        <p style={{ textAlign: 'center', color: '#666', maxWidth: 400, marginBottom: 20 }}>Failed to authenticate. Please ensure you are opening this app from Telegram or try reloading the application.</p>
        <button 
          onClick={() => window.location.reload()}
          style={{ padding: '12px 24px', background: '#000', color: '#fff', borderRadius: 8, fontSize: 16, fontWeight: 'bold', border: 'none', cursor: 'pointer' }}
        >
          Reload App
        </button>
      </div>
    )
  }

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
        updateOnboarding,
        saveCards,
        updateSecurity,
        addTransaction,
        deleteTransaction,
        clearAllData,
        setDateRange,
      }}
    >
      {children}
    </FinanceContext.Provider>
  )
}
