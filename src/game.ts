import {
  CREATURES,
  DAILY_REWARDS,
  ECONOMY,
  FREE_EGG_COOLDOWN_MS,
  MAX_OFFLINE_EARNINGS_MS,
  MILLISECONDS_PER_MINUTE,
  NORMAL_EGG_RARITY_CHANCES,
  PRESTIGE_UPGRADES,
  PREMIUM_EGG_RARITY_CHANCES,
  RARITY_ORDER,
  STARTING_COINS,
  STARTING_FREE_EGGS,
  STARTING_TIER,
  STREAK_RESET_MS,
  TIER_DEFINITIONS,
} from './constants';
import type { CreatureDefinition, DailyReward, EggType, GameState, OwnedCreature, PrestigeUpgradeId, Rarity, Tier } from './types';

const fallbackCreature = CREATURES[0];

export const getCreatureDefinition = (creatureId: string): CreatureDefinition =>
  CREATURES.find((creature) => creature.id === creatureId) ?? fallbackCreature;

export const getRarityTier = (rarity: Rarity): Tier =>
  (RARITY_ORDER.indexOf(rarity) + 1) as Tier;

export const getTierDefinition = (tier: Tier) =>
  TIER_DEFINITIONS.find((definition) => definition.tier === tier) ?? TIER_DEFINITIONS[0];

export const getMaxActiveSlotsForTier = (tier: Tier): number =>
  getTierDefinition(tier).activeSlots;

export const getPrestigeIncomeMultiplier = (state: GameState): number =>
  1 + state.prestigeUpgrades.income * ECONOMY.prestigeIncomeBonusPerLevel;

export const getPrestigeSlotBonus = (state: GameState): number =>
  state.prestigeUpgrades.slot;

export const getPrestigeCooldownReduction = (state: GameState): number =>
  Math.min(
    ECONOMY.prestigeMaxCooldownReduction,
    state.prestigeUpgrades.cooldown * ECONOMY.prestigeCooldownReductionPerLevel,
  );

export const getFreeEggCooldownMs = (state: GameState): number =>
  Math.round(FREE_EGG_COOLDOWN_MS * (1 - getPrestigeCooldownReduction(state)));

export const getCreatureIncomePerMinute = (creature: OwnedCreature): number => {
  const definition = getCreatureDefinition(creature.creatureId);
  const rarityMultiplier = ECONOMY.rarityIncomeMultipliers[definition.rarity];
  return Math.round(definition.baseIncomePerMinute * creature.level * rarityMultiplier);
};

export const getActiveCreatures = (state: GameState): OwnedCreature[] =>
  state.creatures.slice(0, state.maxCreatureSlots);

export const getBaseIncomePerMinute = (state: GameState): number =>
  Math.round(
    getActiveCreatures(state).reduce((total, creature) => total + getCreatureIncomePerMinute(creature), 0) *
      getPrestigeIncomeMultiplier(state),
  );

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

interface RollCreatureOptions {
  minimumRarity?: Rarity;
  maxTier?: Tier;
  dropBonusLevel?: number;
}

export const rollCreature = (eggType: EggType, options: RollCreatureOptions = {}): CreatureDefinition => {
  const baseChances = eggType === 'premium' ? PREMIUM_EGG_RARITY_CHANCES : NORMAL_EGG_RARITY_CHANCES;
  const filteredChances = baseChances.filter((item) => {
    const rarityTier = getRarityTier(item.rarity);
    const aboveMinimum = options.minimumRarity ? rarityTier >= getRarityTier(options.minimumRarity) : true;
    const withinTierCap = options.maxTier ? rarityTier <= options.maxTier : true;
    return aboveMinimum && withinTierCap;
  });
  const chances = (filteredChances.length > 0 ? filteredChances : baseChances).map((item) => {
    const rarityTier = getRarityTier(item.rarity);
    const bonusMultiplier = rarityTier > 1
      ? 1 + (options.dropBonusLevel ?? 0) * ECONOMY.prestigeDropBonusPerLevel * (rarityTier - 1)
      : Math.max(0.25, 1 - (options.dropBonusLevel ?? 0) * 0.03);

    return {
      ...item,
      chance: item.chance * bonusMultiplier,
    };
  });
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
    totalCoinsEarned: state.totalCoinsEarned + earnedCoins,
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
      totalCoinsEarned: state.totalCoinsEarned + earnedCoins,
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
    return { ...next, coins: next.coins + reward.amount, totalCoinsEarned: next.totalCoinsEarned + reward.amount };
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
  state.lastFreeEggAt + getFreeEggCooldownMs(state);

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

export interface TierProgress {
  currentTier: Tier;
  currentLabel: string;
  maxRarity: Rarity;
  activeSlots: number;
  nextTier: Tier | null;
  nextLabel: string | null;
  goalLabel: string;
  progressLabel: string;
  progressPercent: number;
}

export const getTotalUpgradeCount = (state: GameState): number =>
  state.creatures.reduce((total, creature) => total + Math.max(0, creature.level - 1), 0);

export const getProgressionTier = (state: GameState): Tier => {
  const baseIncome = getBaseIncomePerMinute(state);
  const upgrades = getTotalUpgradeCount(state);

  return TIER_DEFINITIONS.reduce<Tier>((highestTier, definition) => {
    const unlockedByIncome = baseIncome >= definition.incomeRequired;
    const unlockedByUpgrades = upgrades >= definition.upgradesRequired;
    return unlockedByIncome || unlockedByUpgrades ? definition.tier : highestTier;
  }, 1);
};

export const applyTierProgression = (state: GameState): GameState => {
  let playerTier = state.playerTier;
  let maxCreatureSlots = getMaxActiveSlotsForTier(playerTier) + getPrestigeSlotBonus(state);
  let nextState: GameState = { ...state, playerTier, maxCreatureSlots };

  for (let pass = 0; pass < TIER_DEFINITIONS.length; pass += 1) {
    const nextTier = Math.max(playerTier, getProgressionTier(nextState)) as Tier;
    if (nextTier === playerTier) {
      break;
    }

    playerTier = nextTier;
    maxCreatureSlots = getMaxActiveSlotsForTier(playerTier) + getPrestigeSlotBonus(nextState);
    nextState = { ...nextState, playerTier, maxCreatureSlots };
  }

  return {
    ...nextState,
    playerTier,
    maxCreatureSlots,
  };
};

export const getTierProgress = (state: GameState): TierProgress => {
  const currentTier = state.playerTier;
  const currentDefinition = getTierDefinition(currentTier);
  const nextDefinition = TIER_DEFINITIONS.find((definition) => definition.tier === currentTier + 1);

  if (!nextDefinition) {
    return {
      currentTier,
      currentLabel: currentDefinition.label,
      maxRarity: currentDefinition.maxRarity,
      activeSlots: state.maxCreatureSlots,
      nextTier: null,
      nextLabel: null,
      goalLabel: 'All tiers unlocked',
      progressLabel: 'Mythic creatures available',
      progressPercent: 100,
    };
  }

  const baseIncome = getBaseIncomePerMinute(state);
  const upgrades = getTotalUpgradeCount(state);
  const incomePercent = nextDefinition.incomeRequired > 0 ? baseIncome / nextDefinition.incomeRequired : 1;
  const upgradePercent = nextDefinition.upgradesRequired > 0 ? upgrades / nextDefinition.upgradesRequired : 1;
  const useIncomeProgress = incomePercent >= upgradePercent;

  return {
    currentTier,
    currentLabel: currentDefinition.label,
    maxRarity: currentDefinition.maxRarity,
    activeSlots: state.maxCreatureSlots,
    nextTier: nextDefinition.tier,
    nextLabel: nextDefinition.label,
    goalLabel: nextDefinition.goalLabel,
    progressLabel: useIncomeProgress
      ? `${formatNumber(baseIncome)}/${formatNumber(nextDefinition.incomeRequired)} income/min`
      : `${upgrades}/${nextDefinition.upgradesRequired} upgrades`,
    progressPercent: Math.min(100, Math.max(0, Math.max(incomePercent, upgradePercent) * 100)),
  };
};

export const getPrestigeEssenceGain = (state: GameState): number =>
  Math.floor(Math.sqrt(state.totalCoinsEarned / ECONOMY.prestigeEssenceDivisor));

export const getPrestigeUpgradeCost = (upgradeId: PrestigeUpgradeId, currentLevel: number): number => {
  const definition = PRESTIGE_UPGRADES.find((upgrade) => upgrade.id === upgradeId);
  if (!definition) {
    return Number.POSITIVE_INFINITY;
  }

  return definition.baseCost + currentLevel * definition.costIncrease;
};

export const canBuyPrestigeUpgrade = (state: GameState, upgradeId: PrestigeUpgradeId): boolean => {
  const definition = PRESTIGE_UPGRADES.find((upgrade) => upgrade.id === upgradeId);
  const currentLevel = state.prestigeUpgrades[upgradeId];

  if (!definition || (definition.maxLevel !== undefined && currentLevel >= definition.maxLevel)) {
    return false;
  }

  return state.essence >= getPrestigeUpgradeCost(upgradeId, currentLevel);
};

export const applyPrestigeUpgrade = (state: GameState, upgradeId: PrestigeUpgradeId): GameState => {
  const currentLevel = state.prestigeUpgrades[upgradeId];
  const cost = getPrestigeUpgradeCost(upgradeId, currentLevel);

  if (!canBuyPrestigeUpgrade(state, upgradeId)) {
    return state;
  }

  return applyTierProgression({
    ...state,
    essence: state.essence - cost,
    prestigeUpgrades: {
      ...state.prestigeUpgrades,
      [upgradeId]: currentLevel + 1,
    },
  });
};

export const applyPrestigeReset = (state: GameState, now = Date.now()): GameState => {
  const gainedEssence = getPrestigeEssenceGain(state);
  const premiumEggs = state.premiumEggs;

  return applyTierProgression({
    ...state,
    coins: STARTING_COINS,
    essence: state.essence + gainedEssence,
    totalCoinsEarned: 0,
    prestigeCount: state.prestigeCount + 1,
    premiumEggs,
    eggs: {
      free: STARTING_FREE_EGGS,
      basic: 0,
      premium: premiumEggs,
    },
    creatures: [],
    selectedCreatureUid: null,
    lastIncomeAt: now,
    lastActiveAt: now,
    lastFreeEggAt: now,
    playerTier: STARTING_TIER,
    maxCreatureSlots: getMaxActiveSlotsForTier(STARTING_TIER) + getPrestigeSlotBonus(state),
    hatchesOpened: 0,
  });
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
