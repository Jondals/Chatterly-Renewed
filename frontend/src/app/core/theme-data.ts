/**
 * src/app/core/theme-data.ts
 * The accent colors and the themes the person can choose (their names and colors), shared by the settings and by the pictures
 * of the presets.
 */
import type { AccentId } from './models';
import type { ThemeId } from './services/settings.service';

export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'mint', label: 'Mint', color: '#2ef2b0' },
  { id: 'quantum', label: 'Cyan', color: '#38e8ff' },
  { id: 'indigo', label: 'Indigo', color: '#818cf8' },
  { id: 'violet', label: 'Violet', color: '#b794f6' },
  { id: 'rose', label: 'Rose', color: '#fb6f9a' },
  { id: 'coral', label: 'Coral', color: '#ff8a7a' },
  { id: 'amber', label: 'Amber', color: '#fbbf24' },
  { id: 'lime', label: 'Lime', color: '#a3e635' },
  { id: 'obsidian', label: 'Silver', color: '#d9dde8' },
];
export const THEMES: { id: ThemeId; label: string; colors: [string, string, string] }[] = [
  { id: 'midnight', label: 'Midnight', colors: ['#07080c', '#14171f', '#242937'] },
  { id: 'graphite', label: 'Graphite', colors: ['#0a0a0b', '#1b1b1d', '#2d2d31'] },
  { id: 'amoled', label: 'AMOLED black', colors: ['#000000', '#101010', '#212121'] },
  { id: 'dusk', label: 'Dusk', colors: ['#0b0814', '#1e1730', '#342a4e'] },
  { id: 'forest', label: 'Forest', colors: ['#060b09', '#131e19', '#24352d'] },
  { id: 'ocean', label: 'Ocean', colors: ['#050b12', '#112336', '#223f5c'] },
  { id: 'crimson', label: 'Crimson', colors: ['#0d0607', '#261418', '#43232b'] },
  { id: 'mocha', label: 'Mocha', colors: ['#0c0908', '#231b17', '#3d2f27'] },
  { id: 'nord', label: 'Nord', colors: ['#0c1016', '#1d2530', '#323d4d'] },
  { id: 'matrix', label: 'Matrix', colors: ['#010603', '#081a0e', '#12331e'] },
  { id: 'rose', label: 'Rose', colors: ['#0e070b', '#27141f', '#472538'] },
  { id: 'abyss', label: 'Abyss', colors: ['#04100f', '#0e2b28', '#1c4b46'] },
  { id: 'plum', label: 'Plum', colors: ['#0b0612', '#221433', '#3d265c'] },
  { id: 'glacier', label: 'Glacier', colors: ['#050b0f', '#12252f', '#35607a'] },
  { id: 'tangerine', label: "Tangerine's Pop", colors: ['#190a03', '#3d1c0d', '#934d27'] },
];
