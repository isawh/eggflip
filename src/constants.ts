import type { CreatureDefinition, DailyReward, EggType, IdleGeneratorId, PrestigeUpgradeId, Rarity, ReferralMilestone, Tier } from './types';

export const GAME_TITLE = 'Idle Loop';

export const STARTING_COINS = 0;
export const STARTING_GEMS = 20;
export const STARTING_FREE_EGGS = 1;
export const STARTING_PREMIUM_EGGS = 0;
export const STARTING_TIER: Tier = 1;
export const STARTING_MAX_CREATURE_SLOTS = 3;
export const EGG_IMAGE_PATH = '/assets/creatures/egg.png';

export const MILLISECONDS_PER_MINUTE = 60_000;
export const FREE_EGG_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const MAX_OFFLINE_EARNINGS_MS = 8 * 60 * 60 * 1000;
export const STREAK_RESET_MS = 48 * 60 * 60 * 1000;
export const INCOME_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
export const REFERRAL_BOOST_DURATION_MS = 48 * 60 * 60 * 1000;
export const INVITE_POPUP_HATCH_THRESHOLD = 3;

/** Central idle loop pays coins when filled; generators run in parallel */
export const MAIN_IDLE_CYCLE_MS = 4_000;
export const MAIN_IDLE_BASE_COINS = 8;

/** Gentle cue when no generator upgrade happened for a while (UI only). */
export const IDLE_UPGRADE_PRESSURE_MS = 75_000;

export const IDLE_GENERATORS: Record<IdleGeneratorId, {
  id: IdleGeneratorId;
  title: string;
  unlockTier: Tier;
  cycleMs: number;
  baseCoinsPerCycle: number;
  upgradeBaseCost: number;
  upgradeCostMultiplier: number;
}> = {
  basic: {
    id: 'basic',
    title: 'Basic Generator',
    unlockTier: 1,
    cycleMs: 2_800,
    baseCoinsPerCycle: 2,
    upgradeBaseCost: 20,
    upgradeCostMultiplier: 1.42,
  },
  advanced: {
    id: 'advanced',
    title: 'Advanced Generator',
    unlockTier: 2,
    cycleMs: 4_400,
    baseCoinsPerCycle: 11,
    upgradeBaseCost: 160,
    upgradeCostMultiplier: 1.52,
  },
  elite: {
    id: 'elite',
    title: 'Elite Generator',
    unlockTier: 3,
    cycleMs: 6_500,
    baseCoinsPerCycle: 45,
    upgradeBaseCost: 850,
    upgradeCostMultiplier: 1.6,
  },
};

// Economy knobs live here so egg prices, upgrades, rewards, and income can be tuned later.
export const ECONOMY = {
  basicEggCoinCost: 500,
  premiumEggGemCost: 50,
  referralRewardCoins: 150,
  referralRewardGems: 5,
  inviteeBonusPremiumEggs: 1,
  inviteeBonusGems: 25,
  starterPackCoins: 1_500,
  starterPackGems: 100,
  starterPackPremiumEggs: 3,
  upgradeBaseCost: 80,
  upgradeLevelExponent: 1.6,
  prestigeEssenceDivisor: 10_000,
  prestigeIncomeBonusPerLevel: 0.1,
  prestigeCooldownReductionPerLevel: 0.05,
  prestigeMaxCooldownReduction: 0.5,
  prestigeDropBonusPerLevel: 0.12,
  rarityIncomeMultipliers: {
    Common: 1,
    Rare: 2,
    Epic: 5,
    Legendary: 12,
    Mythic: 30,
  } satisfies Record<Rarity, number>,
};

export const PRESTIGE_UPGRADES: Array<{
  id: PrestigeUpgradeId;
  title: string;
  description: string;
  icon: string;
  baseCost: number;
  costIncrease: number;
  maxLevel?: number;
}> = [
  {
    id: 'income',
    title: 'Essence Income',
    description: '+10% income per level',
    icon: '⚡',
    baseCost: 1,
    costIncrease: 1,
  },
  {
    id: 'slot',
    title: 'Creature Slot',
    description: '+1 active creature slot',
    icon: '📦',
    baseCost: 3,
    costIncrease: 3,
  },
  {
    id: 'cooldown',
    title: 'Warm Nest',
    description: 'Free eggs cool down faster',
    icon: '⏱️',
    baseCost: 2,
    costIncrease: 2,
    maxLevel: 10,
  },
  {
    id: 'dropChance',
    title: 'Lucky Shell',
    description: 'Better odds inside unlocked tiers',
    icon: '✨',
    baseCost: 2,
    costIncrease: 2,
  },
];

export const EGG_LABELS: Record<EggType, string> = {
  free: 'Free Egg',
  basic: 'Basic Egg',
  premium: 'Premium Egg',
};

export const RARITY_ORDER: Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];

export const TIER_DEFINITIONS: Array<{
  tier: Tier;
  label: string;
  maxRarity: Rarity;
  activeSlots: number;
  incomeRequired: number;
  upgradesRequired: number;
  goalLabel: string;
}> = [
  {
    tier: 1,
    label: 'Basic',
    maxRarity: 'Common',
    activeSlots: 3,
    incomeRequired: 0,
    upgradesRequired: 0,
    goalLabel: 'Start collecting',
  },
  {
    tier: 2,
    label: 'Rare',
    maxRarity: 'Rare',
    activeSlots: 3,
    incomeRequired: 35,
    upgradesRequired: 2,
    goalLabel: 'Reach Tier 2',
  },
  {
    tier: 3,
    label: 'Epic',
    maxRarity: 'Epic',
    activeSlots: 4,
    incomeRequired: 100,
    upgradesRequired: 6,
    goalLabel: 'Reach Epic tier',
  },
  {
    tier: 4,
    label: 'Legendary',
    maxRarity: 'Legendary',
    activeSlots: 4,
    incomeRequired: 360,
    upgradesRequired: 14,
    goalLabel: 'Unlock Legendary creatures',
  },
  {
    tier: 5,
    label: 'Mythic',
    maxRarity: 'Mythic',
    activeSlots: 5,
    incomeRequired: 900,
    upgradesRequired: 28,
    goalLabel: 'Unlock Mythic creatures',
  },
];

export const RARITY_META: Record<Rarity, { color: string; badge: string; glow: string }> = {
  Common: { color: '#58b368', badge: '#c9f7be', glow: 'rgba(88, 179, 104, 0.28)' },
  Rare: { color: '#2f8fff', badge: '#cae4ff', glow: 'rgba(47, 143, 255, 0.28)' },
  Epic: { color: '#9f5cff', badge: '#e4d2ff', glow: 'rgba(159, 92, 255, 0.3)' },
  Legendary: { color: '#ff9f1c', badge: '#ffe0a8', glow: 'rgba(255, 159, 28, 0.34)' },
  Mythic: { color: '#ff4d8d', badge: '#ffd0df', glow: 'rgba(255, 77, 141, 0.35)' },
};

export const NORMAL_EGG_RARITY_CHANCES: Array<{ rarity: Rarity; chance: number }> = [
  { rarity: 'Common', chance: 60 },
  { rarity: 'Rare', chance: 25 },
  { rarity: 'Epic', chance: 10 },
  { rarity: 'Legendary', chance: 4 },
  { rarity: 'Mythic', chance: 1 },
];

export const PREMIUM_EGG_RARITY_CHANCES: Array<{ rarity: Rarity; chance: number }> = [
  { rarity: 'Common', chance: 30 },
  { rarity: 'Rare', chance: 35 },
  { rarity: 'Epic', chance: 20 },
  { rarity: 'Legendary', chance: 12 },
  { rarity: 'Mythic', chance: 3 },
];

export const CREATURES: CreatureDefinition[] = [
  {
    id: 'sleepy-capybara',
    name: 'Sleepy Capybara',
    rarity: 'Common',
    emoji: '🦫',
    imagePath: '/assets/creatures/common-capybara.png',
    baseIncomePerMinute: 8,
    accent: '#78d982',
  },
  {
    id: 'helmet-duck',
    name: 'Helmet Duck',
    rarity: 'Rare',
    emoji: '🦆',
    imagePath: '/assets/creatures/rare-duck.png',
    baseIncomePerMinute: 18,
    accent: '#57b7ff',
  },
  {
    id: 'mushroom-cat',
    name: 'Epic Dragon',
    rarity: 'Epic',
    emoji: '🐉',
    imagePath: '/assets/creatures/epic-dragon.png',
    baseIncomePerMinute: 36,
    accent: '#b47cff',
  },
  {
    id: 'royal-slime',
    name: 'Legendary Griffin',
    rarity: 'Legendary',
    emoji: '🦅',
    imagePath: '/assets/creatures/legendary-griffin.png',
    baseIncomePerMinute: 70,
    accent: '#ffb23f',
  },
  {
    id: 'cosmic-penguin',
    name: 'Mythic Cosmic',
    rarity: 'Mythic',
    emoji: '🌌',
    imagePath: '/assets/creatures/mythic-cosmic.png',
    baseIncomePerMinute: 140,
    accent: '#ff66a7',
  },
];

export const DAILY_REWARDS: DailyReward[] = [
  { day: 1, type: 'coins', amount: 150, label: '150 coins' },
  { day: 2, type: 'coins', amount: 300, label: '300 coins' },
  { day: 3, type: 'gems', amount: 10, label: '10 gems' },
  { day: 4, type: 'egg', amount: 1, eggType: 'free', label: '1 free egg' },
  { day: 5, type: 'coins', amount: 750, label: '750 coins' },
  { day: 6, type: 'gems', amount: 25, label: '25 gems' },
  { day: 7, type: 'egg', amount: 1, eggType: 'premium', label: '1 premium egg' },
];

export const REFERRAL_MILESTONES: ReferralMilestone[] = [
  {
    id: 'friend-1',
    requiredFriends: 1,
    title: 'First Friend',
    rewardLabel: '2 Premium Eggs',
    description: 'Your first invite pays out fast with two premium hatches.',
    icon: '✨',
    reward: { type: 'premiumEggs', amount: 2 },
  },
  {
    id: 'friend-3',
    requiredFriends: 3,
    title: 'Small Squad',
    rewardLabel: '200 Gems',
    description: 'Enough gems to buy more premium eggs.',
    icon: '💎',
    reward: { type: 'gems', amount: 200 },
  },
  {
    id: 'friend-5',
    requiredFriends: 5,
    title: 'Hype Team',
    rewardLabel: 'x2 Income 48h',
    description: 'Double passive income for two full days.',
    icon: '⚡',
    reward: { type: 'incomeBoost', durationMs: REFERRAL_BOOST_DURATION_MS },
  },
  {
    id: 'friend-10',
    requiredFriends: 10,
    title: 'Viral Nest',
    rewardLabel: 'Mythic Egg',
    description: 'Placeholder reward for a future special egg.',
    icon: '🌌',
    reward: { type: 'placeholder', label: 'Mythic Egg placeholder' },
  },
  {
    id: 'friend-25',
    requiredFriends: 25,
    title: 'Founder Circle',
    rewardLabel: 'Founder Badge',
    description: 'Placeholder badge for early viral players.',
    icon: '🏅',
    reward: { type: 'placeholder', label: 'Founder Badge placeholder' },
  },
];
