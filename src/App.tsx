import {
  type CSSProperties,
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  IDLE_GENERATORS,
  IDLE_UPGRADE_PRESSURE_MS,
  INCOME_BOOST_DURATION_MS,
  INVITE_POPUP_HATCH_THRESHOLD,
  MAIN_IDLE_CYCLE_MS,
  MILLISECONDS_PER_MINUTE,
  PRESTIGE_UPGRADES,
  RARITY_META,
  REFERRAL_MILESTONES,
} from './constants';
import {
  applyDailyReward,
  applyGeneratorUpgrade,
  applyOfflineEarnings,
  applyPassiveIncome,
  applyPrestigeReset,
  applyPrestigeUpgrade,
  applyTierProgression,
  canAffordGeneratorUpgrade,
  canClaimDailyReward,
  createOwnedCreature,
  formatNumber,
  getActiveCreatures,
  getCooldownLabel,
  getCreatureDefinition,
  getBestIdleGeneratorUpgradeId,
  getCreatureIncomePerMinute,
  getEggInventoryCount,
  getFreeEggReadyAt,
  getGeneratorUpgradeCost,
  getIdleGeneratorCoinsPerCycle,
  getIdleGeneratorIncomePerMinute,
  getIdleLoopPhase,
  getIdleGeneratorLoopPhase,
  getMainIdleLoopPhase,
  getMainLoopCoinsPerCycle,
  getIncomeBoostRemainingMs,
  getNextDailyReward,
  getPrestigeEssenceGain,
  getPrestigeUpgradeCost,
  getPreferredEggType,
  getTierProgress,
  getTotalIncomePerMinute,
  getUpgradedIncomePreview,
  getUpgradeCost,
  isIdleGeneratorUnlocked,
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
import type {
  CreatureDefinition,
  EggType,
  GameState,
  IdleGeneratorId,
  OwnedCreature,
  PrestigeUpgradeId,
  Rarity,
  ReferralMilestone,
  Screen,
  Tier,
} from './types';
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

const IDLE_PAYOUT_FLASH_MS = 340;
/** Visual-only surge after purchasing a generator level (economy unchanged). */
const GENERATOR_UPGRADE_RUSH_MS = 1650;

/** Flash + one frame without CSS transition when `cycleStartAt` advances (real payout boundary). */
function useIdleCyclePayoutCue(
  cycleStartAt: number,
  active: boolean,
  onPaidRef?: MutableRefObject<(() => void) | undefined>,
): { payoutFlash: boolean; snapPhase: boolean } {
  const lastSeenStartRef = useRef(cycleStartAt);
  const [payoutFlash, setPayoutFlash] = useState(false);
  const [snapPhase, setSnapPhase] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      lastSeenStartRef.current = cycleStartAt;
      return;
    }

    const last = lastSeenStartRef.current;
    if (last !== cycleStartAt) {
      lastSeenStartRef.current = cycleStartAt;
      onPaidRef?.current?.();
      setSnapPhase(true);
      requestAnimationFrame(() => {
        setSnapPhase(false);
      });
      setPayoutFlash(true);
      const timeoutId = window.setTimeout(() => setPayoutFlash(false), IDLE_PAYOUT_FLASH_MS);
      return () => window.clearTimeout(timeoutId);
    }
  }, [cycleStartAt, active]);

  return { payoutFlash, snapPhase };
}

/**
 * Detects idle generator payouts when `lastCollectedAt` jumps forward — without changing simulation.
 * Snap phase must be synchronous on the payout render (compare before layout ref sync), or the progress
 * bar would briefly transition backwards from ~100% to ~0%.
 */
function useIdleGeneratorCyclePayoutCue(
  cycleStartAt: number,
  cycleDurationMs: number,
  coinsPerCycle: number,
  active: boolean,
): { payoutFlash: boolean; snapPhase: boolean; payoutCoinLabel: string | null } {
  const anchorRef = useRef(cycleStartAt);
  const [payoutFlash, setPayoutFlash] = useState(false);
  const [payoutCoinLabel, setPayoutCoinLabel] = useState<string | null>(null);

  const snapPhase =
    active &&
    cycleStartAt !== anchorRef.current &&
    cycleStartAt > anchorRef.current;

  useLayoutEffect(() => {
    if (!active) {
      anchorRef.current = cycleStartAt;
      setPayoutFlash(false);
      setPayoutCoinLabel(null);
      return;
    }

    const prevStart = anchorRef.current;
    if (cycleStartAt <= prevStart || cycleStartAt === prevStart) {
      anchorRef.current = cycleStartAt;
      return undefined;
    }

    const advance = cycleStartAt - prevStart;
    const ticks = Math.max(1, Math.floor(advance / cycleDurationMs));
    const total = Math.round(ticks * coinsPerCycle);
    const label = total > 0 ? `+${formatNumber(total)}` : '+0';

    anchorRef.current = cycleStartAt;
    setPayoutFlash(true);
    setPayoutCoinLabel(label);
    const timeoutId = window.setTimeout(() => {
      setPayoutFlash(false);
      setPayoutCoinLabel(null);
    }, IDLE_PAYOUT_FLASH_MS);

    return () => window.clearTimeout(timeoutId);
  }, [cycleStartAt, cycleDurationMs, coinsPerCycle, active]);

  return { payoutFlash, snapPhase, payoutCoinLabel };
}

interface SyncedLinearCycleBarProps {
  cycleStartAt: number;
  cycleDurationMs: number;
  now: number;
  active: boolean;
  ariaLabel: string;
  payoutFlash: boolean;
  snapPhase: boolean;
  upgradeRush: boolean;
}

function SyncedLinearCycleBar({
  cycleStartAt,
  cycleDurationMs,
  now,
  active,
  ariaLabel,
  payoutFlash,
  snapPhase,
  upgradeRush,
}: SyncedLinearCycleBarProps) {
  const phase = active ? getIdleLoopPhase(now, cycleStartAt, cycleDurationMs) : null;
  const progressPercent = phase?.progressPercent ?? 0;
  const fillClass = active
    ? snapPhase
      ? 'generator-loop-fill--instant'
      : 'generator-loop-fill--smooth'
    : 'generator-loop-fill--instant';

  return (
    <div
      className={`generator-loop-track${snapPhase || payoutFlash ? ' just-paid' : ''}${upgradeRush ? ' generator-loop-track--upgrade-rush' : ''}`}
      aria-label={ariaLabel}
    >
      <span
        className={`generator-loop-fill ${fillClass}${upgradeRush ? ' generator-loop-fill--rush-vis' : ''}`}
        style={{ width: `${progressPercent}%` }}
      />
    </div>
  );
}

function App() {
  /** Legacy creature grid on Generators tab starts collapsed unless opened from More → Creature vault. */
  const [generatorsVaultOpen, setGeneratorsVaultOpen] = useState(false);

  const [sessionStart] = useState<SessionStart>(() => {
    const current = Date.now();
    const referralBonus = applyInviteeReferralBonus(loadGameState());
    const progressionState = applyTierProgression(referralBonus.state);
    const streakState = registerLoginStreak(progressionState, current);
    const offline = applyOfflineEarnings(streakState, current);
    return { state: applyTierProgression(offline.state), offlineCoins: offline.earnedCoins, inviteeBonusApplied: referralBonus.applied };
  });
  const [gameState, setGameState] = useState<GameState>(sessionStart.state);
  const [activeScreen, setActiveScreen] = useState<Screen>('home');
  const [hatchResult, setHatchResult] = useState<HatchResult | null>(null);
  const [isHatching, setIsHatching] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [offlineCoins, setOfflineCoins] = useState(sessionStart.offlineCoins);
  const [upgradeBurst, setUpgradeBurst] = useState(false);
  const [purchasingProductId, setPurchasingProductId] = useState<ProductId | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(() => getSoundEnabled());
  const [telegramDetected, setTelegramDetected] = useState(() => isTelegram());
  const [invitePopupOpen, setInvitePopupOpen] = useState(false);
  const [phoneFrameIdlePulse, setPhoneFrameIdlePulse] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const upgradeTimerRef = useRef<number | null>(null);
  const mainLoopPaidRef = useRef<(() => void) | undefined>(undefined);

  const pulsePhoneFrameIdle = useCallback(() => {
    setPhoneFrameIdlePulse(true);
  }, []);

  useEffect(() => {
    if (!phoneFrameIdlePulse) {
      return;
    }
    const tid = window.setTimeout(() => setPhoneFrameIdlePulse(false), 500);
    return () => window.clearTimeout(tid);
  }, [phoneFrameIdlePulse]);

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

  /** Wall clock sampled here drives both progress visuals and payouts (same `t` ⇒ no phase/coin mismatch). */
  const UI_TICK_MS = 250;

  useEffect(() => {
    const tick = (): void => {
      const nextNow = Date.now();
      setNow(nextNow);
      setGameState((state) => applyPassiveIncome(state, nextNow));
    };

    tick();
    const timer = window.setInterval(tick, UI_TICK_MS);

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const nextNow = Date.now();
      setNow(nextNow);
      setGameState((state) => applyPassiveIncome(state, nextNow));
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (upgradeTimerRef.current) {
        window.clearTimeout(upgradeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const delayed = window.setTimeout(() => {
      saveGameState(gameState);
    }, 600);

    return () => window.clearTimeout(delayed);
  }, [gameState]);

  const selectedCreature = useMemo(
    () => gameState.creatures.find((creature) => creature.uid === gameState.selectedCreatureUid) ?? null,
    [gameState.creatures, gameState.selectedCreatureUid],
  );

  const totalIncome = getTotalIncomePerMinute(gameState, now);
  const referralLink = getReferralLink(gameState.referralCode);
  const telegramShareUrl = getTelegramShareUrl(referralLink);

  const navigateFromBottomNav = (screen: Screen) => {
    if (screen === 'collection') {
      setGeneratorsVaultOpen(false);
    }
    setActiveScreen(screen);
  };

  const updateGameState = (updater: (state: GameState) => GameState) => {
    setGameState((state) => applyTierProgression(updater(applyPassiveIncome(state, Date.now()))));
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
    const definition = rollCreature(
      eggType,
      firstEggBoostApplied
        ? { minimumRarity: 'Rare', dropBonusLevel: gameState.prestigeUpgrades.dropChance }
        : { maxTier: gameState.playerTier, dropBonusLevel: gameState.prestigeUpgrades.dropChance },
    );
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
    } catch {
      showErrorFeedback('Purchase failed');
    } finally {
      setPurchasingProductId(null);
    }
  };

  const buyPrestigeUpgrade = (upgradeId: PrestigeUpgradeId) => {
    const cost = getPrestigeUpgradeCost(upgradeId, gameState.prestigeUpgrades[upgradeId]);
    if (gameState.essence < cost) {
      showErrorFeedback('Not enough Essence');
      return;
    }

    updateGameState((state) => applyPrestigeUpgrade(state, upgradeId));
    playSound('upgrade');
    showFeedback('Permanent upgrade unlocked');
  };

  const prestigeReset = () => {
    const gainedEssence = getPrestigeEssenceGain(gameState);
    if (gainedEssence <= 0) {
      showErrorFeedback('Earn more coins first');
      return;
    }

    updateGameState((state) => applyPrestigeReset(state, Date.now()));
    playSound('reward_claim');
    triggerHapticNotification('success');
    showFeedback(`Prestige reset: +${gainedEssence} Essence`);
    setActiveScreen('home');
  };

  const upgradeIdleGenerator = (generatorId: IdleGeneratorId) => {
    if (!canAffordGeneratorUpgrade(gameState, generatorId)) {
      triggerHapticNotification('error');
      playSound('error');
      showErrorFeedback('Not enough coins');
      return;
    }

    updateGameState((state) => applyGeneratorUpgrade(state, generatorId, Date.now()));
    triggerHapticNotification('success');
    playSound('upgrade');
    showFeedback(`${IDLE_GENERATORS[generatorId].title} upgraded`);
  };

  mainLoopPaidRef.current = activeScreen === 'home' ? pulsePhoneFrameIdle : undefined;

  return (
    <div className="app-shell">
      <main
        className={['phone-frame', phoneFrameIdlePulse ? 'phone-frame--idle-payout-lift' : ''].filter(Boolean).join(' ')}
      >
        <header className="top-header">
          <div>
            <h1>{GAME_TITLE}</h1>
            {telegramDetected && <span className="telegram-label">Running in Telegram</span>}
          </div>
        </header>

        {feedbackMessage && <div className="feedback-toast">{feedbackMessage}</div>}

        <section className="screen-panel">
          {activeScreen === 'home' && (
            <HomeScreen
              gameState={gameState}
              totalIncome={totalIncome}
              now={now}
              mainLoopPaidRef={mainLoopPaidRef}
              onUpgradeGenerator={upgradeIdleGenerator}
              onOpenPrestige={() => setActiveScreen('prestige')}
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
              gameState={gameState}
              maxCreatureSlots={gameState.maxCreatureSlots}
              now={now}
              onSelect={selectCreature}
              onVaultOpenChange={setGeneratorsVaultOpen}
              selectedUid={gameState.selectedCreatureUid}
              vaultOpen={generatorsVaultOpen}
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
          {activeScreen === 'more' && (
            <MoreScreen
              onNavigate={setActiveScreen}
              onOpenGeneratorsVault={() => {
                setGeneratorsVaultOpen(true);
                setActiveScreen('collection');
              }}
              onOpenHatch={() => setActiveScreen('hatch')}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
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
          {activeScreen === 'prestige' && (
            <PrestigeScreen
              gameState={gameState}
              onBuyUpgrade={buyPrestigeUpgrade}
              onReset={prestigeReset}
            />
          )}
        </section>

        <BottomNav activeScreen={activeScreen} onNavigate={navigateFromBottomNav} />
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
          onCopy={() => copyReferralLink(referralLink)}
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
  const text = `Play ${GAME_TITLE} — idle loops & rewards!\n${referralLink}`;
  return `https://t.me/share/url?text=${encodeURIComponent(text)}`;
};

interface InvitePopupProps {
  onCopy: () => void;
  onShare: () => void;
}

function InvitePopup({ onCopy, onShare }: InvitePopupProps) {
  return (
    <div className="invite-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="invite-popup-title">
      <div className="invite-popup-modal">
        <h2 id="invite-popup-title">Invite friends 🎁</h2>
        <p>Extra gems, boosts, and rewards</p>
        <div className="invite-benefits">
          <span>1 friend → starter bonus</span>
          <span>3 friends → 200 gems</span>
          <span>5 friends → x2 income</span>
        </div>
        <button className="primary-action invite-popup-primary" onClick={onShare} type="button">
          Invite
        </button>
        <button className="secondary-action invite-popup-secondary" onClick={onCopy} type="button">
          Copy link
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
        eggs: {
          ...state.eggs,
          basic: state.eggs.basic + 5,
        },
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
  mainLoopPaidRef: MutableRefObject<(() => void) | undefined>;
  onUpgradeGenerator: (id: IdleGeneratorId) => void;
  onOpenPrestige: () => void;
}

const IDLE_GENERATOR_ORDER: IdleGeneratorId[] = ['basic', 'advanced', 'elite'];

function HomeScreen({
  gameState,
  totalIncome,
  now,
  mainLoopPaidRef,
  onUpgradeGenerator,
  onOpenPrestige,
}: HomeScreenProps) {
  const tierProgress = getTierProgress(gameState);
  const essenceGain = getPrestigeEssenceGain(gameState);
  const essenceLoopProgress = getEssenceLoopProgress(gameState, essenceGain);
  const showEssenceAccess = gameState.essence > 0 || gameState.prestigeCount > 0 || essenceGain > 0;
  const mainPayout = getMainLoopCoinsPerCycle(gameState, now);
  const bestUpgradeId = useMemo(
    () => getBestIdleGeneratorUpgradeId(gameState, now),
    [
      now,
      gameState.idleGenerators.basic.level,
      gameState.idleGenerators.advanced.level,
      gameState.idleGenerators.elite.level,
      gameState.playerTier,
      gameState.prestigeUpgrades.income,
      gameState.incomeBoostUntil,
      gameState.lastIdleGeneratorUpgradeAt,
    ],
  );

  return (
    <div className="screen-content home-screen">
      <section className="stats-grid home-stats" aria-label="Player resources">
        <StatPill icon="🪙" label="Coins" value={formatNumber(gameState.coins)} />
        <StatPill icon="💎" label="Gems" value={formatNumber(gameState.gems)} />
        <StatPill icon="⚡" label="Income" value={`${formatNumber(totalIncome)}/m`} />
        <StatPill icon="📈" label="Tier" value={`${gameState.playerTier}`} />
      </section>

      <MainIncomeLoop gameState={gameState} mainLoopPaidRef={mainLoopPaidRef} now={now} mainPayout={mainPayout} />

      <div className="generator-loop-grid" aria-label="Generators">
        {IDLE_GENERATOR_ORDER.map((id) => (
          <GeneratorLoopCard
            bestUpgradeId={bestUpgradeId}
            gameState={gameState}
            generatorId={id}
            key={id}
            now={now}
            onUpgrade={() => onUpgradeGenerator(id)}
          />
        ))}
      </div>

      <div className="progress-goal-grid" aria-label="Long-term progress">
        <ProgressLoop
          label="Tier"
          percent={tierProgress.progressPercent}
          status={`${tierProgress.currentLabel} · ${getTierLoopStatus(tierProgress.progressPercent, tierProgress.nextTier)}`}
          variant="tier"
        />
        <ProgressLoop
          label="Essence"
          percent={essenceLoopProgress.percent}
          status={essenceLoopProgress.status}
          variant="essence"
        />
      </div>

      {showEssenceAccess && (
        <button className="essence-access compact" onClick={onOpenPrestige} type="button">
          <span>✦ Essence</span>
          <strong>{formatNumber(gameState.essence)}</strong>
          <small>{essenceGain > 0 ? `+${formatNumber(essenceGain)} on reset` : `${gameState.prestigeCount} resets`}</small>
        </button>
      )}
    </div>
  );
}

interface MainIncomeLoopProps {
  gameState: GameState;
  now: number;
  mainPayout: number;
  mainLoopPaidRef: MutableRefObject<(() => void) | undefined>;
}

function MainIncomeLoop({ gameState, now, mainPayout, mainLoopPaidRef }: MainIncomeLoopProps) {
  const cycleStart = gameState.mainLoopLastPayoutAt;
  const phase = getMainIdleLoopPhase(gameState, now);
  const cycleProgress = phase.progressPercent;
  const { payoutFlash, snapPhase } = useIdleCyclePayoutCue(cycleStart, true, mainLoopPaidRef);
  const isCompleting = cycleProgress > 84;
  const cycleStyle = {
    '--cycle-progress': `${cycleProgress * 3.6}deg`,
  } as CSSProperties;

  return (
    <div
      className={[
        'income-cycle-card',
        payoutFlash ? 'just-paid' : '',
        isCompleting ? 'is-completing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Main payout loop"
    >
      <div
        className={`income-cycle-ring${snapPhase ? ' income-cycle-ring--phase-snap' : ''}${payoutFlash ? ' income-cycle-ring--idle-pay-pulse' : ''}`}
        style={cycleStyle}
      >
        <div className="income-cycle-core">
          <span>Next</span>
          <strong>+{formatNumber(mainPayout)}</strong>
          <small>coins</small>
        </div>
      </div>
      <div className="income-cycle-meta">
        <span>Main loop</span>
        <strong>{phase.secRemaining}s</strong>
        <small>Cycle: wall time − start every {MAIN_IDLE_CYCLE_MS / 1000}s</small>
      </div>
    </div>
  );
}

interface GeneratorLoopCardProps {
  gameState: GameState;
  generatorId: IdleGeneratorId;
  now: number;
  bestUpgradeId: IdleGeneratorId | null;
  onUpgrade: () => void;
}

function GeneratorLoopCard({ gameState, generatorId, now, bestUpgradeId, onUpgrade }: GeneratorLoopCardProps) {
  const cfg = IDLE_GENERATORS[generatorId];
  const unlocked = isIdleGeneratorUnlocked(gameState, generatorId);
  const gen = gameState.idleGenerators[generatorId];
  const prevGenLevelRef = useRef(gen.level);
  const [upgradeRushUntil, setUpgradeRushUntil] = useState(0);

  useEffect(() => {
    const prev = prevGenLevelRef.current;
    if (!unlocked) {
      prevGenLevelRef.current = gen.level;
      return;
    }
    if (gen.level > prev) {
      setUpgradeRushUntil(Date.now() + GENERATOR_UPGRADE_RUSH_MS);
    }
    prevGenLevelRef.current = gen.level;
  }, [gen.level, unlocked]);

  const upgradeRushActive = unlocked && upgradeRushUntil > now;
  const phaseDetail = unlocked ? getIdleGeneratorLoopPhase(gameState, generatorId, now) : null;
  const incomePerCycle = unlocked ? getIdleGeneratorCoinsPerCycle(gameState, generatorId, now) : 0;
  const cyclesPerMinute = MILLISECONDS_PER_MINUTE / cfg.cycleMs;
  const totalIncomePerMinute = unlocked ? getIdleGeneratorIncomePerMinute(gameState, generatorId, now) : 0;
  const { payoutFlash, snapPhase, payoutCoinLabel } = useIdleGeneratorCyclePayoutCue(
    gen.lastCollectedAt,
    cfg.cycleMs,
    incomePerCycle,
    unlocked,
  );
  const cost = getGeneratorUpgradeCost(gameState, generatorId);
  const canBuy = canAffordGeneratorUpgrade(gameState, generatorId);
  const isBest = unlocked && bestUpgradeId === generatorId;
  const upgradePressure =
    unlocked && canBuy && now - gameState.lastIdleGeneratorUpgradeAt >= IDLE_UPGRADE_PRESSURE_MS;

  const upgradeBtnClass = [
    'generator-upgrade-btn',
    unlocked && canBuy ? 'can-afford' : '',
    upgradePressure ? 'pressure-pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={[
        'generator-loop-card',
        generatorId,
        isBest ? 'is-best-upgrade' : '',
        upgradeRushActive ? 'generator-loop-card--upgrade-rush' : '',
        snapPhase || payoutFlash ? 'generator-payout-flash' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="generator-loop-header">
        <span className="generator-loop-title">
          {cfg.title}
          {isBest && (
            <span className="generator-best-badge" title="Highest ROI among generators">
              Best
            </span>
          )}
          {payoutCoinLabel && (
            <span aria-live="polite" className="generator-loop-payout-chip">
              {payoutCoinLabel}
            </span>
          )}
        </span>
        <strong>Lv {gen.level}</strong>
      </div>
      <SyncedLinearCycleBar
        active={unlocked}
        ariaLabel={`${cfg.title} payout timer`}
        cycleDurationMs={cfg.cycleMs}
        cycleStartAt={gen.lastCollectedAt}
        now={now}
        payoutFlash={payoutFlash}
        snapPhase={snapPhase}
        upgradeRush={upgradeRushActive}
      />
      <div className="generator-loop-metrics" aria-label="Generator yield">
        {unlocked ? (
          <>
            <span>Coins/cycle: +{formatNumber(incomePerCycle)}</span>
            <span>
              Cycles/min:{' '}
              {cyclesPerMinute >= 10 ? cyclesPerMinute.toFixed(1) : cyclesPerMinute.toFixed(2)}
            </span>
            <span>Total income: +{formatNumber(totalIncomePerMinute)}/m</span>
          </>
        ) : (
          <span className="generator-loop-metrics-locked">Tier {cfg.unlockTier} to unlock</span>
        )}
      </div>
      <div className="generator-loop-footer">
        <span>{unlocked ? 'Next payout' : `Tier ${cfg.unlockTier}`}</span>
        <strong>
          {unlocked && phaseDetail ? `${phaseDetail.secRemaining}s` : 'Locked'}
        </strong>
      </div>
      <button className={upgradeBtnClass} disabled={!unlocked || !canBuy} onClick={onUpgrade} type="button">
        {unlocked ? `Upgrade ${formatNumber(cost)}` : 'Locked'}
      </button>
    </div>
  );
}

interface LoopProgress {
  percent: number;
  status: string;
}

interface ProgressLoopProps extends LoopProgress {
  label: string;
  variant: 'egg' | 'tier' | 'income' | 'essence';
}

function ProgressLoop({ label, percent, status, variant }: ProgressLoopProps) {
  const normalizedPercent = clampProgressPercent(percent);
  const previousPercentRef = useRef(normalizedPercent);
  const growTimerRef = useRef<number | null>(null);
  const [isGrowing, setIsGrowing] = useState(false);
  const segments = Array.from({ length: 8 }, (_, index) => index);
  const activeSegments = Math.ceil((normalizedPercent / 100) * segments.length);
  const isComplete = normalizedPercent >= 100;
  const isHot = normalizedPercent > 80 && !isComplete;
  const statusText = isComplete && !status.endsWith('!') ? `${status}!` : status;

  useEffect(() => {
    if (normalizedPercent > previousPercentRef.current) {
      setIsGrowing(true);
      if (growTimerRef.current) {
        window.clearTimeout(growTimerRef.current);
      }
      growTimerRef.current = window.setTimeout(() => {
        setIsGrowing(false);
        growTimerRef.current = null;
      }, 520);
    }

    previousPercentRef.current = normalizedPercent;

    return () => {
      if (growTimerRef.current) {
        window.clearTimeout(growTimerRef.current);
        growTimerRef.current = null;
      }
    };
  }, [normalizedPercent]);

  return (
    <div className={`loop-progress-row ${variant} ${isHot ? 'is-hot' : ''} ${isComplete ? 'complete' : ''} ${isGrowing ? 'is-growing' : ''}`}>
      <div className="loop-progress-header">
        <span className="loop-progress-name">{label}</span>
        <strong className="loop-progress-status">
          <span>{Math.round(normalizedPercent)}%</span>
          {statusText}
        </strong>
      </div>
      {variant === 'income' ? (
        <div className="segmented-progress-track" aria-label={label}>
          {segments.map((segment) => (
            <span className={segment < activeSegments ? 'filled' : ''} key={segment} />
          ))}
        </div>
      ) : (
        <div className="loop-progress-track" aria-label={label}>
          <span style={{ width: `${normalizedPercent}%` }} />
        </div>
      )}
    </div>
  );
}

const getTierLoopStatus = (percent: number, nextTier: Tier | null): string => {
  if (!nextTier) {
    return 'Ready!';
  }

  if (percent >= 90) {
    return 'Almost ready';
  }

  return `Next Tier ${nextTier}`;
};

const getEssenceLoopProgress = (gameState: GameState, essenceGain: number): LoopProgress => {
  const nextGain = essenceGain + 1;
  const currentBracket = Math.pow(essenceGain, 2) * ECONOMY.prestigeEssenceDivisor;
  const nextBracket = Math.pow(nextGain, 2) * ECONOMY.prestigeEssenceDivisor;
  const range = Math.max(1, nextBracket - currentBracket);
  const coinsThisRun = gameState.totalCoinsEarned;

  return {
    percent: ((coinsThisRun - currentBracket) / range) * 100,
    status:
      essenceGain > 0
        ? `Next prestige +1 at ${formatNumber(nextBracket)} coins (this run)`
        : `First essence at ${formatNumber(nextBracket)} coins this run`,
  };
};

const clampProgressPercent = (value: number): number => Math.min(100, Math.max(0, value));

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
          <p>{isHatching ? 'A new creature is waking up.' : `Drops are capped at Tier ${gameState.playerTier}, except your first boost.`}</p>
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
        Buy supplies
      </button>
    </div>
  );
}

interface CollectionScreenProps {
  gameState: GameState;
  now: number;
  vaultOpen: boolean;
  onVaultOpenChange: (open: boolean) => void;
  creatures: OwnedCreature[];
  maxCreatureSlots: number;
  selectedUid: string | null;
  onSelect: (creature: OwnedCreature, goToUpgrade?: boolean) => void;
}

function CollectionScreen({
  gameState,
  now,
  vaultOpen,
  onVaultOpenChange,
  creatures,
  maxCreatureSlots,
  selectedUid,
  onSelect,
}: CollectionScreenProps) {
  const groupedCreatures = getCreatureCollectionGroups(creatures, maxCreatureSlots);
  const activeCopies = Math.min(creatures.length, maxCreatureSlots);

  return (
    <div className="screen-content collection-screen generators-screen">
      <div className="section-heading">
        <h2>Generators</h2>
        <span>Tier {gameState.playerTier} · manage upgrades on Home</span>
      </div>
      <p className="generators-lede">Each loop pays on a fixed timer. Higher Tier unlocks stronger generator layers.</p>

      <div className="generator-status-panel" aria-label="Generator status">
        {IDLE_GENERATOR_ORDER.map((id) => {
          const cfg = IDLE_GENERATORS[id];
          const unlocked = isIdleGeneratorUnlocked(gameState, id);
          const level = gameState.idleGenerators[id].level;
          const phase = getIdleGeneratorLoopPhase(gameState, id, now);
          const perCycle = unlocked ? getIdleGeneratorCoinsPerCycle(gameState, id, now) : 0;

          return (
            <div className={`generator-status-row ${unlocked ? 'unlocked' : 'locked'}`} key={id}>
              <div className="generator-status-title">
                <strong>{cfg.title}</strong>
                <span>Lv {level}</span>
              </div>
              <div className="generator-status-detail">
                {unlocked && phase
                  ? `+${formatNumber(perCycle)} / ${cfg.cycleMs / 1000}s · next in ${phase.secRemaining}s`
                  : `Unlock at Tier ${cfg.unlockTier}`}
              </div>
            </div>
          );
        })}
      </div>

      <button
        className="vault-toggle-btn"
        onClick={() => onVaultOpenChange(!vaultOpen)}
        type="button"
      >
        {vaultOpen ? 'Hide creature vault' : 'Show creature vault'}
        {!vaultOpen && creatures.length > 0 ? ` · ${creatures.length} saved` : ''}
      </button>

      {vaultOpen && (
        <div className="creature-vault-section">
          <div className="section-heading subheading">
            <h3>Creature vault</h3>
            <span>Legacy · does not drive main loops</span>
          </div>
          {creatures.length === 0 ? (
            <p className="vault-empty-hint">
              Empty for now. Use <strong>Hatch lab</strong> in More, or buy supplies in the Shop.
            </p>
          ) : (
            <>
              <p className="vault-roster-meta">
                {activeCopies}/{maxCreatureSlots} active · {groupedCreatures.length} types
              </p>
              <div className="collection-grid">
                {groupedCreatures.map((group) => (
                  <CreatureCard
                    activeCount={group.activeCount}
                    creature={group.representative}
                    duplicateCount={group.duplicateCount}
                    incomePerMinute={group.activeIncomePerMinute}
                    isActive={group.activeCount > 0}
                    key={group.creatureId}
                    onSelect={() => onSelect(group.representative, true)}
                    selected={group.copies.some((creature) => creature.uid === selectedUid)}
                    storedCount={group.storedCount}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface CreatureCollectionGroup {
  creatureId: string;
  copies: OwnedCreature[];
  representative: OwnedCreature;
  duplicateCount: number;
  activeCount: number;
  storedCount: number;
  activeIncomePerMinute: number;
}

const getCreatureCollectionGroups = (creatures: OwnedCreature[], maxCreatureSlots: number): CreatureCollectionGroup[] => {
  const grouped = new Map<string, Array<{ creature: OwnedCreature; isActive: boolean }>>();

  creatures.forEach((creature, index) => {
    const copies = grouped.get(creature.creatureId) ?? [];
    copies.push({ creature, isActive: index < maxCreatureSlots });
    grouped.set(creature.creatureId, copies);
  });

  return Array.from(grouped.entries()).map(([creatureId, copies]) => {
    const activeCopies = copies.filter((copy) => copy.isActive);
    const representativePool = activeCopies.length > 0 ? activeCopies : copies;
    const representative = representativePool.reduce((best, copy) => {
      if (copy.creature.level !== best.creature.level) {
        return copy.creature.level > best.creature.level ? copy : best;
      }

      return copy.creature.hatchedAt > best.creature.hatchedAt ? copy : best;
    }).creature;

    return {
      creatureId,
      copies: copies.map((copy) => copy.creature),
      representative,
      duplicateCount: copies.length,
      activeCount: activeCopies.length,
      storedCount: copies.length - activeCopies.length,
      activeIncomePerMinute: activeCopies.reduce(
        (total, copy) => total + getCreatureIncomePerMinute(copy.creature),
        0,
      ),
    };
  });
};

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
        <div className="empty-emoji">⚙️</div>
        <h2>No creature selected</h2>
        <p>Open the creature vault under Generators, then pick a companion to upgrade.</p>
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
  const eggProductIds: ProductId[] = [
    PRODUCT_IDS.premiumEggPack3,
    PRODUCT_IDS.premiumEggPack10,
    PRODUCT_IDS.extraCreatureSlot,
    PRODUCT_IDS.starterPack,
  ];
  const boostProductIds: ProductId[] = [PRODUCT_IDS.instantHatch, PRODUCT_IDS.incomeBoost24h];
  const eggProducts = PAID_PRODUCTS.filter((product) => eggProductIds.includes(product.id));
  const boostProducts = PAID_PRODUCTS.filter((product) => boostProductIds.includes(product.id));

  return (
    <div className="screen-content shop-screen">
      <div className="section-heading">
        <h2>Shop</h2>
        <span>{gameState.premiumEggs} premium</span>
      </div>

      {boostRemainingMs > 0 && (
        <div className="boost-card shop-boost">
          <span>x2 active</span>
          <strong>{getCooldownLabel(boostRemainingMs)}</strong>
        </div>
      )}

      <div className="shop-section-label">Eggs</div>
      <ShopItem
        variant="free"
        icon="🥚"
        title="Free Egg"
        subtitle={freeReady ? 'Ready' : cooldown}
        action={freeReady ? 'Claim' : cooldown}
        onClick={onClaimFreeEgg}
      />
      <ShopItem
        variant="coin"
        icon="🥚"
        title="Basic Egg"
        subtitle={`Tier ${gameState.playerTier}`}
        action={`${ECONOMY.basicEggCoinCost} coins`}
        onClick={onBuyBasic}
      />
      <ShopItem
        variant="gem"
        icon="✨"
        title="Premium Egg"
        subtitle="Better odds"
        action={`${ECONOMY.premiumEggGemCost} gems`}
        onClick={onBuyPremium}
      />
      <div className="paid-products">
        {eggProducts.map((product) => (
          <PaidProductCard
            isPurchasing={purchasingProductId === product.id}
            key={product.id}
            product={product}
            onPurchase={() => onPurchaseProduct(product)}
          />
        ))}
      </div>

      <div className="shop-section-label">Boosts</div>
      <div className="paid-products">
        {boostProducts.map((product) => (
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

interface MoreScreenProps {
  soundEnabled: boolean;
  onNavigate: (screen: Screen) => void;
  onToggleSound: () => void;
  onOpenHatch: () => void;
  onOpenGeneratorsVault: () => void;
}

function MoreScreen({ soundEnabled, onNavigate, onToggleSound, onOpenHatch, onOpenGeneratorsVault }: MoreScreenProps) {
  return (
    <div className="screen-content more-screen">
      <div className="section-heading">
        <h2>More</h2>
        <span>Menu</span>
      </div>
      <div className="more-grid">
        <button className="more-card prestige" onClick={() => onNavigate('prestige')} type="button">
          <span aria-hidden="true">✦</span>
          <strong>Prestige</strong>
        </button>
        <button className="more-card daily" onClick={() => onNavigate('daily')} type="button">
          <span aria-hidden="true">⭐</span>
          <strong>Daily</strong>
        </button>
        <button className="more-card invite" onClick={() => onNavigate('referral')} type="button">
          <span aria-hidden="true">🎁</span>
          <strong>Invite</strong>
        </button>
        <button className="more-card hatch-secondary" onClick={onOpenHatch} type="button">
          <span aria-hidden="true">🧪</span>
          <strong>Hatch lab</strong>
          <small className="more-card-hint">Side content</small>
        </button>
        <button className="more-card vault-secondary" onClick={onOpenGeneratorsVault} type="button">
          <span aria-hidden="true">📦</span>
          <strong>Creature vault</strong>
          <small className="more-card-hint">Legacy roster</small>
        </button>
        <button className={`more-card sound ${soundEnabled ? 'active' : ''}`} onClick={onToggleSound} type="button">
          <span aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span>
          <strong>Sound</strong>
        </button>
      </div>
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
        <p>Earn premium supplies, gems, boosts, and future founder rewards as friends join {GAME_TITLE}.</p>
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

interface PrestigeScreenProps {
  gameState: GameState;
  onBuyUpgrade: (upgradeId: PrestigeUpgradeId) => void;
  onReset: () => void;
}

function PrestigeScreen({ gameState, onBuyUpgrade, onReset }: PrestigeScreenProps) {
  const essenceGain = getPrestigeEssenceGain(gameState);

  return (
    <div className="screen-content prestige-screen">
      <div className="prestige-hero">
        <span className="prestige-icon" aria-hidden="true">✦</span>
        <div>
          <span>Essence</span>
          <strong>{formatNumber(gameState.essence)}</strong>
        </div>
        <div>
          <span>On reset</span>
          <strong>+{formatNumber(essenceGain)}</strong>
        </div>
      </div>

      <div className="prestige-reset-card">
        <div>
          <h2>Prestige Reset</h2>
          <p>Reset coins, creatures, and upgrades. Keep Essence and permanent upgrades.</p>
        </div>
        <button className="primary-action prestige-reset-button" disabled={essenceGain <= 0} onClick={onReset} type="button">
          Reset for {formatNumber(essenceGain)} Essence
        </button>
        <small>{formatNumber(gameState.totalCoinsEarned)} total coins earned this run</small>
      </div>

      <div className="section-heading">
        <h2>Essence Shop</h2>
        <span>{gameState.prestigeCount} resets</span>
      </div>

      <div className="prestige-upgrade-list">
        {PRESTIGE_UPGRADES.map((upgrade) => {
          const level = gameState.prestigeUpgrades[upgrade.id];
          const cost = getPrestigeUpgradeCost(upgrade.id, level);
          const maxed = upgrade.maxLevel !== undefined && level >= upgrade.maxLevel;
          const canBuy = !maxed && gameState.essence >= cost;

          return (
            <div className="prestige-upgrade-card" key={upgrade.id}>
              <span className="prestige-upgrade-icon" aria-hidden="true">{upgrade.icon}</span>
              <div>
                <strong>{upgrade.title}</strong>
                <span>{upgrade.description}</span>
                <small>Level {level}{upgrade.maxLevel ? `/${upgrade.maxLevel}` : ''}</small>
              </div>
              <button disabled={!canBuy} onClick={() => onBuyUpgrade(upgrade.id)} type="button">
                {maxed ? 'Max' : `${cost} ✦`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
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
