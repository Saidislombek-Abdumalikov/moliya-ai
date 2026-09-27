import {Document, HeadingLevel, Packer, Paragraph, TextRun} from 'docx';
import type {LegalDocuments} from './_legalDocuments.js';

// Built from the exact same snapshot whose hash is attached to the consent
// button. No hosted stale document, database migration, or separate legal text.
export async function buildLegalFile(docs: LegalDocuments): Promise<Buffer> {
  const paragraphs = (text: string) => text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const heading = /^(#{1,6})\s+/.exec(line);
    const bullet = /^\*\s+/.test(line);
    const content = line.replace(/^#{1,6}\s+/, '').replace(/^\*\s+/, '');
    return new Paragraph({
      ...(heading ? {heading: HeadingLevel.HEADING_2, keepNext:true} : {}),
      ...(bullet ? {bullet:{level:0}} : {}),
      spacing: {before:heading?180:0,after:100},
      children: content.split(/(\*\*.*?\*\*)/g).map(part => new TextRun({
        text: part.startsWith('**') && part.endsWith('**') ? part.slice(2,-2) : part,
        ...(part.startsWith('**') && part.endsWith('**') ? {bold:true} : {})
      }))
    });
  });
  return Packer.toBuffer(new Document({
    creator:'Moliya AI', title:'Moliya AI Oferta va Maxfiylik siyosati',
    styles:{default:{document:{run:{font:'Arial',size:22,color:'000000'},paragraph:{spacing:{line:276}}},
      title:{run:{font:'Arial',size:32,bold:true,color:'000000'}},
      heading1:{run:{font:'Arial',size:28,bold:true,color:'000000'}},
      heading2:{run:{font:'Arial',size:24,bold:true,color:'000000'}}}},
    sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1080,bottom:1080,left:1080,right:1080}}},children:[
      new Paragraph({text:'Moliya AI Oferta va Maxfiylik siyosati',heading:HeadingLevel.TITLE}),
      new Paragraph({text:'Quyida xizmatdan foydalanish shartlari va maxfiylik siyosati keltirilgan. Rozilik hujjatlar o‘qilgach botdagi tugma orqali tasdiqlanadi.'}),
      ...paragraphs(docs.oferta),
      new Paragraph({text:'Maxfiylik siyosati',heading:HeadingLevel.HEADING_1,pageBreakBefore:true}),
      ...paragraphs(docs.privacy),
      new Paragraph({children:[new TextRun({text:docs.version,size:16})]})
    ]}]
  }));
}

export async function sendLegalFile(token: string, chatId: string | number, docs: LegalDocuments): Promise<boolean> {
  const body = new FormData();
  body.set('chat_id',String(chatId));
  const bytes = await buildLegalFile(docs);
  body.set('document',new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'Moliya-AI-Oferta-Maxfiylik.docx');
  body.set('caption',"📄 Moliya AI axborot tizimidan foydalanish bo‘yicha Ommaviy Oferta va Maxfiylik siyosati.");
  body.set('reply_markup',JSON.stringify({inline_keyboard:[[{text:'✅ Roziman va qabul qilaman',callback_data:`accept_oferta:${docs.version.slice(7,31)}`}]]}));
  const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body,signal:AbortSignal.timeout(12000)});
  const result=await response.json();
  return response.ok && result?.ok === true;
}
