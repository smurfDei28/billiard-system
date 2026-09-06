// API Configuration
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000';

// App Colors - Dark pool hall theme
export const COLORS = {
  // Primary
  primary: '#00C896',        // Green felt
  primaryDark: '#009E78',
  primaryLight: '#33D4AC',

  // Secondary
  gold: '#FFD700',           // Gold accents
  goldDark: '#CCA800',

  // Backgrounds
  background: '#0A0E1A',     // Deep dark blue-black
  surface: '#131929',        // Card surface
  surfaceLight: '#1E2740',   // Lighter surface
  surfaceBorder: '#2A3550',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8B9EC4',
  textMuted: '#5A6B8A',

  // Status
  success: '#00C896',
  warning: '#FFB020',
  error: '#FF4444',
  info: '#4A9EFF',

  // Ranks
  rankRookie: '#8B9EC4',
  rankHustler: '#00C896',
  rankShark: '#4A9EFF',
  rankLegend: '#FFD700',
  rankElite: '#FF6B35',
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

// Rank colors and icons
export const RANK_CONFIG = {
  Rookie:  { color: COLORS.rankRookie, icon: '🎱', minXp: 0 },
  Hustler: { color: COLORS.rankHustler, icon: '🎯', minXp: 200 },
  Shark:   { color: COLORS.rankShark, icon: '🦈', minXp: 500 },
  Legend:  { color: COLORS.rankLegend, icon: '⭐', minXp: 1000 },
  Elite:   { color: COLORS.rankElite, icon: '👑', minXp: 2000 },
};

export const rankProgressForXp = (xp: number) => {
  const ranks = Object.entries(RANK_CONFIG).map(([name, config]) => ({ name, ...config }));
  const currentIndex = ranks.reduce((selected, rank, index) => xp >= rank.minXp ? index : selected, 0);
  const current = ranks[currentIndex]; const next = ranks[currentIndex + 1];
  return { current, next, progress: next ? Math.min(1, Math.max(0, (xp - current.minXp) / (next.minXp - current.minXp))) : 1 };
};

export const levelForXp = (xp: number) => {
  const ranks = Object.values(RANK_CONFIG);
  return ranks.reduce((level, rank, index) => xp >= rank.minXp ? index + 1 : level, 1);
};

// Membership plans
export const MEMBERSHIP_PLANS = {
  BASIC: {
    label: 'Basic Member',
    color: COLORS.primary,
    icon: '🎱',
    perks: ['Join tournaments', 'Loyalty rewards', 'Online top-up'],
  },
  PREMIUM: {
    label: 'Premium Member',
    color: COLORS.gold,
    icon: '⭐',
    perks: ['All Basic perks', 'Priority queue', 'Faster loyalty accrual'],
  },
  VIP: {
    label: 'VIP Member',
    color: COLORS.rankElite,
    icon: '👑',
    perks: ['All Premium perks', 'VIP room access', 'Exclusive tournaments'],
  },
};

export const POCKET_LABELS = {
  TOP_LEFT: 'Top Left',
  TOP_RIGHT: 'Top Right',
  MIDDLE_LEFT: 'Middle Left',
  MIDDLE_RIGHT: 'Middle Right',
  BOTTOM_LEFT: 'Bottom Left',
  BOTTOM_RIGHT: 'Bottom Right',
};
