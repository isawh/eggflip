import {
  REFERRAL_MILESTONES,
  STARTING_COINS,
  STARTING_FREE_EGGS,
  STARTING_GEMS,
  STARTING_MAX_CREATURE_SLOTS,
  STARTING_PREMIUM_EGGS,
} from './constants';
import type { DailyRewardState, EggType, GameState, ReferralMilestoneId } from './types';

const STORAGE_KEY = 'eggflip-game-state-v1';

const defaultEggs = (): Record<EggType, number> => ({
  free: STARTING_FREE_EGGS,
  basic: 0,
  premium: 0,
});

export const createInitialGameState = (now = Date.now()): GameState => ({
  coins: STARTING_COINS,
  gems: STARTING_GEMS,
  premiumEggs: STARTING_PREMIUM_EGGS,
  eggs: defaultEggs(),
  creatures: [],
  selectedCreatureUid: null,
  lastIncomeAt: now,
  lastActiveAt: now,
  lastFreeEggAt: now,
  incomeBoostUntil: null,
  maxCreatureSlots: STARTING_MAX_CREATURE_SLOTS,
  referralCode: createReferralCode(),
  invitedFriendsCount: 0,
  claimedReferralMilestones: [],
  dailyRewards: {
    claimedDays: [],
    lastClaimDate: null,
    streakDay: 1,
    lastLoginAt: null,
  },
  referralRewardClaimed: false,
});

export const loadGameState = (): GameState => {
  if (typeof window === 'undefined') {
    return createInitialGameState();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialGameState();
  }

  try {
    const saved = JSON.parse(raw) as Partial<GameState>;
    const now = Date.now();
    const base = createInitialGameState(now);
    const savedEggs = (saved.eggs ?? {}) as Partial<Record<EggType, unknown>>;
    const savedDailyRewards = (saved.dailyRewards ?? {}) as Partial<DailyRewardState>;
    const claimedDays = Array.isArray(savedDailyRewards.claimedDays)
      ? savedDailyRewards.claimedDays
          .map((day: unknown) => Math.floor(Number(day)))
          .filter((day: number) => day >= 1 && day <= 7)
      : base.dailyRewards.claimedDays;
    const lastIncomeAt = asTimestamp(saved.lastIncomeAt, now);
    const lastActiveAt = asTimestamp(saved.lastActiveAt, lastIncomeAt);
    const premiumEggs = asCount(saved.premiumEggs, asCount(savedEggs.premium, base.premiumEggs));
    const validMilestoneIds = new Set(REFERRAL_MILESTONES.map((milestone) => milestone.id));
    const claimedReferralMilestones = Array.isArray(saved.claimedReferralMilestones)
      ? saved.claimedReferralMilestones.filter((id): id is ReferralMilestoneId => validMilestoneIds.has(id as ReferralMilestoneId))
      : base.claimedReferralMilestones;

    return {
      ...base,
      ...saved,
      coins: asCount(saved.coins, base.coins),
      gems: asCount(saved.gems, base.gems),
      premiumEggs,
      eggs: {
        free: asCount(savedEggs.free, base.eggs.free),
        basic: asCount(savedEggs.basic, base.eggs.basic),
        premium: premiumEggs,
      },
      creatures: Array.isArray(saved.creatures) ? saved.creatures : base.creatures,
      lastIncomeAt,
      lastActiveAt,
      lastFreeEggAt: asTimestamp(saved.lastFreeEggAt, base.lastFreeEggAt),
      incomeBoostUntil: asNullableTimestamp(saved.incomeBoostUntil),
      maxCreatureSlots: Math.max(1, asCount(saved.maxCreatureSlots, base.maxCreatureSlots)),
      referralCode: normalizeReferralCode(saved.referralCode, base.referralCode),
      invitedFriendsCount: asCount(saved.invitedFriendsCount, base.invitedFriendsCount),
      claimedReferralMilestones,
      dailyRewards: {
        ...base.dailyRewards,
        ...savedDailyRewards,
        claimedDays,
        lastClaimDate:
          typeof savedDailyRewards.lastClaimDate === 'string' ? savedDailyRewards.lastClaimDate : base.dailyRewards.lastClaimDate,
        streakDay: clampStreakDay(savedDailyRewards.streakDay ?? Math.max(1, claimedDays.length || 1)),
        lastLoginAt: asNullableTimestamp(savedDailyRewards.lastLoginAt),
      },
    };
  } catch {
    return createInitialGameState();
  }
};

export const saveGameState = (state: GameState) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const asCount = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;

const asTimestamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;

const asNullableTimestamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;

const clampStreakDay = (day: number): number => Math.min(7, Math.max(1, Math.floor(day)));

const createReferralCode = (): string => {
  const randomPart =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(5)))
          .map((value) => value.toString(36).padStart(2, '0'))
          .join('')
          .slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `EGG-${randomPart.toUpperCase()}`;
};

const normalizeReferralCode = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
  return normalized.length >= 6 ? normalized : fallback;
};
