export type ProductCurrency = 'Stars' | 'TON' | 'Gems' | 'Mock';

export type ProductTag = 'Best Value' | 'Popular' | 'Starter';

export const PRODUCT_IDS = {
  instantHatch: 'instant-hatch',
  premiumEggPack3: 'premium-egg-pack-3',
  premiumEggPack10: 'premium-egg-pack-10',
  incomeBoost24h: 'income-boost-24h',
  extraCreatureSlot: 'extra-creature-slot',
  starterPack: 'starter-pack',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

export interface MonetizationProduct {
  id: ProductId;
  title: string;
  description: string;
  price: number;
  currency: ProductCurrency;
  icon: string;
  tag?: ProductTag;
}

export const PAID_PRODUCTS: MonetizationProduct[] = [
  {
    id: PRODUCT_IDS.instantHatch,
    title: 'Instant Hatch',
    description: 'Skip the free egg cooldown and hatch again right away.',
    price: 25,
    currency: 'Stars',
    icon: '⏩',
    tag: 'Popular',
  },
  {
    id: PRODUCT_IDS.premiumEggPack3,
    title: 'Premium Egg Pack x3',
    description: 'Adds 3 premium eggs with better odds inside your unlocked tier.',
    price: 99,
    currency: 'Stars',
    icon: '✨',
  },
  {
    id: PRODUCT_IDS.premiumEggPack10,
    title: 'Premium Egg Pack x10',
    description: 'Adds 10 premium eggs for faster hatching, without skipping tiers.',
    price: 249,
    currency: 'Stars',
    icon: '🌟',
    tag: 'Best Value',
  },
  {
    id: PRODUCT_IDS.incomeBoost24h,
    title: 'x2 Income Boost 24h',
    description: 'Double passive creature income for the next 24 hours.',
    price: 149,
    currency: 'Stars',
    icon: '⚡',
    tag: 'Popular',
  },
  {
    id: PRODUCT_IDS.extraCreatureSlot,
    title: 'Basic Egg Crate',
    description: 'Adds 5 basic eggs for faster collection progress.',
    price: 79,
    currency: 'Stars',
    icon: '📦',
  },
  {
    id: PRODUCT_IDS.starterPack,
    title: 'Starter Pack',
    description: 'A speed-up bundle with coins, gems, and tier-capped premium eggs.',
    price: 199,
    currency: 'Stars',
    icon: '🎒',
    tag: 'Starter',
  },
];

export const getProductById = (productId: string): MonetizationProduct | undefined =>
  PAID_PRODUCTS.find((product) => product.id === productId);
