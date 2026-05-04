export type SoundName =
  | 'hatch_click'
  | 'egg_crack'
  | 'common_drop'
  | 'rare_drop'
  | 'epic_drop'
  | 'legendary_drop'
  | 'mythic_drop'
  | 'upgrade'
  | 'coin_collect'
  | 'reward_claim'
  | 'purchase_success'
  | 'error';

const SOUND_ENABLED_KEY = 'eggflip-sound-enabled-v1';
const SOUND_FILE_PATHS: Partial<Record<SoundName, string>> = {};

export const getSoundEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
};

export const setSoundEnabled = (value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SOUND_ENABLED_KEY, String(value));
};

export const playSound = (soundName: SoundName) => {
  if (typeof window === 'undefined' || !getSoundEnabled()) {
    return;
  }

  const soundPath = SOUND_FILE_PATHS[soundName];
  if (!soundPath) {
    return;
  }

  try {
    const audio = new Audio(soundPath);
    audio.volume = 0.7;
    audio.play().catch(() => undefined);
  } catch {
    // Audio files are intentionally absent for now.
  }
};
