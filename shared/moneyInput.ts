// Form values and server JSON amounts: preserve decimals instead of removing them.
export function readMoneyInput(value:unknown):number|null {
  const text=String(value ?? '').trim().replace(/[\u00a0\u202f]/g,' ');
  if(!/^(?:\d+|[1-9]\d{0,2}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(text))return null;
  const amount=Number(text.replace(/ /g,'').replace(',','.'));
  return Number.isFinite(amount) && amount>0 && amount<=1e12?amount:null;
}
