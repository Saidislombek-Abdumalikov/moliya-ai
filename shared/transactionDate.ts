import {validDay} from './debts';
// A datetime-local input is a wall-clock value, never a UTC conversion.
export function localTransactionDate(value: unknown): string | null {
  if(typeof value !== 'string')return null;
  const text=value.trim();
  if(text.length===10 && validDay(text.slice(0,10)))return text+'T12:00';
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(text))return null;
  return validDay(text.slice(0,10))?text:null;
}
