type TelegramViewport = {
  initData?: string;
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  requestFullscreen?: () => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
};

// The external Telegram SDK loads in parallel with the app bundle. Only a
// Telegram launch waits for signed data; a stalled SDK cannot hang forever.
export async function waitForTelegramSdk<T extends {initData?: string}>(read: () => T | undefined, timeoutMs = 5000): Promise<T | undefined> {
  const initial = read();
  if (initial?.initData) return initial;
  return new Promise(resolve => {
    const started = Date.now();
    const interval = setInterval(() => {
      const sdk = read();
      if (sdk?.initData || Date.now() - started >= timeoutMs) {
        clearInterval(interval);
        resolve(sdk?.initData ? sdk : undefined);
      }
    }, 100);
  });
}

export function configureTelegramViewport(tg: TelegramViewport | undefined) {
  if (!tg) return false;
  // An older Telegram client may lack individual methods. One failure must not
  // prevent the remaining viewport controls from being requested.
  for (const action of ['ready', 'expand', 'disableVerticalSwipes', 'enableClosingConfirmation'] as const) {
    try { tg[action]?.(); } catch {}
  }
  if (tg.platform === 'ios' || tg.platform === 'android') {
    try { tg.requestFullscreen?.(); } catch {}
  }
  return true;
}

export function keepTelegramSwipesDisabled(tg: TelegramViewport | undefined): () => void {
  if (!tg) return () => {};
  const disable = () => { try { tg.disableVerticalSwipes?.(); } catch {} };
  // Fullscreen changes and restoration may reconfigure the native viewport.
  for (const event of ['fullscreenChanged', 'activated']) {
    try { tg.onEvent?.(event, disable); } catch {}
  }
  return () => {
    for (const event of ['fullscreenChanged', 'activated']) {
      try { tg.offEvent?.(event, disable); } catch {}
    }
  };
}
