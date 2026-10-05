import {dismissInstall,installDismissed,pendingInstall,telegramInstallBlocked,installCompleted,consumeInstall} from '../installPrompt'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { isTelegramMiniApp } from '../FinanceContext'

export default function InstallPromptModal() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [installGuide, setInstallGuide] = useState<'ios' | 'mac' | 'browser' | null>(null)

  useEffect(() => {
    const blocked=()=>isTelegramMiniApp() || telegramInstallBlocked();
    if(blocked()) return;
    setIsInstalled(installCompleted());
    const ios=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    const macSafari=/Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
    const guide=ios?'ios':macSafari?'mac':null;
    setInstallGuide(guide);
    const show=(manual=false)=>{
      if(blocked() || installCompleted() || (!manual && installDismissed())){setShowModal(false);return;}
      const event=pendingInstall(); setDeferredPrompt(event);
      setInstallGuide(event ? null : guide || 'browser');
      setShowModal(true);
    };
    const installed=()=>{setIsInstalled(true);setShowModal(false);};
    const available=()=>{setIsInstalled(installCompleted());show();};
    const manual=()=>show(true);
    const timer=setTimeout(()=>show(),2000);
    window.addEventListener('moliya_install_available',available);
    window.addEventListener('open_install_prompt',manual);
    window.addEventListener('moliya_install_completed',installed);
    return ()=>{clearTimeout(timer);window.removeEventListener('moliya_install_available',available);window.removeEventListener('open_install_prompt',manual);window.removeEventListener('moliya_install_completed',installed);};
  }, [])

  if (isTelegramMiniApp() || telegramInstallBlocked() || isInstalled) return null
  const handleInstallClick = async () => {
    if(isTelegramMiniApp() || telegramInstallBlocked())return;
    const event=consumeInstall();
    dismissInstall(); setShowModal(false); setDeferredPrompt(null);
    if(event) {
      try {await event.prompt();await event.userChoice;}
      catch { /* Allow another attempt from Profile or on a later visit. */ }
    }
  }

  const handleDismiss = () => {dismissInstall();setShowModal(false);setDeferredPrompt(null);}

  if (!showModal) return null
  if (!installGuide && !deferredPrompt) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 70, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 70, scale: 0.95 }}
        transition={{ type: 'spring', damping: 24, stiffness: 300 }}
        style={{
          position: 'fixed',
          bottom: 80,
          left: 16,
          right: 16,
          zIndex: 9998,
          maxWidth: 400,
          margin: '0 auto',
          background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
          color: '#FFFFFF',
          borderRadius: 20,
          padding: '12px 14px',
          boxShadow: '0 16px 36px rgba(49, 46, 129, 0.45), 0 4px 12px rgba(0, 0, 0, 0.2)',
          border: '1.5px solid rgba(199, 210, 254, 0.25)',
          display: 'flex',
          flexDirection: installGuide ? 'column' : 'row',
          alignItems: installGuide ? 'stretch' : 'center',
          justifyContent: 'space-between',
          gap: 10,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
                border: '1.5px solid rgba(255, 255, 255, 0.2)'
              }}
            >
              📲
            </div>
            <div style={{ minWidth: 0 }}>
              <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 800, color: '#FFFFFF' }}>
                {installGuide==='mac' ? "Dock'ka qo'shish" : "Asosiy ekranga o'rnatib oling"}
              </h4>
              <p style={{ margin: 0, fontSize: 11, color: '#C7D2FE', lineHeight: 1.3 }}>
                {installGuide
                  ? "Bosh ekrandan qulay va tezkor kirish"
                  : "Tezkor kirish uchun ilovani o'rnating"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.12)',
              border: 'none',
              color: '#E0E7FF',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0
            }}
          >
            ✕
          </button>
        </div>

        {installGuide ? (
          <div style={{
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 12,
            padding: '8px 12px',
            fontSize: 11.5,
            color: '#E0E7FF',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 2
          }}>
            <span style={{ fontSize: 16 }}>⎋</span>
            <span>
              {installGuide==='mac'
                ? <>Safari menyusida <b>File → Add to Dock</b> ni tanlang (qo‘llab-quvvatlanadigan macOS/Safari versiyalarida).</>
                : installGuide==='browser' ? <>Brauzer menyusidan <b>Ilovani o‘rnatish / Add to Home Screen</b> ni tanlang. Band mavjud bo‘lmasa, shu brauzerda o‘rnatish hozir qo‘llanmayapti.</> : <>Safari’da <b>Ulashish (Share)</b> tugmasini bosing va <b>“Asosiy ekranga qo‘shish” (+)</b> ni tanlang.</>}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={handleInstallClick}
              style={{
                padding: '7px 14px',
                background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 12,
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.3)',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span>O'rnatish</span>
              <span>↓</span>
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
