export const INSTALL_DISMISSED_KEY='moliya_install_prompt_dismissed';
export type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let pending:InstallEvent|null=null;
export function telegramInstallBlocked() {
  const w=window as any;
  return Boolean(w.Telegram?.WebApp?.initData || w.TelegramWebviewProxy || w.webkit?.messageHandlers?.TelegramWebviewProxy
    || /tgWebApp(?:Data|Version|Platform)=/.test(location.hash));
}
export function installDismissed() {
  return localStorage.getItem(INSTALL_DISMISSED_KEY)==='true' || Boolean(localStorage.getItem('pwa_prompt_dismissed_at'));
}
export function dismissInstall() {localStorage.setItem(INSTALL_DISMISSED_KEY,'true');pending=null;}
export function pendingInstall() {return pending;}
// Capture before authentication finishes, otherwise Chromium's one-off event
// may happen before the authenticated App mounts the install banner.
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt',(event:Event)=>{
    event.preventDefault();
    if(telegramInstallBlocked()||installDismissed())return;
    pending=event as InstallEvent;
    window.dispatchEvent(new Event('moliya_install_available'));
  });
}
