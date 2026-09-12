import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../supabase';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'uz' | 'uz_cyrl' | 'ru' | 'en';
  initialTab?: 'privacy' | 'terms';
}

export const PRIVACY_POLICY_DATA = {
  uz: {
    privacyTitle: "Maxfiylik Siyosati",
    termsTitle: "Ommaviy Oferta",
    badge: "Rasmiy hujjat",
    closeBtn: "Tushunarli",
    privacySections: [
      {
        icon: "🛡️",
        num: "1",
        title: "Umumiy qoidalar",
        content: "Ushbu Maxfiylik siyosati Moliya AI (Telegram bot va Telegram Mini App) xizmatlaridan foydalanishda foydalanuvchilarning shaxsiy ma'lumotlarini yig'ish, saqlash va qayta ishlash tartibini belgilaydi. Moliya AI foydalanuvchilarining shaxsiy daxlsizligi va moliyaviy ma'lumotlari xavfsizligini to'liq kafolatlaydi."
      },
      {
        icon: "📱",
        num: "2",
        title: "Yig'iladigan ma'lumotlar",
        content: "Moliya AI quyidagi ma'lumotlarni xizmat ko'rsatish va hisob xavfsizligi maqsadida yig'adi:",
        bullets: [
          "Telefon raqami — ro'yxatdan o'tish, shaxsni tasdiqlash va hisobni noqonuniy kirishlardan himoyalash uchun;",
          "Telegram profili — Telegram ID, ism-familiya va @username;",
          "Moliyaviy ma'lumotlar — foydalanuvchi kiritgan daromadlar, xarajatlar, toifalar, bank kartalari va oylik limitlar;",
          "Sun'iy intellekt so'rovlari — xarajatlarni tanib olish uchun yuborilgan ovozli xabarlar, kvitansiya (chek) fotosuratlari va matnli xabarlar;",
          "Texnik ma'lumotlar — qurilma turi, operatsion tizim va sessiya vaqtlari."
        ]
      },
      {
        icon: "🎯",
        num: "3",
        title: "Ma'lumotlarni qayta ishlash maqsadi",
        content: "To'plangan barcha ma'lumotlar faqat quyidagi maqsadlarda ishlatiladi:",
        bullets: [
          "Shaxsiy moliyaviy hisob-kitoblarni aniq yuritish va tahlil qilish;",
          "Sun'iy intellekt yordamida audio va cheklarni avtomatik xarajatlarga aylantirish;",
          "Foydalanuvchiga xarajatlar tahlili, oylik hisobotlar va moliyaviy maslahatlar berish;",
          "Xizmat xavfsizligini ta'minlash va hisobni begona shaxslardan himoyalash."
        ]
      },
      {
        icon: "🤖",
        num: "4",
        title: "Sun'iy intellekt va ma'lumotlar daxlsizligi",
        content: "Moliya AI foydalanuvchilarning moliyaviy yoki shaxsiy ma'lumotlarini hech qanday uchinchi shaxslarga, marketing kompaniyalariga yoki reklama beruvchilarga sotmaydi va taqdim etmaydi. Sun'iy intellekt modellariga faqat xarajatni tasniflash uchun zarur bo'lgan matn va cheklar uzatiladi va bu ma'lumotlar modellar o'rgatilishi uchun saqlanmaydi."
      },
      {
        icon: "🔒",
        num: "5",
        title: "Ma'lumotlar xavfsizligi va saqlash",
        content: "Barcha moliyaviy va shaxsiy ma'lumotlar zamonaviy xalqaro xavfsizlik standartlariga muvofiq shifrlangan (SSL/TLS, AES-256) xavfsiz bulutli infratuzilmada saqlanadi. Ma'lumotlar bazasiga kirish cheklangan va muntazam xavfsizlik auditi o'tkaziladi."
      },
      {
        icon: "🗑️",
        num: "6",
        title: "Foydalanuvchi huquqlari va hisobni o'chirish",
        content: "Foydalanuvchi o'z ma'lumotlarini istalgan vaqtda ko'rish, tahrirlash yoki to'liq o'chirishni talab qilish huquqiga ega (Right to Erasure). Ilovadagi 'Hisobni o'chirish' tugmasi bosilganda barcha moliyaviy yozuvlar va shaxsiy ma'lumotlar bazadan qayta tiklanmas darajada butunlay tozalab tashlanadi."
      }
    ],
    termsSections: [
      {
        icon: "📋",
        num: "1",
        title: "Oferta mavzusi",
        content: "Ushbu hujjat Moliya AI axborot tizimidan (Telegram boti va Mini App ilovasi) foydalanish shartlari bo'yicha rasmiy Ommaviy Oferta hisoblanadi. Botga kirish, ro'yxatdan o'tish yoki xizmatlardan foydalanish ushbu Oferta shartlarini to'liq va so'zsiz qabul qilganlikni (aksept) bildiradi."
      },
      {
        icon: "📲",
        num: "2",
        title: "Ro'yxatdan o'tish va telefon raqami",
        content: "Xizmat xavfsizligini ta'minlash va hisoblarni himoya qilish maqsadida barcha foydalanuvchilar o'z shaxsiy telefon raqamlarini tasdiqlashlari shart. Telefon raqamisiz bot va ilova xizmatlaridan foydalanishga yo'l qo'yilmaydi."
      },
      {
        icon: "💎",
        num: "3",
        title: "Xizmat turlari va Premium sinov",
        content: "Moliya AI yangi ro'yxatdan o'tgan barcha foydalanuvchilarga 1 kunlik CHEKSIZ VIP PREMIUM sinov muddatini sovg'a tariqasida taqdim etadi. Sinov muddati tugagach, foydalanuvchi bepul tarifda cheklangan miqdorda yoki oylik Premium Pro obunasini rasmiylashtirib cheksiz AI imkoniyatlaridan foydalanishda davom etishi mumkin."
      },
      {
        icon: "⚖️",
        num: "4",
        title: "Tomonlarning huquq va majburiyatlari",
        content: "Foydalanuvchi o'z hisobi va kirish ma'lumotlarining maxfiyligini saqlashga mas'uldir. Moliya AI tizimning uzluksiz ishlashini ta'minlash, sun'iy intellekt yordamida tezkor hisob-kitoblarni amalga oshirish va foydalanuvchi ma'lumotlari xavfsizligini kafolatlash majburiyatini oladi."
      },
      {
        icon: "🔄",
        num: "5",
        title: "Ofertaga o'zgartirishlar kiritish",
        content: "Moliya AI ma'muriyati qonunchilik talablari yoki xizmat funksiyalarining kengayishi munosabati bilan ushbu Oferta va Maxfiylik siyosatiga o'zgartirishlar kiritish huquqini o'zida saqlab qoladi. Yangilangan tahrir e'lon qilingan paytdan boshlab kuchga kiradi."
      }
    ]
  },
  uz_cyrl: {
    privacyTitle: "Махфийлик Сиёсати",
    termsTitle: "Оммавий Оферта",
    badge: "Расмий ҳужжат",
    closeBtn: "Тушунарли",
    privacySections: [
      {
        icon: "🛡️",
        num: "1",
        title: "Умумий қоидалар",
        content: "Ушбу Махфийлик сиёсати Moliya AI (Telegram бот ва Telegram Mini App) хизматларидан фойдаланишда фойдаланувчиларнинг шахсий маълумотларини йиғиш, сақлаш ва қайта ишлаш тартибини белгилайди. Moliya AI фойдаланувчиларининг шахсий дахлсизлиги ва молиявий маълумотлари хавфсизлигини тўлиқ кафолатлайди."
      },
      {
        icon: "📱",
        num: "2",
        title: "Йиғиладиган маълумотлар",
        content: "Moliya AI қуйидаги маълумотларни хизмат кўрсатиш ва ҳисоб хавфсизлиги мақсадида йиғади:",
        bullets: [
          "Телефон рақами — рўйхатдан ўтиш, шахсни тасдиқлаш ва ҳисобни ноқонуний киришлардан ҳимоялаш учун;",
          "Telegram профили — Telegram ID, исм-фамилия ва @username;",
          "Молиявий маълумотлар — фойдаланувчи киритган даромадлар, харажатлар, тоифалар, банк карталари ва ойлик лимитлар;",
          "Сунъий интеллект сўровлари — харажатларни таниб олиш учун юборилган овозли хабарлар, чек фотосуратлари ва матнлар;",
          "Техник маълумотлар — қурилма тури, операцион тизим ва сессия вақтлари."
        ]
      },
      {
        icon: "🎯",
        num: "3",
        title: "Маълумотларни қайта ишлаш мақсади",
        content: "Тўпланган барча маълумотлар фақат молиявий ҳисоб-китобларни аниқ юритиш, харажатларни таҳлил қилиш ва фойдаланувчига ақлли молиявий ҳисоботлар тақдим этиш мақсадида ишлатилади."
      },
      {
        icon: "🤖",
        num: "4",
        title: "Сунъий интеллект ва учинчи томонлар",
        content: "Moliya AI маълумотларни ҳеч қандай учинчи шахсларга ёки реклама берувчиларга сотмайди ва тақдим этмайди. Маълумотлар моделларни ўргатиш учун сақланмайди."
      },
      {
        icon: "🔒",
        num: "5",
        title: "Хавфсизлик ва шифрлаш",
        content: "Барча маълумотлар замонавий SSL/TLS ва AES-256 шифрлаш протоколлари орқали хавфсиз булутли инфратузилмада сақланади."
      },
      {
        icon: "🗑️",
        num: "6",
        title: "Ҳисобни тўлиқ ўчириш ҳуқуқи",
        content: "Фойдаланувчи исталган вақтда ўз ҳисоби ва барча молиявий маълумотларини базадан бутунлай ўчириб ташлаш ҳуқуқига эга."
      }
    ],
    termsSections: [
      {
        icon: "📋",
        num: "1",
        title: "Оферта мавзуси",
        content: "Ушбу ҳужжат Moliya AI тизимидан фойдаланиш бўйича расмий Оммавий Оферта ҳисобланади. Бот ва иловадан фойдаланиш ушбу шартларни тўлиқ қабул қилишни англатади."
      },
      {
        icon: "📲",
        num: "2",
        title: "Телефон рақамини тасдиқлаш",
        content: "Хавфсизликни таъминлаш мақсадида телефон рақамини тасдиқлаш мажбурийдир. Телефонсиз хизматлардан фойдаланиш чекланади."
      },
      {
        icon: "💎",
        num: "3",
        title: "1 кунлик Premium синов",
        content: "Янги фойдаланувчиларга 1 кунлик чексиз VIP Premium синов муддати берилади."
      }
    ]
  },
  ru: {
    privacyTitle: "Политика конфиденциальности",
    termsTitle: "Публичная оферта",
    badge: "Официальный документ",
    closeBtn: "Понятно",
    privacySections: [
      {
        icon: "🛡️",
        num: "1",
        title: "Общие положения",
        content: "Настоящая Политика конфиденциальности определяет порядок сбора, хранения и обработки персональных данных при использовании сервиса Moliya AI (Telegram-бот и Mini App). Сервис полностью гарантирует конфиденциальность и безопасность ваших финансовых данных."
      },
      {
        icon: "📱",
        num: "2",
        title: "Собираемые данные",
        content: "Moliya AI собирает следующие данные исключительно для предоставления услуг:",
        bullets: [
          "Номер телефона — для регистрации, идентификации и защиты аккаунта;",
          "Данные Telegram — Telegram ID, имя, фамилия и @username;",
          "Финансовые данные — доходы, расходы, категории, банковские карты и лимиты;",
          "Запросы ИИ — голосовые сообщения, фотографии чеков и текстовые запросы;",
          "Технические данные — тип устройства, ОС и время сессий."
        ]
      },
      {
        icon: "🎯",
        num: "3",
        title: "Цели обработки данных",
        content: "Данные используются исключительно для ведения личных финансов, распознавания расходов через ИИ, формирования отчетов и защиты аккаунта."
      },
      {
        icon: "🤖",
        num: "4",
        title: "Искусственный интеллект и безопасность",
        content: "Moliya AI никогда не продает и не передает данные третьим лицам или рекламным сетям. Данные не используются для обучения публичных моделей."
      },
      {
        icon: "🔒",
        num: "5",
        title: "Защита и шифрование данных",
        content: "Все данные надежно шифруются с использованием стандартов SSL/TLS и AES-256 и хранятся в защищенной облачной инфраструктуре."
      },
      {
        icon: "🗑️",
        num: "6",
        title: "Права пользователя и удаление аккаунта",
        content: "Пользователь имеет право в любой момент запросить полное и безвозвратное удаление всех своих данных и учетной записи (Right to Erasure)."
      }
    ],
    termsSections: [
      {
        icon: "📋",
        num: "1",
        title: "Предмет оферты",
        content: "Настоящий документ является официальной публичной офертой на использование сервиса Moliya AI. Начало использования сервиса означает полное согласие с условиями."
      },
      {
        icon: "📲",
        num: "2",
        title: "Верификация номера телефона",
        content: "Для обеспечения безопасности и предотвращения злоупотреблений подтверждение номера телефона является обязательным для всех пользователей."
      },
      {
        icon: "💎",
        num: "3",
        title: "1 день бесплатного Premium",
        content: "Каждый новый пользователь получает 1 день безлимитного доступа ко всем возможностям VIP Premium в подарок."
      }
    ]
  },
  en: {
    privacyTitle: "Privacy Policy",
    termsTitle: "Terms of Service",
    badge: "Official Legal Document",
    closeBtn: "Got it",
    privacySections: [
      {
        icon: "🛡️",
        num: "1",
        title: "General Provisions",
        content: "This Privacy Policy governs the collection, storage, and processing of personal data when using Moliya AI (Telegram bot and Telegram Mini App). We strictly ensure complete privacy and security of your personal and financial data."
      },
      {
        icon: "📱",
        num: "2",
        title: "Collected Information",
        content: "Moliya AI collects the following details strictly to provide financial tracking services:",
        bullets: [
          "Phone number — required for account verification, authentication, and security;",
          "Telegram profile — Telegram ID, full name, and @username;",
          "Financial records — income, expenses, categories, bank cards, and budgets;",
          "AI processing queries — voice notes, receipt photos, and text messages;",
          "Technical details — device type, operating system, and session timestamps."
        ]
      },
      {
        icon: "🎯",
        num: "3",
        title: "Purpose of Processing",
        content: "Collected data is used exclusively to categorize expenses, transcribe audio with AI, generate reports, and safeguard user accounts."
      },
      {
        icon: "🤖",
        num: "4",
        title: "AI & Zero Third-Party Sharing",
        content: "Moliya AI never sells or shares your personal or financial data with third parties, advertisers, or brokers. User data is never used to train public AI models."
      },
      {
        icon: "🔒",
        num: "5",
        title: "Security & Encryption",
        content: "All records are securely encrypted in transit (SSL/TLS) and at rest (AES-256) in protected enterprise cloud infrastructure."
      },
      {
        icon: "🗑️",
        num: "6",
        title: "User Rights & Complete Deletion",
        content: "You retain full rights to export, update, or permanently delete your account and all associated financial records at any time."
      }
    ],
    termsSections: [
      {
        icon: "📋",
        num: "1",
        title: "Terms Overview",
        content: "This document constitutes a binding public agreement for using the Moliya AI platform. Accessing the service implies unconditional acceptance."
      },
      {
        icon: "📲",
        num: "2",
        title: "Phone Verification Requirement",
        content: "To safeguard accounts and ensure service integrity, verifying your personal phone number is strictly required."
      },
      {
        icon: "💎",
        num: "3",
        title: "1-Day Unlimited Premium Trial",
        content: "All newly verified users receive a complimentary 24-hour unlimited VIP Premium trial."
      }
    ]
  }
};

function parseCustomPolicy(text: string) {
  const lines = text.split('\n');
  const sections: { num: string; title: string; content: string; bullets?: string[]; icon?: string }[] = [];
  let currentSection: any = null;

  const getIcon = (idx: number) => {
    const icons = ['🛡️', '📱', '🎯', '🤖', '🔒', '🗑️', '⚖️', '📋', '💎', '🔄', '🌐', '📝', '📞', '✅'];
    return icons[idx % icons.length];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ') && !trimmed.match(/^#+\s*\d+/)) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        icon: '📋',
        num: 'Hujjat',
        title: trimmed.replace(/^#+\s*/, ''),
        content: '',
        bullets: []
      };
      continue;
    }

    if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      if (currentSection) sections.push(currentSection);
      const titleRaw = trimmed.replace(/^#+\s*/, '');
      const matchNum = titleRaw.match(/^(\d+(\.\d+)?[\.\)]?\s*)(.*)/);
      const num = matchNum ? matchNum[1].replace(/[\.\)]\s*$/, '') : String(sections.length + 1);
      const title = matchNum ? matchNum[3] : titleRaw;
      currentSection = {
        icon: getIcon(sections.length),
        num,
        title,
        content: '',
        bullets: []
      };
    } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const b = trimmed.replace(/^[\*\-]\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1');
      if (currentSection) {
        currentSection.bullets.push(b);
      } else {
        currentSection = { icon: '📄', num: '1', title: 'Umumiy', content: '', bullets: [b] };
      }
    } else {
      if (currentSection) {
        currentSection.content = currentSection.content ? `${currentSection.content}\n${trimmed}` : trimmed;
      } else {
        currentSection = { icon: '📄', num: '1', title: 'Umumiy', content: trimmed, bullets: [] };
      }
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections.length > 0 ? sections : null;
}

export default function PrivacyPolicyModal({
  isOpen,
  onClose,
  lang = 'uz',
  initialTab = 'privacy'
}: PrivacyPolicyModalProps) {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>(initialTab);
  const [customPolicyText, setCustomPolicyText] = useState<string>(() => {
    try {
      return localStorage.getItem('moliya_custom_privacy_policy') || '';
    } catch {
      return '';
    }
  });

  const data = (PRIVACY_POLICY_DATA as any)[lang] || PRIVACY_POLICY_DATA.uz;

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Dynamically load updated policy from Supabase whenever modal is opened
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchLatestPolicy = async () => {
      try {
        const { data: dbData, error } = await supabase
          .from('users')
          .select('onboarding')
          .eq('id', 'system_app_settings')
          .maybeSingle();

        if (!error && dbData?.onboarding?.privacy_policy && isMounted) {
          const freshText = String(dbData.onboarding.privacy_policy);
          setCustomPolicyText(freshText);
          localStorage.setItem('moliya_custom_privacy_policy', freshText);
        }
      } catch (err) {
        console.warn('Failed to load custom privacy policy:', err);
      }
    };

    fetchLatestPolicy();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const parsedCustomSections = customPolicyText ? parseCustomPolicy(customPolicyText) : null;
  const currentSections = activeTab === 'privacy' 
    ? (parsedCustomSections || data.privacySections) 
    : data.termsSections;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
        key="privacy_modal_backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 10, 15, 0.72)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center'
        }}
      >
        <motion.div
          key="privacy_modal_card"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 540,
            maxHeight: '90vh',
            background: 'linear-gradient(180deg, #1C1A2E 0%, #151324 100%)',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header Drag Handle */}
          <div style={{ padding: '12px 0 6px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 42, height: 5, borderRadius: 3, background: 'rgba(255, 255, 255, 0.2)' }} />
          </div>

          {/* Modal Header */}
          <div style={{ padding: '10px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
              }}>
                📜
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{activeTab === 'privacy' ? data.privacyTitle : data.termsTitle}</span>
                  <span style={{
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 12,
                    background: 'rgba(16, 185, 129, 0.18)',
                    color: '#34D399',
                    fontWeight: 600,
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}>
                    {data.badge}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: '#A5A0D6', marginTop: 2 }}>
                  Moliya AI Rasmiy Qoidalari va Xavfsizlik Kafolatlari
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#E0E7FF',
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>
          </div>

          {/* Tab Switcher */}
          <div style={{ padding: '10px 20px', background: 'rgba(0, 0, 0, 0.15)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 12,
              padding: 3,
              gap: 4
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('privacy')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 9,
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: activeTab === 'privacy' ? 'linear-gradient(135deg, #6366F1, #4F46E5)' : 'transparent',
                  color: activeTab === 'privacy' ? '#FFFFFF' : '#A5A0D6',
                  boxShadow: activeTab === 'privacy' ? '0 2px 8px rgba(99, 102, 241, 0.35)' : 'none'
                }}
              >
                🛡️ {data.privacyTitle}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('terms')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 9,
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: activeTab === 'terms' ? 'linear-gradient(135deg, #6366F1, #4F46E5)' : 'transparent',
                  color: activeTab === 'terms' ? '#FFFFFF' : '#A5A0D6',
                  boxShadow: activeTab === 'terms' ? '0 2px 8px rgba(99, 102, 241, 0.35)' : 'none'
                }}
              >
                📋 {data.termsTitle}
              </button>
            </div>
          </div>

          {/* Content Stream with smooth scroll */}
          <div
            style={{
              padding: '16px 20px',
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overscrollBehavior: 'contain'
            }}
          >
            {currentSections.map((sec: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{sec.icon}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F3F4F6' }}>
                    {sec.num}. {sec.title}
                  </span>
                </div>
                <p style={{ fontSize: 12.5, color: '#D1D5DB', lineHeight: 1.55, margin: 0 }}>
                  {sec.content}
                </p>
                {sec.bullets && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {sec.bullets.map((b: string, bIdx: number) => (
                      <li key={bIdx} style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {/* Trust badge card */}
            <div style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <span style={{ fontSize: 24 }}>🔐</span>
              <div style={{ fontSize: 11.5, color: '#C7D2FE', lineHeight: 1.45 }}>
                <b>256-bit SSL/TLS Shifrlash</b>: Moliyaviy ma'lumotlaringiz eng yuqori xalqaro standartlar asosida himoyalangan va hech qachon uchinchi shaxslarga berilmaydi.
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.25)',
            display: 'flex',
            justifyContent: 'flex-end'
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)'
              }}
            >
              ✅ {data.closeBtn}
            </button>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
