import type { Screen } from '../types';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

const items: Array<{ screen: Screen; label: string; icon: string }> = [
  { screen: 'home', label: 'Home', icon: '🏠' },
  { screen: 'hatch', label: 'Hatch', icon: '🥚' },
  { screen: 'collection', label: 'Pets', icon: '🧺' },
  { screen: 'upgrade', label: 'Level', icon: '⬆️' },
  { screen: 'shop', label: 'Shop', icon: '🛒' },
];

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="EggFlip navigation">
      {items.map((item) => (
        <button
          className={`nav-item ${activeScreen === item.screen ? 'active' : ''}`}
          key={item.screen}
          onClick={() => onNavigate(item.screen)}
          type="button"
        >
          <span aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
