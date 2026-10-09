import assert from 'node:assert/strict';
import { prepareAssistantReply, assistantLanguage } from '../api/_assistantReply.js';
const base={kind:'expense',category:'Oziq-ovqat',currency:'UZS',date:'2026-10-08',time:null,account:'cash',group:'lunch',amount:24000,title:'Somsa',amountEvidence:'24 mingli'};
const source='Kecha abetga 24 mingli somsa yeyildi va 4 mingli non choy ichildi';
const meal={transcription:source,actions:[base,{...base,title:'Non, choy',amount:4000,amountEvidence:'4 mingli'}]};
const good=prepareAssistantReply(meal,'uz',true);
assert.equal(good.actions.length,1);assert.equal(good.actions[0].amount,28000);assert.equal(good.actions[0].note,source);
for(const change of [{category:'Transport'},{account:'card:one'},{currency:'USD'},{date:'2026-10-09'},{group:'another-lunch'},{kind:'debt'},{time:'15:00'}]){
 const reply=prepareAssistantReply({...meal,actions:[base,{...meal.actions[1],...change}]},'uz',true);
 assert.equal(reply.actions.length,0);assert.match(reply.message,/faqat bitta/);
}
const inflated=prepareAssistantReply({...meal,actions:[{...base,amount:24000000}]},'uz',true);
assert.equal(inflated.actions.length,0);assert.match(inflated.message,/Summani/);
const missingEvidence=prepareAssistantReply({transcription:'taksiga 24 ming',actions:[{...base,amountEvidence:'24 million',amount:24000000}]},'uz',true);
assert.equal(missingEvidence.actions.length,0);
assert.equal(prepareAssistantReply({transcription:'avtobusga 2 ming 300 so‘m berdim',actions:[{...base,amount:2300,amountEvidence:'2 ming 300'}]},'uz',true).actions[0].amount,2300);
const falseSaved=prepareAssistantReply({transcription:'avtobusga',actions:[],message:"Avtobusga qilgan xarajatni yozib qo'ydim."},'uz',true);
assert.match(falseSaved.message,/hech narsa saqlanmadi/);assert.ok(falseSaved.question);
assert.equal(assistantLanguage({language:'en',onboarding:{language:'uz'}}),'uz');
assert.equal(assistantLanguage({language:'en'},'uz'),'uz');
assert.equal(assistantLanguage({},'unexpected'),'uz');
const english=prepareAssistantReply({actions:[{...base,amountEvidence:''}],question:'Is this borrowing or lending?'},'uz',false);
assert.match(english.question,/qarz oldingizmi/);assert.doesNotMatch(english.question,/lending/);
const card=prepareAssistantReply({actions:[{...base,account:'card:mine',amountEvidence:''}]},'uz',false,'',[{id:'mine'}]);
assert.equal(card.actions[0].cardId,'mine');
const unknown=prepareAssistantReply({actions:[{...base,account:'card:other',amountEvidence:''}]},'uz',false,'',[{id:'mine'}]);
assert.match(unknown.question,/hisob/);
assert.equal(prepareAssistantReply({actions:[{...base,amountEvidence:''}],message:'Saved!'},'uz',false).message,'');
console.log('Interpretation checks passed: meal sum, mixed records, scale mismatch, false acknowledgments, locale and account handling. No real speech recognition was tested.');

const omitted=prepareAssistantReply({transcription:"yo‘lkiraga 17 ming so‘m ketdi plyus + kartadan avtobusga 2 ming 300 so‘m berdim",actions:[{...base,amount:2300,amountEvidence:'2 ming 300'}]},'uz',true);
assert.equal(omitted.actions.length,0);assert.match(omitted.message,/faqat bitta/);
for(const message of ["Avtobus uchun to'lovni xarajat sifatida kiritdim.",'Tayyor, bajarildi.','Hisobga oldim.']){
 const noWrite=prepareAssistantReply({intent:'transaction',actions:[],transcription:'Avtobusga 2300 so‘m berdim',message},'uz',true);
 assert.equal(noWrite.actions.length,0);assert.match(noWrite.message,/hech narsa saqlanmadi/);assert.ok(noWrite.question);assert.ok(!JSON.stringify(noWrite).includes(message));
}
const readOnly=prepareAssistantReply({intent:'answer',actions:[],transcription:'Budjet nima?',message:'Budjet — daromad va xarajatlar rejasi.'},'uz',true);
assert.match(readOnly.message,/daromad/);
