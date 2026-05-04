import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetImage } from './components/AssetImage';
import { BottomNav } from './components/BottomNav';
import { CreatureCard } from './components/CreatureCard';
import { RarityBadge } from './components/RarityBadge';
import { StatPill } from './components/StatPill';
import {
  DAILY_REWARDS,
  ECONOMY,
  EGG_LABELS,
  EGG_IMAGE_PATH,
  FREE_EGG_COOLDOWN_MS,
  GAME_TITLE,
  INCOME_BOOST_DURATION_MS,
  INVITE_POPUP_HATCH_THRESHOLD,
  RARITY_META,
  REFERRAL_MILESTONES,
} from './constants';
import {
  applyDailyReward,
  applyOfflineEarnings,
  applyPassiveIncome,
  canClaimDailyReward,
  createOwnedCreature,
  formatNumber,
  getCooldownLabel,
  getCreatureDefinition,
  getCreatureIncomePerMinute,
  getEggCount,
  getEggInventoryCount,
  getFreeEggReadyAt,
  getIncomeBoostRemainingMs,
  getNextDailyReward,
  getPreferredEggType,
  getTotalIncomePerMinute,
  getUpgradedIncomePreview,
  getUpgradeCost,
  registerLoginStreak,
  rollCreature,
} from './game';
import { PAID_PRODUCTS, PRODUCT_IDS, type MonetizationProduct, type ProductId } from './monetization';
import { purchaseProduct } from './paymentService';
import { getSoundEnabled, playSound, setSoundEnabled, type SoundName } from './soundService';
import { loadGameState, saveGameState } from './storage';
import {
  applyTelegramThemeColors,
  enableHaptics,
  expandApp,
  getStartParam,
  isTelegram,
  triggerHapticImpact,
  triggerHapticNotification,
} from './telegram';
import type { CreatureDefinition, EggType, GameState, OwnedCreature, ReferralMilestone, Screen } from './types';
import './styles.css';

interface HatchResult {
  creature: OwnedCreature;
  definition: CreatureDefinition;
  eggType: EggType;
  isDuplicate: boolean;
  firstEggBoostApplied: boolean;
}

interface SessionStart {
  state: GameState;
  offlineCoins: number;
  inviteeBonusApplied: boolean;
}

function App() {
  const [sessionStart] = useState<SessionStart>(() => {
    const current = Date.now();
    const referralBonus = applyInviteeReferralBonus(loadGameState());
    const streakState = registerLoginStreak(referralBonus.state, current);
    const offline = applyOfflineEarnings(streakState, current);
    return { state: offline.state, offlineCoins: offline.earnedCoins, inviteeBonusApplied: referralBonus.applied };
  });
  const [gameState, setGameState] = useState<GameState>(sessionStart.state);
  const [activeScreen, setActiveScreen] = useState<Screen>('home');
  const [hatchResult, setHatchResult] = useState<HatchResult | null>(null);
  const [isHatching, setIsHatching] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [floatingCoins, setFloatingCoins] = useState<string | null>(null);
  const [offlineCoins, setOfflineCoins] = useState(sessionStart.offlineCoins);
  const [upgradeBurst, setUpgradeBurst] = useState(false);
  const [purchasingProductId, setPurchasingProductId] = useState<ProductId | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(() => getSoundEnabled());
  const [telegramDetected, setTelegramDetected] = useState(() => isTelegram());
  const [invitePopupOpen, setInvitePopupOpen] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const coinTimerRef = useRef<number | null>(null);
  const upgradeTimerRef = useRef<number | null>(null);

  const showFeedback = (message: string) => {
    setFeedbackMessage(message);

    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimerRef.current = null;
    }, 2200);
  };

  const showErrorFeedback = (message: string) => {
    triggerHapticNotification('error');
    playSound('error');
    showFeedback(message);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundEnabledState(next);
  };

  const showFloatingCoins = (amount: number) => {
    if (amount <= 0) {
      return;
    }

    setFloatingCoins(`+${formatNumber(amount)}`);

    if (coinTimerRef.current) {
      window.clearTimeout(coinTimerRef.current);
    }

    coinTimerRef.current = window.setTimeout(() => {
      setFloatingCoins(null);
      coinTimerRef.current = null;
    }, 1250);
  };

  useEffect(() => {
    if (!isTelegram()) {
      return;
    }

    setTelegramDetected(true);
    expandApp();
    applyTelegramThemeColors();
    enableHaptics();
  }, []);

  useEffect(() => {
    if (!sessionStart.inviteeBonusApplied) {
      return;
    }

    playSound('reward_claim');
    triggerHapticNotification('success');
    showFeedback(
      `Invite bonus unlocked: ${ECONOMY.inviteeBonusPremiumEggs} Premium Egg + ${ECONOMY.inviteeBonusGems} gems`,
    );
  }, [sessionStart.inviteeBonusApplied]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      setGameState((state) => {
        const next = applyPassiveIncome(state, current);
        if (next.coins > state.coins) {
          showFloatingCoins(next.coins - state.coins);
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (coinTimerRef.current) {
        window.clearTimeout(coinTimerRef.current);
      }
      if (upgradeTimerRef.current) {
        window.clearTimeout(upgradeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    saveGameState(gameState);
  }, [gameState]);

  const selectedCreature = useMemo(
    () => gameState.creatures.find((creature) => creature.uid === gameState.selectedCreatureUid) ?? null,
    [gameState.creatures, gameState.selectedCreatureUid],
  );

  const totalIncome = getTotalIncomePerMinute(gameState, now);
  const totalEggs = getEggCount(gameState);
  const referralLink = getReferralLink(gameState.referralCode);
  const telegramShareUrl = getTelegramShareUrl(referralLink);

  const updateGameState = (updater: (state: GameState) => GameState) => {
    setGameState((state) => updater(applyPassiveIncome(state, Date.now())));
  };

  const hatchEgg = (eggType: EggType) => {
    if (isHatching || getEggInventoryCount(gameState, eggType) <= 0) {
      triggerHapticNotification('error');
      playSound('error');
      return;
    }

    const firstEggBoostApplied = !gameState.firstEggBoostUsed && gameState.hatchesOpened === 0;
    const shouldShowInvitePopup =
      !gameState.invitePopupShown && gameState.hatchesOpened + 1 >= INVITE_POPUP_HATCH_THRESHOLD;
    const definition = rollCreature(eggType, firstEggBoostApplied ? { minimumRarity: 'Rare' } : undefined);
    const isDuplicate = gameState.creatures.some((creature) => creature.creatureId === definition.id);
    const creature = createOwnedCreature(definition);

    setActiveScreen('hatch');
    setHatchResult(null);
    setIsHatching(true);
    triggerHapticImpact('light');
    playSound('hatch_click');
    playSound('egg_crack');

    window.setTimeout(() => {
      updateGameState((state) => {
        const premiumEggs = eggType === 'premium' ? Math.max(0, state.premiumEggs - 1) : state.premiumEggs;

        return {
          ...state,
          premiumEggs,
          eggs: {
            ...state.eggs,
            [eggType]: eggType === 'premium' ? premiumEggs : Math.max(0, state.eggs[eggType] - 1),
          },
          creatures: [creature, ...state.creatures],
          selectedCreatureUid: creature.uid,
          hatchesOpened: state.hatchesOpened + 1,
          firstEggBoostUsed: true,
          invitePopupShown: state.invitePopupShown || shouldShowInvitePopup,
          lastIncomeAt: state.creatures.length === 0 ? Date.now() : state.lastIncomeAt,
        };
      });
      setHatchResult({ creature, definition, eggType, isDuplicate, firstEggBoostApplied });
      setIsHatching(false);
      playSound(getDropSoundName(definition.rarity));
      triggerDropHaptic(definition.rarity);
      showFeedback(
        firstEggBoostApplied
          ? 'First Egg Boost: Rare+ unlocked'
          : isDuplicate
            ? 'Duplicate creature received'
            : 'New creature unlocked',
      );
      if (shouldShowInvitePopup) {
        window.setTimeout(() => setInvitePopupOpen(true), 650);
      }
    }, 950);
  };

  const hatchPreferredEgg = () => {
    const eggType = getPreferredEggType(gameState);
    if (!eggType) {
      setActiveScreen('shop');
      return;
    }

    hatchEgg(eggType);
  };

  const selectCreature = (creature: OwnedCreature, goToUpgrade = false) => {
    updateGameState((state) => ({
      ...state,
      selectedCreatureUid: creature.uid,
    }));

    if (goToUpgrade) {
      setActiveScreen('upgrade');
    }
  };

  const upgradeSelectedCreature = () => {
    if (!selectedCreature) {
      return;
    }

    const cost = getUpgradeCost(selectedCreature);
    if (gameState.coins < cost) {
      showErrorFeedback('Not enough coins');
      return;
    }

    updateGameState((state) => ({
      ...state,
      coins: state.coins - cost,
      creatures: state.creatures.map((creature) =>
        creature.uid === selectedCreature.uid ? { ...creature, level: creature.level + 1 } : creature,
      ),
    }));
    playSound('upgrade');
    showFeedback('Creature upgraded');
    setUpgradeBurst(true);
    if (upgradeTimerRef.current) {
      window.clearTimeout(upgradeTimerRef.current);
    }
    upgradeTimerRef.current = window.setTimeout(() => {
      setUpgradeBurst(false);
      upgradeTimerRef.current = null;
    }, 850);
  };

  const buyBasicEgg = () => {
    if (gameState.coins < ECONOMY.basicEggCoinCost) {
      showErrorFeedback('Not enough coins');
      return;
    }

    updateGameState((state) => ({
      ...state,
      coins: state.coins - ECONOMY.basicEggCoinCost,
      eggs: { ...state.eggs, basic: state.eggs.basic + 1 },
    }));
    playSound('purchase_success');
    triggerHapticNotification('success');
    showFeedback('Basic egg purchased');
  };

  const buyPremiumEgg = () => {
    if (gameState.gems < ECONOMY.premiumEggGemCost) {
      showErrorFeedback('Not enough gems');
      return;
    }

    updateGameState((state) => ({
      ...state,
      gems: state.gems - ECONOMY.premiumEggGemCost,
      premiumEggs: state.premiumEggs + 1,
      eggs: { ...state.eggs, premium: state.premiumEggs + 1 },
    }));
    playSound('purchase_success');
    triggerHapticNotification('success');
    showFeedback('Premium egg purchased');
  };

  const claimFreeEgg = () => {
    const readyAt = getFreeEggReadyAt(gameState);
    if (now < readyAt) {
      showErrorFeedback('Egg is cooling down');
      return;
    }

    updateGameState((state) => ({
      ...state,
      lastFreeEggAt: Date.now(),
      eggs: { ...state.eggs, free: state.eggs.free + 1 },
    }));
    playSound('reward_claim');
    showFeedback('Free egg claimed');
  };

  const claimDailyReward = () => {
    const reward = getNextDailyReward(gameState);
    if (!reward || !canClaimDailyReward(gameState)) {
      return;
    }

    updateGameState((state) => applyDailyReward(state, reward));
    playSound('reward_claim');
    showFeedback('Daily reward claimed');
    if (reward.type === 'coins') {
      showFloatingCoins(reward.amount);
    }
  };

  const simulateFriendJoined = () => {
    updateGameState((state) => ({
      ...state,
      invitedFriendsCount: state.invitedFriendsCount + 1,
    }));
    showFeedback('Friend joined simulated');
  };

  const claimReferralMilestone = (milestone: ReferralMilestone) => {
    if (gameState.claimedReferralMilestones.includes(milestone.id)) {
      return;
    }

    if (gameState.invitedFriendsCount < milestone.requiredFriends) {
      showErrorFeedback('Invite more friends');
      return;
    }

    updateGameState((state) => applyReferralMilestoneReward(state, milestone, Date.now()));
    playSound('reward_claim');
    showFeedback(`${milestone.rewardLabel} claimed`);
  };

  const copyReferralLink = async (referralLink: string) => {
    try {
      await navigator.clipboard.writeText(referralLink);
      showFeedback('Referral link copied');
    } catch {
      showErrorFeedback('Copy unavailable');
    }
  };

  const shareReferralLink = (telegramShareUrl: string) => {
    const shareWindow = window.open(telegramShareUrl, '_blank', 'noopener,noreferrer');
    if (!shareWindow) {
      showErrorFeedback('Share unavailable');
      return;
    }

    showFeedback('Telegram share opened');
  };

  const purchasePaidProduct = async (product: MonetizationProduct) => {
    if (purchasingProductId) {
      return;
    }

    setPurchasingProductId(product.id);

    try {
      const result = await purchaseProduct(product.id);

      if (!result.success) {
        showErrorFeedback('Purchase failed');
        return;
      }

      const current = Date.now();
      updateGameState((state) => applyProductEffect(state, product.id, current));
      playSound('purchase_success');
      triggerHapticNotification('success');
      showFeedback(`${product.title} unlocked`);

      if (product.id === PRODUCT_IDS.starterPack) {
        showFloatingCoins(ECONOMY.starterPackCoins);
      }
    } catch {
      showErrorFeedback('Purchase failed');
    } finally {
      setPurchasingProductId(null);
    }
  };

  return (
    <div className="app-shell">
      <main className="phone-frame">
        <header className="top-header">
          <div>
            <p className="eyebrow">Telegram Mini App</p>
            <h1>{GAME_TITLE}</h1>
            {telegramDetected && <span className="telegram-label">Running in Telegram</span>}
          </div>
          <div className="top-actions">
            <button
              className={`sound-toggle ${soundEnabled ? 'enabled' : ''}`}
              type="button"
              aria-label={soundEnabled ? 'Disable sound' : 'Enable sound'}
              aria-pressed={soundEnabled}
              onClick={toggleSound}
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
            <div className="egg-token" aria-label={`${totalEggs} eggs`}>
              🥚 {totalEggs}
            </div>
          </div>
        </header>

        <section className="stats-grid" aria-label="Player resources">
          <StatPill icon="🪙" label="Coins" value={formatNumber(gameState.coins)} />
          <StatPill icon="💎" label="Gems" value={formatNumber(gameState.gems)} />
          <StatPill icon="⚡" label="Income" value={`${formatNumber(totalIncome)}/min`} />
        </section>

        {feedbackMessage && <div className="feedback-toast">{feedbackMessage}</div>}
        {floatingCoins && <div className="floating-coins">{floatingCoins} coins</div>}

        <section className="screen-panel">
          {activeScreen === 'home' && (
            <HomeScreen
              gameState={gameState}
              totalIncome={totalIncome}
              now={now}
              onHatch={hatchPreferredEgg}
              onOpenShop={() => setActiveScreen('shop')}
              onClaimFreeEgg={claimFreeEgg}
              onBuyBasic={buyBasicEgg}
              onBuyPremium={buyPremiumEgg}
              onOpenDaily={() => setActiveScreen('daily')}
              onOpenReferral={() => setActiveScreen('referral')}
            />
          )}
          {activeScreen === 'hatch' && (
            <HatchScreen
              gameState={gameState}
              hatchResult={hatchResult}
              isHatching={isHatching}
              onHatch={hatchEgg}
              onCollection={() => setActiveScreen('collection')}
              onShop={() => setActiveScreen('shop')}
            />
          )}
          {activeScreen === 'collection' && (
            <CollectionScreen
              creatures={gameState.creatures}
              maxCreatureSlots={gameState.maxCreatureSlots}
              selectedUid={gameState.selectedCreatureUid}
              onSelect={selectCreature}
            />
          )}
          {activeScreen === 'upgrade' && (
            <UpgradeScreen
              creature={selectedCreature}
              coins={gameState.coins}
              allCreatures={gameState.creatures}
              upgradeBurst={upgradeBurst}
              onUpgrade={upgradeSelectedCreature}
              onSelect={(creature) => selectCreature(creature)}
            />
          )}
          {activeScreen === 'shop' && (
            <ShopScreen
              gameState={gameState}
              now={now}
              purchasingProductId={purchasingProductId}
              onClaimFreeEgg={claimFreeEgg}
              onBuyBasic={buyBasicEgg}
              onBuyPremium={buyPremiumEgg}
              onPurchaseProduct={purchasePaidProduct}
            />
          )}
          {activeScreen === 'referral' && (
            <ReferralScreen
              gameState={gameState}
              referralLink={referralLink}
              telegramShareUrl={telegramShareUrl}
              onClaimMilestone={claimReferralMilestone}
              onCopyLink={copyReferralLink}
              onShareLink={shareReferralLink}
              onSimulateFriend={simulateFriendJoined}
            />
          )}
          {activeScreen === 'daily' && (
            <DailyScreen gameState={gameState} onClaim={claimDailyReward} />
          )}
        </section>

        <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} />
      </main>
      {offlineCoins > 0 && (
        <div className="offline-backdrop" role="dialog" aria-modal="true" aria-labelledby="offline-title">
          <div className="offline-modal">
            <span aria-hidden="true">🪙</span>
            <h2 id="offline-title">Welcome back</h2>
            <p>You earned {formatNumber(offlineCoins)} coins while away</p>
            <button
              className="primary-action"
              onClick={() => {
                playSound('coin_collect');
                showFloatingCoins(offlineCoins);
                setOfflineCoins(0);
              }}
              type="button"
            >
              Collect
            </button>
          </div>
        </div>
      )}
      {invitePopupOpen && (
        <InvitePopup
          referralLink={referralLink}
          onClose={() => setInvitePopupOpen(false)}
          onCopy={() => copyReferralLink(referralLink)}
          onOpenReferral={() => {
            setInvitePopupOpen(false);
            setActiveScreen('referral');
          }}
          onShare={() => shareReferralLink(telegramShareUrl)}
        />
      )}
    </div>
  );
}

interface InviteeReferralBonusResult {
  state: GameState;
  applied: boolean;
}

const applyInviteeReferralBonus = (state: GameState): InviteeReferralBonusResult => {
  const referredByCode = getIncomingReferralCode(state.referralCode);

  if (
    !referredByCode ||
    state.claimedInviteeReferralBonus ||
    state.hatchesOpened > 0 ||
    state.creatures.length > 0
  ) {
    return { state, applied: false };
  }

  const premiumEggs = state.premiumEggs + ECONOMY.inviteeBonusPremiumEggs;

  return {
    state: {
      ...state,
      gems: state.gems + ECONOMY.inviteeBonusGems,
      premiumEggs,
      eggs: {
        ...state.eggs,
        premium: premiumEggs,
      },
      referredByCode,
      claimedInviteeReferralBonus: true,
    },
    applied: true,
  };
};

const getIncomingReferralCode = (ownReferralCode: string): string | null => {
  const candidates = [getStartParam(), getUrlParam('start'), getUrlParam('startapp'), getUrlParam('ref'), getUrlParam('tgWebAppStartParam')];
  const normalized = candidates.map(normalizeIncomingReferralCode).find((code): code is string => Boolean(code));

  if (!normalized || normalized === ownReferralCode) {
    return null;
  }

  return normalized;
};

const getUrlParam = (key: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const fromSearch = new URLSearchParams(window.location.search).get(key);
  if (fromSearch) {
    return fromSearch;
  }

  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get(key);
};

const normalizeIncomingReferralCode = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
  return normalized.length >= 6 ? normalized : null;
};

const getReferralLink = (referralCode: string): string =>
  `https://t.me/EggFlipBot/app?start=${encodeURIComponent(referralCode)}`;

const getTelegramShareUrl = (referralLink: string): string => {
  const text = 'Join me in EggFlip. You get a welcome bonus and a boosted first hatch.';
  return `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`;
};

interface InvitePopupProps {
  referralLink: string;
  onClose: () => void;
  onCopy: () => void;
  onOpenReferral: () => void;
  onShare: () => void;
}

function InvitePopup({ referralLink, onClose, onCopy, onOpenReferral, onShare }: InvitePopupProps) {
  return (
    <div className="invite-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="invite-popup-title">
      <div className="invite-popup-modal">
        <span className="invite-popup-emoji" aria-hidden="true">
          🎁
        </span>
        <h2 id="invite-popup-title">Invite friends -&gt; get premium eggs</h2>
        <p>
          Friends get {ECONOMY.inviteeBonusPremiumEggs} Premium Egg and {ECONOMY.inviteeBonusGems} gems on first open.
          You unlock bigger rewards as they join.
        </p>
        <div className="invite-benefits">
          <span>1 friend: 2 premium eggs</span>
          <span>3 friends: 200 gems</span>
          <span>5 friends: x2 income 48h</span>
        </div>
        <div className="fake-link">{referralLink}</div>
        <div className="share-actions">
          <button onClick={onCopy} type="button">
            Copy
          </button>
          <button onClick={onShare} type="button">
            Telegram
          </button>
        </div>
        <button className="primary-action invite-cta" onClick={onOpenReferral} type="button">
          Open Invite Rewards
        </button>
        <button className="secondary-action compact-action" onClick={onClose} type="button">
          Maybe later
        </button>
      </div>
    </div>
  );
}

const applyProductEffect = (state: GameState, productId: ProductId, now: number): GameState => {
  const addPremiumEggs = (count: number, sourceState = state): GameState => ({
    ...sourceState,
    premiumEggs: sourceState.premiumEggs + count,
    eggs: {
      ...sourceState.eggs,
      premium: sourceState.premiumEggs + count,
    },
  });

  switch (productId) {
    case PRODUCT_IDS.instantHatch:
      return {
        ...state,
        lastFreeEggAt: now - FREE_EGG_COOLDOWN_MS,
      };
    case PRODUCT_IDS.premiumEggPack3:
      return addPremiumEggs(3);
    case PRODUCT_IDS.premiumEggPack10:
      return addPremiumEggs(10);
    case PRODUCT_IDS.incomeBoost24h: {
      const boostBase = state.incomeBoostUntil && state.incomeBoostUntil > now ? state.incomeBoostUntil : now;
      return {
        ...state,
        incomeBoostUntil: boostBase + INCOME_BOOST_DURATION_MS,
        lastIncomeAt: now,
        lastActiveAt: now,
      };
    }
    case PRODUCT_IDS.extraCreatureSlot:
      return {
        ...state,
        maxCreatureSlots: state.maxCreatureSlots + 1,
      };
    case PRODUCT_IDS.starterPack: {
      const starterState: GameState = {
        ...state,
        coins: state.coins + ECONOMY.starterPackCoins,
        gems: state.gems + ECONOMY.starterPackGems,
      };
      return addPremiumEggs(ECONOMY.starterPackPremiumEggs, starterState);
    }
    default:
      return state;
  }
};

const getDropSoundName = (rarity: CreatureDefinition['rarity']): SoundName => {
  switch (rarity) {
    case 'Common':
      return 'common_drop';
    case 'Rare':
      return 'rare_drop';
    case 'Epic':
      return 'epic_drop';
    case 'Legendary':
      return 'legendary_drop';
    case 'Mythic':
      return 'mythic_drop';
    default:
      return 'common_drop';
  }
};

const triggerDropHaptic = (rarity: CreatureDefinition['rarity']) => {
  switch (rarity) {
    case 'Rare':
    case 'Epic':
    case 'Legendary':
      triggerHapticImpact('medium');
      break;
    case 'Mythic':
      triggerHapticImpact('heavy');
      break;
    default:
      break;
  }
};

const applyReferralMilestoneReward = (state: GameState, milestone: ReferralMilestone, now: number): GameState => {
  const claimedReferralMilestones = Array.from(new Set([...state.claimedReferralMilestones, milestone.id]));
  const withClaim: GameState = {
    ...state,
    claimedReferralMilestones,
  };

  switch (milestone.reward.type) {
    case 'premiumEggs':
      return {
        ...withClaim,
        premiumEggs: withClaim.premiumEggs + milestone.reward.amount,
        eggs: {
          ...withClaim.eggs,
          premium: withClaim.premiumEggs + milestone.reward.amount,
        },
      };
    case 'gems':
      return {
        ...withClaim,
        gems: withClaim.gems + milestone.reward.amount,
      };
    case 'incomeBoost': {
      const boostBase = withClaim.incomeBoostUntil && withClaim.incomeBoostUntil > now ? withClaim.incomeBoostUntil : now;
      return {
        ...withClaim,
        incomeBoostUntil: boostBase + milestone.reward.durationMs,
        lastIncomeAt: now,
        lastActiveAt: now,
      };
    }
    case 'placeholder':
      return withClaim;
    default:
      return withClaim;
  }
};

interface HomeScreenProps {
  gameState: GameState;
  totalIncome: number;
  now: number;
  onHatch: () => void;
  onOpenShop: () => void;
  onClaimFreeEgg: () => void;
  onBuyBasic: () => void;
  onBuyPremium: () => void;
  onOpenDaily: () => void;
  onOpenReferral: () => void;
}

function HomeScreen({
  gameState,
  totalIncome,
  now,
  onHatch,
  onOpenShop,
  onClaimFreeEgg,
  onBuyBasic,
  onBuyPremium,
  onOpenDaily,
  onOpenReferral,
}: HomeScreenProps) {
  const totalEggs = getEggCount(gameState);
  const freeReadyAt = getFreeEggReadyAt(gameState);
  const freeReady = now >= freeReadyAt;
  const freeCooldown = getCooldownLabel(freeReadyAt - now);
  const boostRemainingMs = getIncomeBoostRemainingMs(gameState, now);

  return (
    <div className="screen-content home-screen">
      <div className="home-hero">
        <div className="hero-copy">
          <span>Ready to flip?</span>
          <strong>{totalEggs > 0 ? `${totalEggs} eggs waiting` : 'Restock eggs'}</strong>
        </div>
        <div className="hero-egg" aria-hidden="true">
          <AssetImage alt="Egg" className="hero-egg-asset" fallback="🥚" src={EGG_IMAGE_PATH} />
        </div>
        <button className="hatch-action" onClick={onHatch} type="button">
          {totalEggs > 0 ? 'HATCH' : 'GET EGGS'}
        </button>
      </div>

      <div className="home-metrics">
        <div className="income-card premium-card">
          <span>Coins per minute</span>
          <strong>{formatNumber(totalIncome)}</strong>
        </div>
        <div className="streak-card premium-card">
          <span>Premium eggs</span>
          <strong>{gameState.premiumEggs}</strong>
        </div>
      </div>

      {!gameState.firstEggBoostUsed && (
        <div className="first-boost-card">
          <span>First Egg Boost</span>
          <strong>Guaranteed Rare+ on your first hatch</strong>
        </div>
      )}

      {boostRemainingMs > 0 && (
        <div className="boost-card">
          <span>⚡ x2 income active</span>
          <strong>{getCooldownLabel(boostRemainingMs)}</strong>
        </div>
      )}

      <div className="cooldown-card">
        <div>
          <span className="status-title">Free egg</span>
          <strong>{freeReady ? 'Ready now' : freeCooldown}</strong>
          <p>
            Free {gameState.eggs.free} · Basic {gameState.eggs.basic} · Premium {gameState.premiumEggs}
          </p>
        </div>
        <button onClick={onClaimFreeEgg} type="button">
          {freeReady ? 'Claim' : 'Wait'}
        </button>
      </div>

      <div className="quick-shop">
        <button className="quick-button coin" onClick={onBuyBasic} type="button">
          <span>🥚 Basic</span>
          <strong>{ECONOMY.basicEggCoinCost} coins</strong>
        </button>
        <button className="quick-button gem" onClick={onBuyPremium} type="button">
          <span>✨ Premium</span>
          <strong>{ECONOMY.premiumEggGemCost} gems</strong>
        </button>
        <button className="quick-button reward" onClick={onOpenDaily} type="button">
          <span>⭐ Daily</span>
          <strong>Claim</strong>
        </button>
        <button className="quick-button invite" onClick={onOpenReferral} type="button">
          <span>🎁 Invite</span>
          <strong>Bonus</strong>
        </button>
      </div>

      <button className="secondary-action shop-link" onClick={onOpenShop} type="button">
        Open full shop
      </button>
    </div>
  );
}

interface HatchScreenProps {
  gameState: GameState;
  hatchResult: HatchResult | null;
  isHatching: boolean;
  onHatch: (eggType: EggType) => void;
  onCollection: () => void;
  onShop: () => void;
}

function HatchScreen({ gameState, hatchResult, isHatching, onHatch, onCollection, onShop }: HatchScreenProps) {
  const rarityClass = hatchResult ? hatchResult.definition.rarity.toLowerCase() : '';
  const excitingDrop = hatchResult && hatchResult.definition.rarity !== 'Common';

  return (
    <div className="screen-content hatch-screen">
      <div className={`hatch-stage ${isHatching ? 'cracking' : ''} ${hatchResult ? `revealed ${rarityClass}` : ''}`}>
        <AssetImage
          alt={hatchResult ? hatchResult.definition.name : 'Egg'}
          className="egg-art"
          fallback={hatchResult ? hatchResult.definition.emoji : '🥚'}
          src={hatchResult ? hatchResult.definition.imagePath : EGG_IMAGE_PATH}
        />
      </div>

      {hatchResult ? (
        <div
          className={`result-card rarity-reveal ${rarityClass} ${excitingDrop ? 'exciting' : ''}`}
          style={{ '--result-glow': RARITY_META[hatchResult.definition.rarity].glow } as React.CSSProperties}
        >
          <span className="small-label">{excitingDrop ? `${hatchResult.definition.rarity} DROP` : `${EGG_LABELS[hatchResult.eggType]} opened`}</span>
          <h2>{hatchResult.definition.name}</h2>
          <RarityBadge rarity={hatchResult.definition.rarity} />
          <p>{getCreatureIncomePerMinute(hatchResult.creature)} coins/min at level 1</p>
          <strong className="result-note">
            {hatchResult.firstEggBoostApplied
              ? 'First Egg Boost guaranteed Rare+'
              : hatchResult.isDuplicate
                ? 'Duplicate creature received'
                : 'New creature unlocked'}
          </strong>
          <button className="secondary-action" onClick={onCollection} type="button">
            View Collection
          </button>
        </div>
      ) : (
        <div className="result-empty">
          <h2>{isHatching ? 'Cracking...' : 'Choose an egg'}</h2>
          <p>{isHatching ? 'A new creature is waking up.' : 'Free and basic eggs use the normal rarity odds.'}</p>
        </div>
      )}

      <div className="egg-actions">
        {(['free', 'basic', 'premium'] as EggType[]).map((eggType) => (
          <button
            className="egg-button"
            disabled={isHatching || getEggInventoryCount(gameState, eggType) <= 0}
            key={eggType}
            onClick={() => onHatch(eggType)}
            type="button"
          >
            <span>{EGG_LABELS[eggType]}</span>
            <strong>{getEggInventoryCount(gameState, eggType)}</strong>
          </button>
        ))}
      </div>

      <button className="secondary-action" onClick={onShop} type="button">
        Buy More Eggs
      </button>
    </div>
  );
}

interface CollectionScreenProps {
  creatures: OwnedCreature[];
  maxCreatureSlots: number;
  selectedUid: string | null;
  onSelect: (creature: OwnedCreature, goToUpgrade?: boolean) => void;
}

function CollectionScreen({ creatures, maxCreatureSlots, selectedUid, onSelect }: CollectionScreenProps) {
  const duplicateCounts = creatures.reduce<Record<string, number>>((counts, creature) => {
    counts[creature.creatureId] = (counts[creature.creatureId] ?? 0) + 1;
    return counts;
  }, {});

  if (creatures.length === 0) {
    return (
      <div className="screen-content empty-screen">
        <div className="empty-emoji">🥚</div>
        <h2>No creatures yet</h2>
        <p>Hatch your first egg to start earning passive coins.</p>
      </div>
    );
  }

  return (
    <div className="screen-content collection-screen">
      <div className="section-heading">
        <h2>Collection</h2>
        <span>{Math.min(creatures.length, maxCreatureSlots)}/{maxCreatureSlots} active</span>
      </div>
      <div className="collection-grid">
        {creatures.map((creature, index) => (
          <CreatureCard
            creature={creature}
            duplicateCount={duplicateCounts[creature.creatureId] ?? 1}
            isActive={index < maxCreatureSlots}
            key={creature.uid}
            onSelect={() => onSelect(creature, true)}
            selected={creature.uid === selectedUid}
          />
        ))}
      </div>
    </div>
  );
}

interface UpgradeScreenProps {
  creature: OwnedCreature | null;
  coins: number;
  allCreatures: OwnedCreature[];
  upgradeBurst: boolean;
  onUpgrade: () => void;
  onSelect: (creature: OwnedCreature) => void;
}

function UpgradeScreen({ creature, coins, allCreatures, upgradeBurst, onUpgrade, onSelect }: UpgradeScreenProps) {
  if (!creature) {
    return (
      <div className="screen-content empty-screen">
        <div className="empty-emoji">🧺</div>
        <h2>Select a creature</h2>
        <p>Pick a creature from your collection before upgrading.</p>
      </div>
    );
  }

  const definition = getCreatureDefinition(creature.creatureId);
  const currentIncome = getCreatureIncomePerMinute(creature);
  const previewIncome = getUpgradedIncomePreview(creature);
  const cost = getUpgradeCost(creature);
  const canUpgrade = coins >= cost;
  const missingCoins = Math.max(0, cost - coins);

  return (
    <div className={`screen-content upgrade-screen ${upgradeBurst ? 'reward-pop' : ''}`}>
      <div className="upgrade-feature" style={{ '--creature-accent': definition.accent } as React.CSSProperties}>
        <AssetImage
          alt={definition.name}
          className="upgrade-emoji"
          fallback={definition.emoji}
          src={definition.imagePath}
        />
        <div>
          <h2>{definition.name}</h2>
          <RarityBadge rarity={definition.rarity} />
        </div>
      </div>

      <div className="upgrade-cost-card">
        <span>Upgrade cost</span>
        <strong>🪙 {formatNumber(cost)}</strong>
        {!canUpgrade && <small>Need {formatNumber(missingCoins)} more coins</small>}
      </div>

      <div className="upgrade-stats">
        <div>
          <span>Level</span>
          <strong>{creature.level}</strong>
        </div>
        <div>
          <span>Now</span>
          <strong>{currentIncome}/min</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>{previewIncome}/min</strong>
        </div>
      </div>

      <button className="primary-action upgrade-action" disabled={!canUpgrade} onClick={onUpgrade} type="button">
        {canUpgrade ? 'POWER UP' : 'NOT ENOUGH COINS'}
      </button>

      <div className="mini-roster">
        {allCreatures.slice(0, 5).map((item) => {
          const itemDefinition = getCreatureDefinition(item.creatureId);
          return (
            <button
              className={item.uid === creature.uid ? 'mini-creature active' : 'mini-creature'}
              key={item.uid}
              onClick={() => onSelect(item)}
              type="button"
            >
              <span aria-hidden="true">{itemDefinition.emoji}</span>
              <span>Lv {item.level}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ShopScreenProps {
  gameState: GameState;
  now: number;
  purchasingProductId: ProductId | null;
  onClaimFreeEgg: () => void;
  onBuyBasic: () => void;
  onBuyPremium: () => void;
  onPurchaseProduct: (product: MonetizationProduct) => void;
}

function ShopScreen({
  gameState,
  now,
  purchasingProductId,
  onClaimFreeEgg,
  onBuyBasic,
  onBuyPremium,
  onPurchaseProduct,
}: ShopScreenProps) {
  const freeReadyAt = getFreeEggReadyAt(gameState);
  const freeReady = now >= freeReadyAt;
  const cooldown = getCooldownLabel(freeReadyAt - now);
  const boostRemainingMs = getIncomeBoostRemainingMs(gameState, now);

  return (
    <div className="screen-content shop-screen">
      <div className="section-heading">
        <h2>Shop</h2>
        <span>✨ {gameState.premiumEggs} premium</span>
      </div>

      {boostRemainingMs > 0 && (
        <div className="boost-card shop-boost">
          <span>⚡ x2 income active</span>
          <strong>{getCooldownLabel(boostRemainingMs)}</strong>
        </div>
      )}

      <div className="shop-section-label">Free</div>
      <ShopItem
        variant="free"
        icon="🥚"
        title="Free Egg"
        subtitle={freeReady ? 'Ready now' : `Ready in ${cooldown}`}
        action={freeReady ? 'Claim' : cooldown}
        onClick={onClaimFreeEgg}
      />
      <div className="shop-section-label">Coin and gem eggs</div>
      <ShopItem
        variant="coin"
        icon="🥚"
        title="Basic Egg"
        subtitle="Normal rarity odds"
        action={`${ECONOMY.basicEggCoinCost} coins`}
        onClick={onBuyBasic}
      />
      <ShopItem
        variant="gem"
        icon="✨"
        title="Premium Egg"
        subtitle="Better Epic, Legendary, and Mythic odds"
        action={`${ECONOMY.premiumEggGemCost} gems`}
        onClick={onBuyPremium}
      />
      <div className="shop-section-label">Premium products</div>
      <div className="paid-products">
        {PAID_PRODUCTS.map((product) => (
          <PaidProductCard
            isPurchasing={purchasingProductId === product.id}
            key={product.id}
            product={product}
            onPurchase={() => onPurchaseProduct(product)}
          />
        ))}
      </div>
    </div>
  );
}

interface ShopItemProps {
  variant: 'free' | 'coin' | 'gem' | 'premium' | 'boost';
  icon: string;
  title: string;
  subtitle: string;
  action: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}

function ShopItem({ variant, icon, title, subtitle, action, badge, disabled = false, onClick }: ShopItemProps) {
  return (
    <div className={`shop-item ${variant}`}>
      {badge && <span className="shop-badge">{badge}</span>}
      <span className="shop-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <button disabled={disabled} onClick={onClick} type="button">
        {action}
      </button>
    </div>
  );
}

interface PaidProductCardProps {
  product: MonetizationProduct;
  isPurchasing: boolean;
  onPurchase: () => void;
}

function PaidProductCard({ product, isPurchasing, onPurchase }: PaidProductCardProps) {
  return (
    <div className="paid-product-card">
      {product.tag && <span className="shop-badge">{product.tag}</span>}
      <span className="paid-icon" aria-hidden="true">
        {product.icon}
      </span>
      <div className="paid-copy">
        <strong>{product.title}</strong>
        <span>{product.description}</span>
      </div>
      <button disabled={isPurchasing} onClick={onPurchase} type="button">
        {isPurchasing ? 'Buying...' : `${product.price} ${product.currency}`}
      </button>
    </div>
  );
}

interface ReferralScreenProps {
  gameState: GameState;
  referralLink: string;
  telegramShareUrl: string;
  onClaimMilestone: (milestone: ReferralMilestone) => void;
  onCopyLink: (referralLink: string) => void;
  onShareLink: (telegramShareUrl: string) => void;
  onSimulateFriend: () => void;
}

function ReferralScreen({
  gameState,
  referralLink,
  telegramShareUrl,
  onClaimMilestone,
  onCopyLink,
  onShareLink,
  onSimulateFriend,
}: ReferralScreenProps) {
  const nextMilestone =
    REFERRAL_MILESTONES.find((milestone) => gameState.invitedFriendsCount < milestone.requiredFriends) ??
    REFERRAL_MILESTONES[REFERRAL_MILESTONES.length - 1];
  const previousMilestone = REFERRAL_MILESTONES.slice()
    .reverse()
    .find((milestone) => milestone.requiredFriends < nextMilestone.requiredFriends);
  const progressStart = previousMilestone?.requiredFriends ?? 0;
  const progressRange = Math.max(1, nextMilestone.requiredFriends - progressStart);
  const progressPercent = Math.min(
    100,
    Math.max(0, ((gameState.invitedFriendsCount - progressStart) / progressRange) * 100),
  );
  const claimableCount = REFERRAL_MILESTONES.filter(
    (milestone) =>
      gameState.invitedFriendsCount >= milestone.requiredFriends &&
      !gameState.claimedReferralMilestones.includes(milestone.id),
  ).length;

  return (
    <div className="screen-content referral-screen">
      <div className="invite-card">
        <span className="invite-emoji" aria-hidden="true">
          🎁
        </span>
        <h2>Invite Friends</h2>
        <p>Earn premium eggs, gems, boosts, and future founder rewards as friends join EggFlip.</p>
        <div className="invite-count">
          <strong>{gameState.invitedFriendsCount}</strong>
          <span>friends joined</span>
        </div>
      </div>

      <div className="two-sided-reward-card">
        <div>
          <span>You get</span>
          <strong>2 premium eggs at 1 friend</strong>
        </div>
        <div>
          <span>Friend gets</span>
          <strong>{ECONOMY.inviteeBonusPremiumEggs} Premium Egg + {ECONOMY.inviteeBonusGems} gems</strong>
        </div>
      </div>

      <div className="referral-progress-card">
        <div>
          <span>Next reward</span>
          <strong>{nextMilestone.rewardLabel}</strong>
          <p>
            {gameState.invitedFriendsCount}/{nextMilestone.requiredFriends} friends
          </p>
        </div>
        <div className="progress-track" aria-label="Referral milestone progress">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="share-panel">
        <span className="share-label">Your referral code</span>
        <strong>{gameState.referralCode}</strong>
        <div className="fake-link">{referralLink}</div>
        <div className="share-actions">
          <button onClick={() => onCopyLink(referralLink)} type="button">
            Copy
          </button>
          <button onClick={() => onShareLink(telegramShareUrl)} type="button">
            Telegram
          </button>
        </div>
      </div>

      <button className="primary-action invite-cta" onClick={onSimulateFriend} type="button">
        Simulate Friend Joined
      </button>

      <div className="section-heading">
        <h2>Milestones</h2>
        <span>{claimableCount} ready</span>
      </div>
      <div className="milestone-list">
        {REFERRAL_MILESTONES.map((milestone) => {
          const claimed = gameState.claimedReferralMilestones.includes(milestone.id);
          const ready = gameState.invitedFriendsCount >= milestone.requiredFriends;

          return (
            <div className={`milestone-card ${claimed ? 'claimed' : ''} ${ready && !claimed ? 'ready' : ''}`} key={milestone.id}>
              <span className="milestone-icon" aria-hidden="true">
                {milestone.icon}
              </span>
              <div className="milestone-copy">
                <span>{milestone.requiredFriends} friend{milestone.requiredFriends === 1 ? '' : 's'}</span>
                <strong>{milestone.rewardLabel}</strong>
                <p>{milestone.description}</p>
              </div>
              <button disabled={!ready || claimed} onClick={() => onClaimMilestone(milestone)} type="button">
                {claimed ? 'Claimed' : ready ? 'Claim' : 'Locked'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DailyScreenProps {
  gameState: GameState;
  onClaim: () => void;
}

function DailyScreen({ gameState, onClaim }: DailyScreenProps) {
  const nextReward = getNextDailyReward(gameState);
  const canClaim = canClaimDailyReward(gameState);

  return (
    <div className="screen-content daily-screen">
      <div className="section-heading">
        <h2>Daily Rewards</h2>
        <span>Streak {gameState.dailyRewards.streakDay}/7</span>
      </div>
      <div className="streak-card">
        <span>Current streak</span>
        <strong>Day {gameState.dailyRewards.streakDay}</strong>
      </div>
      <div className="reward-track">
        {DAILY_REWARDS.map((reward) => {
          const claimed = gameState.dailyRewards.claimedDays.includes(reward.day);
          const current = gameState.dailyRewards.streakDay === reward.day;

          return (
            <div className={`reward-card ${claimed ? 'claimed' : ''} ${current ? 'current' : ''}`} key={reward.day}>
              <span>Day {reward.day}</span>
              <strong>{reward.label}</strong>
              <small>{claimed ? 'Claimed' : current ? 'Today' : 'Locked'}</small>
            </div>
          );
        })}
      </div>
      <button className="primary-action" disabled={!canClaim} onClick={onClaim} type="button">
        {nextReward ? (canClaim ? `Claim ${nextReward.label}` : 'Come Back Tomorrow') : 'Track Complete'}
      </button>
    </div>
  );
}

export default App;
