import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'


export interface ExportTransaction {
  id: string | number
  type: string
  amount: number | string
  category: string
  note?: string
  date?: string
}

export interface ExportOptions {
  format: 'PDF' | 'EXCEL'
  period: 'current' | 'last' | 'quarter' | 'all'
  userName: string
  userPhone?: string
  transactions: ExportTransaction[]
}

export async function exportFinancialReport(opts: ExportOptions): Promise<{ success: boolean; message?: string }> {
  const { format, period, userName, userPhone, transactions } = opts
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const periodLabel = period === 'current' ? 'Shu oy' : period === 'last' ? 'O\'tgan oy' : period === 'quarter' ? 'Oxirgi 3 oy' : 'Barcha davr'

  // Filter transactions based on period
  let filtered = [...transactions]
  if (period === 'current') {
    filtered = filtered.filter(t => {
      const d = new Date(t.date || Date.now())
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
  } else if (period === 'last') {
    const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    filtered = filtered.filter(t => {
      const d = new Date(t.date || Date.now())
      return d.getMonth() === lastM.getMonth() && d.getFullYear() === lastM.getFullYear()
    })
  } else if (period === 'quarter') {
    const threeM = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    filtered = filtered.filter(t => new Date(t.date || Date.now()) >= threeM)
  }

  // Calculate totals
  let totalIncome = 0
  let totalExpense = 0
  filtered.forEach(t => {
    const num = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
    if (t.type === 'income' || num > 0) {
      totalIncome += Math.abs(num)
    } else {
      totalExpense += Math.abs(num)
    }
  })
  const netBalance = totalIncome - totalExpense

  if (format === 'PDF') {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    // Brand Header
    doc.setFillColor(124, 58, 237) // Primary purple
    doc.rect(0, 0, 210, 28, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('MOLIYA AI — MOLIYAVIY HISOBOT', 14, 18)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(now.toLocaleDateString(), 170, 18)

    // User & Meta Info
    doc.setTextColor(30, 26, 60)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Foydalanuvchi ma\'lumotlari:', 14, 38)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Ism: ${userName || 'Foydalanuvchi'}`, 14, 45)
    if (userPhone) doc.text(`Telefon: ${userPhone}`, 14, 51)
    doc.text(`Hisobot davri: ${periodLabel}`, 14, userPhone ? 57 : 51)
    doc.text(`Jami operatsiyalar: ${filtered.length} ta`, 14, userPhone ? 63 : 57)

    // Summary Box
    const boxY = userPhone ? 70 : 64
    doc.setFillColor(245, 243, 255)
    doc.roundedRect(14, boxY, 182, 22, 3, 3, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(22, 163, 74) // Green
    doc.text(`Daromad: +${totalIncome.toLocaleString('uz-UZ')} so'm`, 20, boxY + 9)

    doc.setTextColor(220, 38, 38) // Red
    doc.text(`Xarajat: -${totalExpense.toLocaleString('uz-UZ')} so'm`, 85, boxY + 9)

    doc.setTextColor(124, 58, 237) // Purple
    doc.text(`Sof balans: ${netBalance >= 0 ? '+' : ''}${netBalance.toLocaleString('uz-UZ')} so'm`, 145, boxY + 9)

    // Transaction Table
    const tableData = filtered.map(t => {
      const num = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
      const isInc = t.type === 'income' || num > 0
      const dateText = t.date ? new Date(t.date).toLocaleDateString() : '-'
      const typeText = isInc ? 'Daromad' : 'Xarajat'
      const amtText = `${isInc ? '+' : '-'}${Math.abs(num).toLocaleString('uz-UZ')} so'm`
      const noteText = t.note || t.category || ''
      return [dateText, typeText, t.category || '-', amtText, noteText]
    })

    autoTable(doc, {
      startY: boxY + 28,
      head: [['Sana', 'Turi', 'Kategoriya', 'Summa', 'Izoh']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [124, 58, 237],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: [30, 26, 60],
      },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 24 },
        2: { cellWidth: 35 },
        3: { cellWidth: 35, fontStyle: 'bold' },
        4: { cellWidth: 'auto' },
      },
      margin: { left: 14, right: 14 },
    })

    const fileName = `Moliya_Hisobot_${period}_${dateStr}.pdf`
    doc.save(fileName)
    return { success: true, message: 'PDF hisoboti yuklab olindi! 📄' }
  } else {
    // CSV / Excel format
    const BOM = '\uFEFF'
    const headers = 'ID;Sana (Date);Turi (Type);Kategoriya (Category);Summa (Amount);Izoh (Note)\n'
    const rows = filtered.map(t => {
      const num = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
      const isInc = t.type === 'income' || num > 0
      const dateText = t.date ? new Date(t.date).toLocaleDateString() : ''
      const noteText = (t.note || '').replace(/"/g, '""')
      return `"${t.id}";"${dateText}";"${isInc ? 'Daromad' : 'Xarajat'}";"${t.category}";"${num}";"${noteText}"`
    }).join('\n')

    const content = BOM + headers + rows
    const fileName = `Moliya_Hisobot_${period}_${dateStr}.csv`

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    return { success: true, message: 'Excel hisoboti yuklab olindi! 📊' }
  }
}
