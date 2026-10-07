# Mavjud Supabase loyihasini yangilash

SQLlarning yagona nusxasi shu papkada. Admin uchun alohida SQL yo‘q.
Bo‘sh database yaratish uchun bu ketma-ketlik yetarli emas: users, ai_keys,
ai_logs va app_notifications kabi amaldagi jadvallar mavjud bo‘lishi kerak.

- `00-required-columns.sql` — avvalgi loyiha column/index va audit jadvali talablari; yangi mantiq emas, eski fayl shu yerga ko‘chirildi. Mavjud schema bilan solishtirib bajaring.
- `01-critical-security.sql` — browser DB ruxsatlarini yopish, bot tasdig‘i maydoni, eski sessiyalarni bekor qilish.
- `02-atomic-ai-quota.sql` — AI limitini atomik hisoblash.
- `03-financial-writes.sql` — moliyaviy yozuvlar.
- `04-atomic-card-operations.sql` — karta va tuzatishlarni birgalikda saqlash.
- `05-shared-rate-limits.sql` — umumiy so‘rov limitlari.
- `06-financial-eligibility.sql` — yozuv paytida blok va bot tasdig‘ini tekshirish.
- `07-session-financial-writes.sql` — yozuv paytida joriy sessiya tekshiruvi.
- `08-destructive-user-actions.sql` — tozalash va hisob o‘chirish tekshiruvlari.
- `09-bot-transaction-confirmation.sql` — bot yozuvini 15 daqiqalik tasdiqlash va takroriy saqlanishni to‘xtatish.
- `10-private-app-notifications.sql` — ilova xabarlarini faqat backend orqali o‘qish/yozish, eski auditoriyani saqlash.
- `11-configurable-ai-quota.sql` — standart AI kvotasini SQL rezervatsiyaga ulash va bepul hisoblarning shaxsiy limitini tiklash.
- `12-bot-message-delivery.sql` — takror yetkazilgan Telegram xabarini qayta tahlil qilmaslik.
- `13-reminder-delivery.sql` — bitta foydalanuvchiga kuniga bir martadan ortiq avtomatik eslatma yubormaslik.
- `14-automation-controls.sql` — adminning kunlik eslatma yoqish/o‘chirish holatini serverda saqlash.
- `15-private-admin-audit.sql` — admin audit jadvalidagi RLS va brauzer ruxsatlarini yopish.
- `16-scheduled-reports.sql` — haftalik/oylik avtomatik hisobotlarni serverda alohida, dastlab o‘chirilgan qoidalar bilan boshqarish.

01–16 ni yangi backend deployidan oldin raqam tartibida bajaring.
01 ni qayta bajarish foydalanuvchilarni yana sessiyadan chiqaradi.
Avval bajarilgan bosqichlarni hisobga oling; SQL bajarilishini shu ish davomida tasdiqlamadik.
03/04/06/07/08 bir xil funksiyalarni bosqichma-bosqich yangilaydi;
ular takroriy ortiqcha fayl emas, regressiya testlari ham shu ketma-ketlikni tekshiradi.
11 02 dagi quota funksiyasini yangilaydi. Uni bajarmasdan admin paneldagi yangi
standart kvota AI rezervatsiyalariga taʼsir qilmaydi.
12 bajarilmasdan yangi bot webhookini deploy qilmang: qayta ishlash belgisi
olinmasa, kiruvchi xabarlar xavfsiz ravishda 503 bilan rad etiladi.

Eski, keng browser ruxsatlarini qayta ochadigan sxema/RLS skriptlari paketdan chiqarildi.
Faylni olib tashlash jonli database siyosatini o‘zgartirmaydi: jonli RLS, notification
va storage ruxsatlarini alohida tekshirish kerak.

13 bajarilmasdan eslatma cronini deploy qilmang: yuborish faqat bazadagi kunlik claimdan keyin ishlaydi.
14 bajarilmasa kunlik eslatma cron va admin boshqaruvi xavfsiz ravishda 503 qaytaradi; yangi backenddan oldin qo‘llang.
15 audit jadvalida oldindan berilgan table va column ruxsatlarini bekor qiladi;
faqat serverning `service_role` roli o‘qib/qo‘sha oladi.

22-planned-reminders.sql — rejali to‘lovlar uchun kunlik Telegram eslatmalari ledgeri; 21 dan keyin, yangi backenddan oldin bajaring. Mavjud qarz cronidan foydalanadi.
