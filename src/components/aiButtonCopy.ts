export type AppLanguage = 'uz' | 'uz_cyrl' | 'ru' | 'en';

const copy = {
  uz: {
    throttle: "So‘rovlar juda tez yuborildi. Biroz kutib qayta urinib ko‘ring.",
    types: ['Xarajat', 'Daromad', 'Qarz oldim', 'Qarz berdim'],
    voice: ['Qancha xarajat qildingiz va nima uchun?', 'Qancha daromad oldingiz?', 'Kimdan qancha qarz oldingiz?', 'Kimga qancha pul berdingiz?'],
    amount: "SUMMA (SO'M)", category: 'KATEGORIYA', account: 'HISOBNI TANLANG', cash: 'Naqd pul (Umumiy balans)', date: 'SANA VA VAQT', note: 'IZOH', optional: 'Ixtiyoriy...',
    samplesTitle: "Namuna ma'lumotlari o'chirilsinmi?", samplesBody: "Birinchi tranzaksiyangiz qo'shildi. Namuna ma'lumotlarini o'chirasizmi?", samplesYes: "Ha, o'chirish", samplesNo: "Yo'q, qolsin",
    receiptLimit: "Bugungi chek skanerlash limitingiz tugadi. Xarajatni qo'lda kiriting.", receiptFailed: "Chekni aniqlab bo'lmadi. Xarajatni qo'lda kiriting.", parseFailed: "Aniq tushunmadim. Summani tekshiring yoki qo'lda kiriting.", clarify: "Summani va operatsiyani aniq yozing yoki qo'lda kiriting.", quota: "Bugungi AI limitingiz tugadi. Qo'lda kiritish bepul.",
    tips: ["💡 Xarajatlarni muntazam yozib boring.", "⚡ Summani tekshirib, keyin saqlang.", "🎯 Oylik limitingizni kuzating.", "👑 VIP imkoniyatlarini profil orqali ko'ring."]
  },
  uz_cyrl: {
    throttle: "Сўровлар жуда тез юборилди. Бироз кутиб қайта уриниб кўринг.",
    types: ['Харажат', 'Даромад', 'Қарз олдим', 'Қарз бердим'],
    voice: ['Қанча харажат қилдингиз ва нима учун?', 'Қанча даромад олдингиз?', 'Кимдан қанча қарз олдингиз?', 'Кимга қанча пул бердингиз?'],
    amount: 'СУММА (СЎМ)', category: 'ТОИФА', account: 'ҲИСОБНИ ТАНЛАНГ', cash: 'Нақд пул (Умумий баланс)', date: 'САНА ВА ВАҚТ', note: 'ИЗОҲ', optional: 'Ихтиёрий...',
    samplesTitle: 'Намуна маълумотлари ўчирилсинми?', samplesBody: 'Биринчи транзакциянгиз қўшилди. Намуна маълумотларини ўчирасизми?', samplesYes: 'Ҳа, ўчириш', samplesNo: 'Йўқ, қолсин',
    receiptLimit: 'Бугунги чек сканерлаш лимитингиз тугади. Харажатни қўлда киритинг.', receiptFailed: 'Чекни аниқлаб бўлмади. Харажатни қўлда киритинг.', parseFailed: 'Аниқ тушунмадим. Суммани текширинг ёки қўлда киритинг.', clarify: 'Сумма ва операцияни аниқ ёзинг ёки қўлда киритинг.', quota: 'Бугунги AI лимитингиз тугади. Қўлда киритиш бепул.',
    tips: ['💡 Харажатларни мунтазам ёзиб боринг.', '⚡ Суммани текшириб, кейин сақланг.', '🎯 Ойлик лимитингизни кузатинг.', '👑 VIP имкониятларини профил орқали кўринг.']
  },
  ru: {
    throttle: "Слишком много запросов. Немного подождите и повторите.",
    types: ['Расход', 'Доход', 'Взял в долг', 'Дал в долг'],
    voice: ['Сколько потратили и на что?', 'Сколько получили?', 'У кого и сколько заняли?', 'Кому и сколько одолжили?'],
    amount: 'СУММА (СУМ)', category: 'КАТЕГОРИЯ', account: 'ВЫБЕРИТЕ СЧЁТ', cash: 'Наличные (общий баланс)', date: 'ДАТА И ВРЕМЯ', note: 'ПРИМЕЧАНИЕ', optional: 'Необязательно...',
    samplesTitle: 'Удалить примеры?', samplesBody: 'Первая операция добавлена. Удалить демонстрационные данные?', samplesYes: 'Да, удалить', samplesNo: 'Нет, оставить',
    receiptLimit: 'Лимит сканирования чеков на сегодня исчерпан. Введите расход вручную.', receiptFailed: 'Не удалось распознать чек. Введите расход вручную.', parseFailed: 'Не удалось определить операцию. Проверьте сумму или введите вручную.', clarify: 'Уточните сумму и операцию или введите вручную.', quota: 'Лимит ИИ на сегодня исчерпан. Ручной ввод бесплатен.',
    tips: ['💡 Регулярно записывайте расходы.', '⚡ Проверяйте сумму перед сохранением.', '🎯 Следите за месячным лимитом.', '👑 Возможности VIP доступны в профиле.']
  },
  en: {
    throttle: "Too many requests. Wait a moment and try again.",
    types: ['Expense', 'Income', 'Borrowed', 'Lent'],
    voice: ['How much did you spend and on what?', 'How much did you earn?', 'How much did you borrow and from whom?', 'How much did you lend and to whom?'],
    amount: 'AMOUNT (UZS)', category: 'CATEGORY', account: 'SELECT ACCOUNT', cash: 'Cash (total balance)', date: 'DATE AND TIME', note: 'NOTE', optional: 'Optional...',
    samplesTitle: 'Remove sample data?', samplesBody: 'Your first transaction was added. Remove the sample data?', samplesYes: 'Yes, remove', samplesNo: 'No, keep it',
    receiptLimit: 'Daily receipt scan limit reached. Enter the expense manually.', receiptFailed: 'Could not read the receipt. Enter the expense manually.', parseFailed: 'Could not identify the transaction. Check the amount or enter it manually.', clarify: 'Specify the amount and transaction, or enter it manually.', quota: 'Daily AI limit reached. Manual entry is free.',
    tips: ['💡 Record expenses regularly.', '⚡ Check the amount before saving.', '🎯 Track your monthly limit.', '👑 Find VIP features in your profile.']
  }
} as const;

const categories: Record<AppLanguage, Record<string, string>> = {
  uz: {
    throttle: "So‘rovlar juda tez yuborildi. Biroz kutib qayta urinib ko‘ring.",},
  uz_cyrl: {
    throttle: "Сўровлар жуда тез юборилди. Бироз кутиб қайта уриниб кўринг.",'Oziq-ovqat':'Озиқ-овқат','Transport':'Транспорт',"Ko'ngil ochar":'Кўнгилочар','Kiyim':'Кийим','Kommunal':'Коммунал','Sog\'liq':'Соғлиқ','Ta\'lim':'Таълим','Boshqa':'Бошқа','Maosh':'Маош','Freelance':'Эркин иш','Biznes':'Бизнес','Investitsiya':'Инвестиция','Sovg\'a':'Совға','Do\'st':'Дўст','Bank':'Банк','Oila':'Оила','Hamkasb':'Ҳамкасб'},
  ru: {
    throttle: "Слишком много запросов. Немного подождите и повторите.",'Oziq-ovqat':'Продукты','Transport':'Транспорт',"Ko'ngil ochar":'Развлечения','Kiyim':'Одежда','Kommunal':'Коммунальные','Sog\'liq':'Здоровье','Ta\'lim':'Образование','Boshqa':'Другое','Maosh':'Зарплата','Freelance':'Фриланс','Biznes':'Бизнес','Investitsiya':'Инвестиции','Sovg\'a':'Подарок','Do\'st':'Друг','Bank':'Банк','Oila':'Семья','Hamkasb':'Коллега'},
  en: {
    throttle: "Too many requests. Wait a moment and try again.",'Oziq-ovqat':'Food','Transport':'Transport',"Ko'ngil ochar":'Entertainment','Kiyim':'Clothing','Kommunal':'Utilities','Sog\'liq':'Health','Ta\'lim':'Education','Boshqa':'Other','Maosh':'Salary','Freelance':'Freelance','Biznes':'Business','Investitsiya':'Investment','Sovg\'a':'Gift','Do\'st':'Friend','Bank':'Bank','Oila':'Family','Hamkasb':'Colleague'}
};

export const aiButtonCopy = (language: AppLanguage) => copy[language] || copy.uz;
export const aiCategoryLabel = (language: AppLanguage, category: string) => categories[language]?.[category] || category;
