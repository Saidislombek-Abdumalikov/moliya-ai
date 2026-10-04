import assert from 'node:assert/strict';
import {encodeWav} from '../src/audioRecorder.js';
import {audioMime,normalizeAudioResult} from '../api/_audioParser.js';
import {validateReceiptOutput} from '../api/_receiptParser.js';
import {parseTurboFinancialText} from '../api/_uzbekFinancialNormalizer.js';
for(const text of ['400000 ishlatdim','400 000 ishlatdim','400000 sarfladim']){
 const tx=parseTurboFinancialText(text)?.transactions[0];assert.equal(tx?.amount,400000);assert.equal(tx?.type,'expense');assert.equal(tx?.category,'Boshqa');
}
for(const text of ['400000','400000 ishlatmadim','400000 ishlatdimmi?','ertaga 400000 sarflayman'])assert.equal(parseTurboFinancialText(text),null,text);
// Audio semantics come from the provider; these only verify output handling.
for(const [text,type,amount] of [["Tushlikka o'ttiz ming",'expense',30000],['Обед обошёлся в 30000 сум','expense',30000],['I got paid fifty dollars','income',50],['100 ming qarz oldim','debt',100000],['100 ming qarz berdim','lending',100000]] as const){
 const tx=normalizeAudioResult({transcription:text,type,amount,currency:'UZS',category:'Boshqa'});
 assert.equal(tx?.type,type);assert.equal(tx?.amount,amount);
}
for(const raw of [{amount:null},{amount:0},{amount:-10},{amount:NaN},{amount:'30000'},{type:'unknown'},{currency:'XYZ'},{needs_clarification:true}])
 assert.equal(normalizeAudioResult({type:'expense',amount:30000,currency:'UZS',...raw}),null);
assert.equal(normalizeAudioResult({type:'expense',amount:10,currency:'UZS'})?.amount,10);
assert.equal(normalizeAudioResult({type:'expense',amount:12.5,currency:'UZS'})?.amount,12.5);
const wav=Buffer.from(await encodeWav(new Float32Array([0,1,-1])).arrayBuffer());
assert.equal(audioMime(wav),'audio/wav');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readInt16LE(46),32767);assert.equal(wav.readInt16LE(48),-32768);
assert.equal(audioMime(Buffer.from('not real audio input')),null);
for(const totalText of ['400000','400 000','400,000','400.000','400 000,00'])assert.equal(validateReceiptOutput({isReceipt:true,totalText,currency:'UZS'})?.amount,400000,totalText);
for(const raw of [{isReceipt:false,totalText:'400000',currency:'UZS'},{isReceipt:true,totalText:'',currency:'UZS'},{isReceipt:true,totalText:'400000',currency:'XYZ'},{isReceipt:true,totalText:'400000',currency:'UZS',needs_clarification:true}])assert.equal(validateReceiptOutput(raw),null);
console.log('AI media: exact spending, four audio types, response shape, WAV encoding and receipt evidence passed. No live provider/audio recording.');

const {readMoneyInput}=await import('../shared/moneyInput.js');
for(const value of ['12 500.50','12500.50','12 500,50',12500.5])assert.equal(readMoneyInput(value),12500.5);
for(const value of ['1e6','12.500.50','-10','0','50.000','invalid'])assert.equal(readMoneyInput(value),null);
for(const text of ['kursga 50 ming','kitobga 50 ming','kontraktga 50 ming'])assert.equal(parseTurboFinancialText(text)?.transactions[0].category,"Ta'lim",text);
assert.equal(parseTurboFinancialText('doriga 50 ming')?.transactions[0].category,"Sog'liq");
assert.equal(parseTurboFinancialText('kecha taksiga 30 ming','2026-09-29')?.transactions[0].date,'2026-09-28');
const {validateAiFinancialOutput,normalizeUzbekFinancialText,buildUzbekFinancialPrompt}=await import('../api/_uzbekFinancialNormalizer.js');
assert.equal(validateAiFinancialOutput({type:'expense',date:'2026-09-29'},normalizeUzbekFinancialText('kecha taksiga 30 ming sarfladim'),'2026-09-29').date,'2026-09-28');
assert.equal(buildUzbekFinancialPrompt('100 dollar sarfladim').includes('11,850'),false);
console.log('AI review: decimal form amounts, education/medicine shorthand, source date and prompt currency rules passed.');

assert.equal(parseTurboFinancialText('50k taksi va 100k bozor va 70 ming Akmalga berdim'),null,'A multi-entry message must not silently save only the recognized subset');

const {formatMoneyInput}=await import('../shared/moneyInput.js');
for(const [raw,expected] of [['1000','1 000'],['25000','25 000'],['12500.50','12 500.50'],['1000000,','1 000 000,'],['','']])assert.equal(formatMoneyInput(raw),expected);
assert.equal(parseTurboFinancialText('Men bugun taksi uchun 10 ming')?.transactions[0].amount,10000,'Clear short phrase must use local parser without cloud AI');
