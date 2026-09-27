export function telegramButtonUrl(value: unknown, base = process.env.APP_URL || 'https://moliya-ai-pi.vercel.app'): string {
  if (typeof value !== 'string' || !value.trim() || value.length>2048 || /[\s\\\u0000-\u001f]/.test(value.trim())) throw Error('INVALID_BUTTON_URL');
  const input=value.trim();
  const qualified=input.startsWith('/') && !input.startsWith('//') ? new URL(input,base).href
    : /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : 'https://'+input;
  const url=new URL(qualified);
  if(url.protocol!=='https:' || url.username || url.password || !url.hostname.includes('.') || input.startsWith('//')) throw Error('INVALID_BUTTON_URL');
  return url.href;
}
export function normalizeTelegramKeyboard(markup:any):any {
  if (!markup || typeof markup!=='object' || JSON.stringify(markup).length>10000) throw Error('INVALID_KEYBOARD');
  if(markup.remove_keyboard===true) return {remove_keyboard:true};
  if(!Array.isArray(markup.inline_keyboard) || markup.inline_keyboard.length>20) throw Error('INVALID_KEYBOARD');
  return {inline_keyboard:markup.inline_keyboard.map((row:any)=>{
    if(!Array.isArray(row)||row.length<1||row.length>8) throw Error('INVALID_KEYBOARD');
    return row.map((button:any)=>{
      if(typeof button?.text!=='string'||!button.text.trim()||button.text.length>100)throw Error('INVALID_BUTTON_TEXT');
      const keys=['url','web_app','callback_data'].filter(key=>button[key]!==undefined);
      if(keys.length!==1)throw Error('INVALID_BUTTON_ACTION');
      const text=button.text.trim();
      if(keys[0]==='url')return {text,url:telegramButtonUrl(button.url)};
      if(keys[0]==='web_app')return {text,web_app:{url:telegramButtonUrl(button.web_app?.url)}};
      if(typeof button.callback_data!=='string'||Buffer.byteLength(button.callback_data)<1||Buffer.byteLength(button.callback_data)>64)throw Error('INVALID_CALLBACK_DATA');
      return {text,callback_data:button.callback_data};
    });
  })};
}
