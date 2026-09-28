import assert from 'node:assert/strict';
import {normalizeUzbekFinancialText,validateAiFinancialOutput,parseTurboFinancialText} from '../api/_uzbekFinancialNormalizer.js';
const types=['expense','income','debt','lending'];
const cases:Array<[string,string,number,string]>=[
 ['taksiga 30 ming','expense',30000,'Transport'],
 ['bugun ishga borish uchun taksiga 30 ming sarfladim','expense',30000,'Transport'],
 ['maosh 5 mln','income',5000000,'Maosh'],
 ['bugun menga 5 mln maosh tushdi','income',5000000,'Maosh'],
 ['qarz oldim 100 ming','debt',100000,'Boshqa'],
 ['qarz 100 ming oldim','debt',100000,'Boshqa'],
 ['Akmalga qarz 100 ming berdim','lending',100000,'Boshqa'],
 ['bugun Akmaldan 100 ming qarz oldim','debt',100000,'Boshqa'],
 ['qarz berdim 100 ming','lending',100000,'Boshqa']
];
for(const [text,type,amount,category] of cases){
 const norm=normalizeUzbekFinancialText(text);
 const good=validateAiFinancialOutput({type,amount,category:'Maosh'},norm);
 assert.equal(good.isValid,true,text);assert.equal(good.amount,amount,text);assert.equal(good.category,category,text);
 for(const wrong of types.filter(t=>t!==type))assert.equal(validateAiFinancialOutput({type:wrong,amount,category},norm).isValid,false,`${text}: ${wrong}`);
 const turbo=parseTurboFinancialText(text);if(turbo?.transactions?.length)assert.equal(turbo.transactions[0].type,type,text);
}
for(const text of ['qarzni qaytardim 100 ming','100 ming qarzimni uzdim','100 ming qarz qaytdi','100 ming qarz tushdi','Akmalga 100 ming berdim','ertaga 100 ming qarz olaman','100 ming qarz olmadim','maosh 100 ming berdim','taksiga 30 yoki 50 ming']){
 assert.equal(parseTurboFinancialText(text),null,text);
 for(const type of types)assert.equal(validateAiFinancialOutput({type,amount:100000,category:'Boshqa'},normalizeUzbekFinancialText(text)).isValid,false,text);
}
assert.equal(validateAiFinancialOutput({type:'income',amount:100000},normalizeUzbekFinancialText('100 ming sarfladim')).isValid,false);
console.log('Transaction directions: 9 clear cases across all four types; 9 ambiguous/repayment/future cases rejected. Categories and amounts checked.');
