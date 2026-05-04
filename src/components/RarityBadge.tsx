import { RARITY_META } from '../constants';
import type { Rarity } from '../types';

interface RarityBadgeProps {
  rarity: Rarity;
}

export function RarityBadge({ rarity }: RarityBadgeProps) {
  return (
    <span
      className="rarity-badge"
      style={
        {
          '--rarity-color': RARITY_META[rarity].color,
          '--rarity-bg': RARITY_META[rarity].badge,
        } as React.CSSProperties
      }
    >
      {rarity}
    </span>
  );
}
