import {useCallback, useEffect, useState} from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

declare global {
  interface Window {
    __hydropinInstallPrompt?: BeforeInstallPromptEvent | null;
    __hydropinAppInstalled?: boolean;
  }
}

let sharedDeferredPrompt: BeforeInstallPromptEvent | null =
  typeof window !== 'undefined' ? (window.__hydropinInstallPrompt ?? null) : null;
let sharedIsInstalled =
  typeof window !== 'undefined'
    ? Boolean(
        window.__hydropinAppInstalled ||
          window.matchMedia?.('(display-mode: standalone)').matches ||
          (window.navigator as unknown as {standalone?: boolean}).standalone ===
            true
      )
    : false;

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== 'undefined') {
  const onBeforeInstall = (e: Event) => {
    e.preventDefault();
    const promptEvt = e as BeforeInstallPromptEvent;
    sharedDeferredPrompt = promptEvt;
    window.__hydropinInstallPrompt = promptEvt;
    notifyListeners();
  };

  const onInstallReady = () => {
    if (window.__hydropinInstallPrompt) {
      sharedDeferredPrompt = window.__hydropinInstallPrompt;
      notifyListeners();
    }
  };

  const onInstalled = () => {
    sharedIsInstalled = true;
    sharedDeferredPrompt = null;
    window.__hydropinAppInstalled = true;
    window.__hydropinInstallPrompt = null;
    notifyListeners();
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('hydropin-install-ready', onInstallReady);
  window.addEventListener('appinstalled', onInstalled);
  window.addEventListener('hydropin-app-installed', onInstalled);
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(() => sharedDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () => sharedIsInstalled
  );
  const [isIOS] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua);
  });
  const [isInIframe] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const sync = () => {
      setDeferredPrompt(sharedDeferredPrompt);
      setIsInstalled(sharedIsInstalled);
    };
    listeners.add(sync);
    sync();

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = (evt: MediaQueryListEvent) => {
      if (evt.matches) {
        sharedIsInstalled = true;
        sharedDeferredPrompt = null;
        sync();
      }
    };
    mql?.addEventListener?.('change', onDisplayChange);

    return () => {
      listeners.delete(sync);
      mql?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const target = sharedDeferredPrompt || window.__hydropinInstallPrompt;
    if (!target) return false;
    try {
      await target.prompt();
      const {outcome} = await target.userChoice;
      if (outcome === 'accepted') {
        sharedIsInstalled = true;
        sharedDeferredPrompt = null;
        window.__hydropinAppInstalled = true;
        window.__hydropinInstallPrompt = null;
        notifyListeners();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isInIframe,
    install,
  };
}
