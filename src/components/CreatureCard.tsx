import { RARITY_META } from '../constants';
import { getCreatureDefinition, getCreatureIncomePerMinute } from '../game';
import type { OwnedCreature } from '../types';
import { AssetImage } from './AssetImage';
import { RarityBadge } from './RarityBadge';

interface CreatureCardProps {
  creature: OwnedCreature;
  activeCount?: number;
  duplicateCount?: number;
  incomePerMinute?: number;
  isActive?: boolean;
  selected?: boolean;
  storedCount?: number;
  onSelect?: () => void;
}

export function CreatureCard({
  creature,
  activeCount,
  duplicateCount = 1,
  incomePerMinute,
  isActive = true,
  selected = false,
  storedCount,
  onSelect,
}: CreatureCardProps) {
  const definition = getCreatureDefinition(creature.creatureId);
  const normalizedActiveCount = activeCount ?? (isActive ? 1 : 0);
  const normalizedStoredCount = storedCount ?? Math.max(0, duplicateCount - normalizedActiveCount);
  const income = incomePerMinute ?? (isActive ? getCreatureIncomePerMinute(creature) : 0);
  const rarityMeta = RARITY_META[definition.rarity];

  return (
    <button
      className={`creature-card ${selected ? 'selected' : ''} ${isActive ? 'active' : 'stored'}`}
      onClick={onSelect}
      style={
        {
          '--creature-accent': definition.accent,
          '--rarity-color': rarityMeta.color,
          '--rarity-glow': rarityMeta.glow,
        } as React.CSSProperties
      }
      type="button"
    >
      <span className="duplicate-badge">x{duplicateCount}</span>
      {isActive && (
        <span className="active-badge">
          {normalizedActiveCount > 1 ? `${normalizedActiveCount} Active` : 'Active'}
        </span>
      )}
      {!isActive && <span className="stored-badge">Stored</span>}
      {isActive && normalizedStoredCount > 0 && <span className="stored-count-badge">+{normalizedStoredCount} stored</span>}
      <AssetImage
        alt={definition.name}
        className="creature-emoji"
        fallback={definition.emoji}
        src={definition.imagePath}
      />
      <span className="creature-name">{definition.name}</span>
      <RarityBadge rarity={definition.rarity} />
      <span className="card-badge-row">
        <span className="level-badge">Lv {creature.level}</span>
        <span className="income-badge">{income}/min</span>
      </span>
    </button>
  );
}
