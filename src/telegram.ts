export type TelegramHapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type TelegramHapticNotificationType = 'error' | 'success' | 'warning';

export interface TelegramWebAppUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
}

interface TelegramInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface TelegramWebApp {
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  themeParams?: TelegramThemeParams;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  ready?: () => void;
  expand?: () => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: TelegramHapticImpactStyle) => void;
    notificationOccurred?: (type: TelegramHapticNotificationType) => void;
    selectionChanged?: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

let hapticsEnabled = false;

const getWebApp = (): TelegramWebApp | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.Telegram?.WebApp;
};

const safely = (callback: () => void) => {
  try {
    callback();
  } catch {
    // Telegram WebApp APIs should never break regular browser gameplay.
  }
};

const setCssColor = (name: string, value: string | undefined) => {
  if (!value || typeof document === 'undefined') {
    return;
  }

  document.documentElement.style.setProperty(name, value);
};

const setCssInset = (prefix: string, inset: TelegramInset | undefined) => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const top = Math.max(0, Number(inset?.top ?? 0));
  const right = Math.max(0, Number(inset?.right ?? 0));
  const bottom = Math.max(0, Number(inset?.bottom ?? 0));
  const left = Math.max(0, Number(inset?.left ?? 0));

  root.style.setProperty(`${prefix}-top`, `${top}px`);
  root.style.setProperty(`${prefix}-right`, `${right}px`);
  root.style.setProperty(`${prefix}-bottom`, `${bottom}px`);
  root.style.setProperty(`${prefix}-left`, `${left}px`);
};

export const isTelegram = (): boolean => Boolean(getWebApp());

export const getUser = (): TelegramWebAppUser | null => getWebApp()?.initDataUnsafe?.user ?? null;

export const expandApp = () => {
  const webApp = getWebApp();

  if (!webApp) {
    return;
  }

  safely(() => webApp.ready?.());
  safely(() => webApp.expand?.());
};

export const enableHaptics = (): boolean => {
  hapticsEnabled = Boolean(getWebApp()?.HapticFeedback);
  return hapticsEnabled;
};

export const applyTelegramThemeColors = () => {
  const webApp = getWebApp();

  if (!webApp || typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.telegram = 'true';

  const theme = webApp.themeParams ?? {};
  setCssColor('--eggflip-tg-bg-color', theme.bg_color);
  setCssColor('--eggflip-tg-surface-color', theme.secondary_bg_color);
  setCssColor('--eggflip-tg-text-color', theme.text_color);
  setCssColor('--eggflip-tg-hint-color', theme.hint_color);
  setCssColor('--eggflip-tg-button-color', theme.button_color);
  setCssColor('--eggflip-tg-button-text-color', theme.button_text_color);
  setCssColor('--eggflip-tg-bottom-bar-color', theme.bottom_bar_bg_color);
  setCssInset('--eggflip-safe-area', webApp.safeAreaInset);
  setCssInset('--eggflip-content-safe-area', webApp.contentSafeAreaInset);

  if (theme.bg_color) {
    safely(() => webApp.setBackgroundColor?.(theme.bg_color as string));
  }

  if (theme.header_bg_color || theme.secondary_bg_color || theme.bg_color) {
    safely(() => webApp.setHeaderColor?.((theme.header_bg_color ?? theme.secondary_bg_color ?? theme.bg_color) as string));
  }
};

export const triggerHapticImpact = (style: TelegramHapticImpactStyle) => {
  const feedback = getWebApp()?.HapticFeedback;

  if (!hapticsEnabled || !feedback?.impactOccurred) {
    return;
  }

  safely(() => feedback.impactOccurred?.(style));
};

export const triggerHapticNotification = (type: TelegramHapticNotificationType) => {
  const feedback = getWebApp()?.HapticFeedback;

  if (!hapticsEnabled || !feedback?.notificationOccurred) {
    return;
  }

  safely(() => feedback.notificationOccurred?.(type));
};
