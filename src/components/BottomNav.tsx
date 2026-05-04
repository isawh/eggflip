import type { Screen } from '../types';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

const items: Array<{ screen: Screen; label: string; icon: string }> = [
  { screen: 'home', label: 'Home', icon: '🏠' },
  { screen: 'collection', label: 'Pets', icon: '🧺' },
  { screen: 'shop', label: 'Shop', icon: '🛒' },
  { screen: 'more', label: 'More', icon: '•••' },
];

const getNavScreen = (screen: Screen): Screen => {
  if (screen === 'hatch') return 'home';
  if (screen === 'upgrade') return 'collection';
  if (screen === 'daily' || screen === 'referral' || screen === 'prestige') return 'more';
  return screen;
};

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  const activeNavScreen = getNavScreen(activeScreen);

  return (
    <nav className="bottom-nav" aria-label="EggFlip navigation">
      {items.map((item) => (
        <button
          className={`nav-item ${activeNavScreen === item.screen ? 'active' : ''}`}
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
