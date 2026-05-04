import {
  CREATURES,
  DAILY_REWARDS,
  ECONOMY,
  FREE_EGG_COOLDOWN_MS,
  MAX_OFFLINE_EARNINGS_MS,
  MILLISECONDS_PER_MINUTE,
  NORMAL_EGG_RARITY_CHANCES,
  PREMIUM_EGG_RARITY_CHANCES,
  STREAK_RESET_MS,
} from './constants';
import type { CreatureDefinition, DailyReward, EggType, GameState, OwnedCreature, Rarity } from './types';

const fallbackCreature = CREATURES[0];

export const getCreatureDefinition = (creatureId: string): CreatureDefinition =>
  CREATURES.find((creature) => creature.id === creatureId) ?? fallbackCreature;

export const getCreatureIncomePerMinute = (creature: OwnedCreature): number => {
  const definition = getCreatureDefinition(creature.creatureId);
  const rarityMultiplier = ECONOMY.rarityIncomeMultipliers[definition.rarity];
  return Math.round(definition.baseIncomePerMinute * creature.level * rarityMultiplier);
};

export const getActiveCreatures = (state: GameState): OwnedCreature[] =>
  state.creatures.slice(0, state.maxCreatureSlots);

export const getBaseIncomePerMinute = (state: GameState): number =>
  getActiveCreatures(state).reduce((total, creature) => total + getCreatureIncomePerMinute(creature), 0);

export const isIncomeBoostActive = (state: GameState, now = Date.now()): boolean =>
  Boolean(state.incomeBoostUntil && state.incomeBoostUntil > now);

export const getIncomeBoostMultiplier = (state: GameState, now = Date.now()): number =>
  isIncomeBoostActive(state, now) ? 2 : 1;

export const getIncomeBoostRemainingMs = (state: GameState, now = Date.now()): number =>
  Math.max(0, (state.incomeBoostUntil ?? 0) - now);

export const getTotalIncomePerMinute = (state: GameState, now = Date.now()): number =>
  getBaseIncomePerMinute(state) * getIncomeBoostMultiplier(state, now);

export const getUpgradeCost = (creature: OwnedCreature): number => {
  const scaled = ECONOMY.upgradeBaseCost * Math.pow(creature.level, ECONOMY.upgradeLevelExponent);
  return Math.round(scaled / 5) * 5;
};

export const getUpgradedIncomePreview = (creature: OwnedCreature): number =>
  getCreatureIncomePerMinute({ ...creature, level: creature.level + 1 });

export const getEggCount = (state: GameState): number =>
  state.eggs.free + state.eggs.basic + state.premiumEggs;

export const getEggInventoryCount = (state: GameState, eggType: EggType): number =>
  eggType === 'premium' ? state.premiumEggs : state.eggs[eggType];

export const getPreferredEggType = (state: GameState): EggType | null => {
  if (state.eggs.free > 0) return 'free';
  if (state.eggs.basic > 0) return 'basic';
  if (state.premiumEggs > 0) return 'premium';
  return null;
};

const rollRarity = (chances: Array<{ rarity: Rarity; chance: number }>): Rarity => {
  const total = chances.reduce((sum, item) => sum + item.chance, 0);
  let roll = Math.random() * total;

  for (const item of chances) {
    roll -= item.chance;
    if (roll <= 0) {
      return item.rarity;
    }
  }

  return chances[chances.length - 1].rarity;
};

export const rollCreature = (eggType: EggType): CreatureDefinition => {
  const chances = eggType === 'premium' ? PREMIUM_EGG_RARITY_CHANCES : NORMAL_EGG_RARITY_CHANCES;
  const rarity = rollRarity(chances);
  const pool = CREATURES.filter((creature) => creature.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)] ?? fallbackCreature;
};

export const createOwnedCreature = (definition: CreatureDefinition, now = Date.now()): OwnedCreature => ({
  uid: createId(),
  creatureId: definition.id,
  level: 1,
  hatchedAt: now,
});

export const applyPassiveIncome = (state: GameState, now = Date.now()): GameState => {
  const incomePerMinute = getTotalIncomePerMinute(state, now);

  if (incomePerMinute <= 0) {
    return {
      ...state,
      lastActiveAt: now,
      lastIncomeAt: now,
    };
  }

  const earnedCoins = calculateEarnedCoins(state, state.lastIncomeAt, now);

  if (earnedCoins <= 0) {
    return {
      ...state,
      lastActiveAt: now,
    };
  }

  return {
    ...state,
    coins: state.coins + earnedCoins,
    lastIncomeAt: now,
    lastActiveAt: now,
  };
};

export const applyOfflineEarnings = (
  state: GameState,
  now = Date.now(),
): { state: GameState; earnedCoins: number; elapsedMs: number } => {
  const incomePerMinute = getTotalIncomePerMinute(state, now);
  const elapsedMs = Math.max(0, now - state.lastActiveAt);
  const eligibleElapsedMs = Math.min(elapsedMs, MAX_OFFLINE_EARNINGS_MS);

  if (incomePerMinute <= 0 || eligibleElapsedMs <= 0) {
    return {
      state: {
        ...state,
        lastActiveAt: now,
        lastIncomeAt: now,
      },
      earnedCoins: 0,
      elapsedMs,
    };
  }

  const earnedCoins = calculateEarnedCoins(state, now - eligibleElapsedMs, now);

  return {
    state: {
      ...state,
      coins: state.coins + earnedCoins,
      lastActiveAt: now,
      lastIncomeAt: now,
    },
    earnedCoins,
    elapsedMs,
  };
};

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(value));

export const getTodayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getNextDailyReward = (state: GameState): DailyReward | null =>
  DAILY_REWARDS.find(
    (reward) => reward.day === state.dailyRewards.streakDay && !state.dailyRewards.claimedDays.includes(reward.day),
  ) ?? null;

export const canClaimDailyReward = (state: GameState, date = new Date()): boolean =>
  Boolean(getNextDailyReward(state)) && state.dailyRewards.lastClaimDate !== getTodayKey(date);

export const applyDailyReward = (state: GameState, reward: DailyReward, date = new Date()): GameState => {
  const next: GameState = {
    ...state,
    dailyRewards: {
      ...state.dailyRewards,
      claimedDays: Array.from(new Set([...state.dailyRewards.claimedDays, reward.day])),
      lastClaimDate: getTodayKey(date),
    },
  };

  if (reward.type === 'coins') {
    return { ...next, coins: next.coins + reward.amount };
  }

  if (reward.type === 'gems') {
    return { ...next, gems: next.gems + reward.amount };
  }

  const eggType = reward.eggType ?? 'free';

  if (eggType === 'premium') {
    return {
      ...next,
      premiumEggs: next.premiumEggs + reward.amount,
      eggs: {
        ...next.eggs,
        premium: next.premiumEggs + reward.amount,
      },
    };
  }

  return {
    ...next,
    eggs: {
      ...next.eggs,
      [eggType]: next.eggs[eggType] + reward.amount,
    },
  };
};

export const getFreeEggReadyAt = (state: GameState): number =>
  state.lastFreeEggAt + FREE_EGG_COOLDOWN_MS;

export const registerLoginStreak = (state: GameState, now = Date.now()): GameState => {
  const lastLoginAt = state.dailyRewards.lastLoginAt;

  if (!lastLoginAt) {
    return {
      ...state,
      dailyRewards: {
        ...state.dailyRewards,
        streakDay: clampStreakDay(state.dailyRewards.streakDay || 1),
        lastLoginAt: now,
      },
    };
  }

  if (getTodayKey(new Date(lastLoginAt)) === getTodayKey(new Date(now))) {
    return {
      ...state,
      dailyRewards: {
        ...state.dailyRewards,
        lastLoginAt: now,
      },
    };
  }

  if (now - lastLoginAt > STREAK_RESET_MS) {
    return {
      ...state,
      dailyRewards: {
        ...state.dailyRewards,
        claimedDays: [],
        lastClaimDate: null,
        streakDay: 1,
        lastLoginAt: now,
      },
    };
  }

  return {
    ...state,
    dailyRewards: {
      ...state.dailyRewards,
      streakDay: clampStreakDay(state.dailyRewards.streakDay + 1),
      lastLoginAt: now,
    },
  };
};

export const getCooldownLabel = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clampStreakDay = (day: number): number => Math.min(7, Math.max(1, Math.floor(day)));

const calculateEarnedCoins = (state: GameState, from: number, to: number): number => {
  const elapsedMs = Math.max(0, to - from);
  const baseIncomePerMinute = getBaseIncomePerMinute(state);

  if (elapsedMs <= 0 || baseIncomePerMinute <= 0) {
    return 0;
  }

  const boostUntil = state.incomeBoostUntil ?? 0;

  if (boostUntil <= from) {
    return Math.floor((elapsedMs / MILLISECONDS_PER_MINUTE) * baseIncomePerMinute);
  }

  if (boostUntil >= to) {
    return Math.floor((elapsedMs / MILLISECONDS_PER_MINUTE) * baseIncomePerMinute * 2);
  }

  const boostedMs = Math.max(0, boostUntil - from);
  const normalMs = Math.max(0, to - boostUntil);
  const earned =
    ((boostedMs / MILLISECONDS_PER_MINUTE) * baseIncomePerMinute * 2) +
    ((normalMs / MILLISECONDS_PER_MINUTE) * baseIncomePerMinute);

  return Math.floor(earned);
};
