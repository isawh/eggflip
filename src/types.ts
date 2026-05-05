export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

export type Tier = 1 | 2 | 3 | 4 | 5;

export type EggType = 'free' | 'basic' | 'premium';

export type PrestigeUpgradeId = 'income' | 'slot' | 'cooldown' | 'dropChance';

export type PrestigeUpgrades = Record<PrestigeUpgradeId, number>;

export type IdleGeneratorId = 'basic' | 'advanced' | 'elite';

/** Placeholder Home loop slots (no economy logic yet). */
export type HomePlaceholderLoopId = 'quantum' | 'core' | 'prestige';

export type HomeLoopSlotId = IdleGeneratorId | HomePlaceholderLoopId;

export interface IdleGeneratorState {
  level: number;
  lastCollectedAt: number;
}

export type Screen =
  | 'home'
  | 'hatch'
  | 'collection'
  | 'upgrade'
  | 'shop'
  | 'more'
  | 'referral'
  | 'daily'
  | 'prestige';

export interface CreatureDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  emoji: string;
  imagePath?: string;
  baseIncomePerMinute: number;
  accent: string;
}

export interface OwnedCreature {
  uid: string;
  creatureId: string;
  level: number;
  hatchedAt: number;
}

export interface DailyReward {
  day: number;
  type: 'coins' | 'gems' | 'egg';
  amount: number;
  eggType?: EggType;
  label: string;
}

export interface DailyRewardState {
  claimedDays: number[];
  lastClaimDate: string | null;
  streakDay: number;
  lastLoginAt: number | null;
}

export type ReferralMilestoneId = 'friend-1' | 'friend-3' | 'friend-5' | 'friend-10' | 'friend-25';

export type ReferralMilestoneReward =
  | { type: 'premiumEggs'; amount: number }
  | { type: 'gems'; amount: number }
  | { type: 'incomeBoost'; durationMs: number }
  | { type: 'placeholder'; label: string };

export interface ReferralMilestone {
  id: ReferralMilestoneId;
  requiredFriends: number;
  title: string;
  rewardLabel: string;
  description: string;
  icon: string;
  reward: ReferralMilestoneReward;
}

export interface GameState {
  coins: number;
  gems: number;
  essence: number;
  totalCoinsEarned: number;
  prestigeCount: number;
  prestigeUpgrades: PrestigeUpgrades;
  premiumEggs: number;
  eggs: Record<EggType, number>;
  creatures: OwnedCreature[];
  selectedCreatureUid: string | null;
  mainLoopLastPayoutAt: number;
  lastIncomeAt: number;
  lastActiveAt: number;
  lastFreeEggAt: number;
  incomeBoostUntil: number | null;
  idleGenerators: Record<IdleGeneratorId, IdleGeneratorState>;
  playerTier: Tier;
  maxCreatureSlots: number;
  referralCode: string;
  referredByCode: string | null;
  invitedFriendsCount: number;
  claimedReferralMilestones: ReferralMilestoneId[];
  claimedInviteeReferralBonus: boolean;
  hatchesOpened: number;
  firstEggBoostUsed: boolean;
  invitePopupShown: boolean;
  dailyRewards: DailyRewardState;
  referralRewardClaimed: boolean;
  /** Wall time of last idle generator upgrade (for soft UI pressure). Main loop unaffected. */
  lastIdleGeneratorUpgradeAt: number;
}
