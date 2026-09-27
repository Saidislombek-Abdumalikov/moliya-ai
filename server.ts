import express from 'express';
import path from 'node:path';
import auth from './api/auth.js';
import admin from './api/admin.js';
import webhook from './api/telegram-webhook.js';
import expense from './api/parse-expense.js';
import receipt from './api/parse-receipt.js';
import rates from './api/currency-rates.js';
export const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'13mb'}));
const adapt=(handler:any)=>(req:any,res:any,next:any)=>Promise.resolve(handler(req,res)).catch(next);
app.all('/api/auth',adapt(auth));app.all('/api/auth/:action',adapt(auth));
app.all('/api/admin',adapt(admin));app.all('/api/admin/:route',adapt(admin));
app.all('/api/telegram-webhook',adapt(webhook));
app.all('/api/parse-expense',adapt(expense));app.all('/api/parse-receipt',adapt(receipt));
app.get('/api/currency-rates',adapt(rates));app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.use('/api',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
app.use((err:any,_req:any,res:any,_next:any)=>res.status(err?.type==='entity.too.large'?413:500).json({error:'REQUEST_FAILED'}));
async function start(){
 if(process.env.NODE_ENV!=='production'){
  const {createServer}=await import('vite'); const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
 }else{app.use(express.static(path.join(process.cwd(),'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(process.cwd(),'dist/index.html')));}
 app.listen(Number(process.env.PORT||3000),'0.0.0.0');
}
if(process.env.VERCEL!=='1' && process.env.MOLIYA_TEST!=='1')start().catch(()=>{process.exitCode=1;});
export default app;
