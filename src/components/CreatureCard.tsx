import { RARITY_META } from '../constants';
import { getCreatureDefinition, getCreatureIncomePerMinute } from '../game';
import type { OwnedCreature } from '../types';
import { AssetImage } from './AssetImage';
import { RarityBadge } from './RarityBadge';

interface CreatureCardProps {
  creature: OwnedCreature;
  duplicateCount?: number;
  isActive?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function CreatureCard({ creature, duplicateCount = 1, isActive = true, selected = false, onSelect }: CreatureCardProps) {
  const definition = getCreatureDefinition(creature.creatureId);
  const income = getCreatureIncomePerMinute(creature);
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
      {isActive && <span className="active-badge">Active</span>}
      {!isActive && <span className="stored-badge">Stored</span>}
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
        <span className="income-badge">{isActive ? `${income}/min` : '0/min'}</span>
      </span>
    </button>
  );
}
