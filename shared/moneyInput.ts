// Form values and server JSON amounts: preserve decimals instead of removing them.
export function readMoneyInput(value:unknown):number|null {
  const text=String(value ?? '').trim().replace(/[\u00a0\u202f]/g,' ');
  if(!/^(?:\d+|[1-9]\d{0,2}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(text))return null;
  const amount=Number(text.replace(/ /g,'').replace(',','.'));
  return Number.isFinite(amount) && amount>0 && amount<=1e12?amount:null;
}

// Preserve the editable decimal separator and fraction while grouping thousands.
export function formatMoneyInput(value: string): string {
  const compact=value.replace(/[ \u00a0\u202f]/g,'');
  if(!/^\d*(?:[.,]\d{0,2})?$/.test(compact))return value;
  const match=compact.match(/^(\d*)([.,]\d{0,2})?$/)!;
  return match[1].replace(/\B(?=(\d{3})+(?!\d))/g,' ') + (match[2] || '');
}
