export const INSTALL_DISMISSED_KEY='moliya_install_prompt_dismissed'; // legacy; no longer a permanent opt-out
export type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let pending:InstallEvent|null=null;
let dismissed=false;
export function telegramInstallBlocked() {
  const w=window as any;
  return Boolean(w.Telegram?.WebApp?.initData || w.TelegramWebviewProxy || w.webkit?.messageHandlers?.TelegramWebviewProxy
    || /tgWebApp(?:Data|Version|Platform)=/.test(location.hash));
}
export function installCompleted() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone===true || localStorage.getItem('moliya_install_confirmed_v2')==='true';
}
export function markInstalled() {
  localStorage.setItem('moliya_install_confirmed_v2','true');pending=null;
  window.dispatchEvent(new Event('moliya_install_completed'));
}
export function installDismissed() {return dismissed;}
export function dismissInstall() {dismissed=true;}
export function pendingInstall() {return pending;}
export function consumeInstall() {const event=pending;pending=null;return event;}
export function captureInstallPrompt() {
  if(!telegramInstallBlocked() && window.matchMedia('(display-mode: standalone)').matches) markInstalled();
  window.addEventListener('appinstalled',()=>{if(!telegramInstallBlocked())markInstalled();});
  window.addEventListener('beforeinstallprompt',(event:Event)=>{
    event.preventDefault();
    if(telegramInstallBlocked())return;
    // A fresh browser offer also permits reinstallation after removal.
    localStorage.removeItem('moliya_install_confirmed_v2');
    pending=event as InstallEvent;
    window.dispatchEvent(new Event('moliya_install_available'));
  });
}
