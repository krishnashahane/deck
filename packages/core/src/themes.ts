import type { Theme } from './model';

/**
 * Bundled themes. All fonts are SIL Open Font License families shipped with
 * DECK, so they may be embedded and redistributed with presentations.
 */
export const FONT_FAMILIES = [
  'Inter Variable',
  'Space Grotesk Variable',
  'Fraunces Variable',
  'Playfair Display Variable',
  'JetBrains Mono Variable',
  'Georgia',
  'Arial',
  'Times New Roman',
  'Courier New',
  'system-ui',
] as const;

export const EMBEDDABLE_FONTS = new Set<string>([
  'Inter Variable',
  'Space Grotesk Variable',
  'Fraunces Variable',
  'Playfair Display Variable',
  'JetBrains Mono Variable',
]);

const mono = 'JetBrains Mono Variable';

export const THEMES: Theme[] = [
  {
    id: 'graphite',
    name: 'Graphite',
    colors: {
      background: '#0E0F12',
      surface: '#1A1C21',
      text: '#F4F2EE',
      muted: '#8A8D96',
      accent: '#E8B04A',
      accent2: '#6FA8FF',
      accent3: '#7DD3A8',
      accent4: '#F07A6A',
    },
    fonts: { heading: 'Space Grotesk Variable', body: 'Inter Variable', mono },
    radius: 20,
  },
  {
    id: 'paper',
    name: 'Paper',
    colors: {
      background: '#F7F4EE',
      surface: '#EDE7DC',
      text: '#1D1B17',
      muted: '#7B746A',
      accent: '#C2410C',
      accent2: '#1E40AF',
      accent3: '#15803D',
      accent4: '#9333EA',
    },
    fonts: { heading: 'Fraunces Variable', body: 'Inter Variable', mono },
    radius: 6,
  },
  {
    id: 'meridian',
    name: 'Meridian',
    colors: {
      background: '#FFFFFF',
      surface: '#F1F4F9',
      text: '#0B1424',
      muted: '#5B6678',
      accent: '#2453FF',
      accent2: '#00A3A3',
      accent3: '#FFB020',
      accent4: '#E5484D',
    },
    fonts: { heading: 'Inter Variable', body: 'Inter Variable', mono },
    radius: 14,
  },
  {
    id: 'noir',
    name: 'Noir',
    colors: {
      background: '#000000',
      surface: '#141414',
      text: '#FFFFFF',
      muted: '#9A9A9A',
      accent: '#FF3D2E',
      accent2: '#FFFFFF',
      accent3: '#B4B4B4',
      accent4: '#FFD400',
    },
    fonts: { heading: 'Playfair Display Variable', body: 'Inter Variable', mono },
    radius: 0,
  },
  {
    id: 'atlas',
    name: 'Atlas',
    colors: {
      background: '#0B1F1A',
      surface: '#12302A',
      text: '#ECF5EF',
      muted: '#8FB3A6',
      accent: '#9AE6B4',
      accent2: '#F6E05E',
      accent3: '#63B3ED',
      accent4: '#FC8181',
    },
    fonts: { heading: 'Fraunces Variable', body: 'Inter Variable', mono },
    radius: 16,
  },
  {
    id: 'signal',
    name: 'Signal',
    colors: {
      background: '#F2F0FF',
      surface: '#E4E0FF',
      text: '#14112B',
      muted: '#625C86',
      accent: '#5B3DF5',
      accent2: '#F5413D',
      accent3: '#0FB57A',
      accent4: '#F5A623',
    },
    fonts: { heading: 'Space Grotesk Variable', body: 'Space Grotesk Variable', mono },
    radius: 28,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    colors: {
      background: '#0A0E14',
      surface: '#121822',
      text: '#D6E2F0',
      muted: '#5C6A7E',
      accent: '#3DDC97',
      accent2: '#58A6FF',
      accent3: '#F2CC60',
      accent4: '#FF7B72',
    },
    fonts: { heading: mono, body: 'Inter Variable', mono },
    radius: 8,
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    colors: {
      background: '#E9DFD1',
      surface: '#DCCDB8',
      text: '#2B2118',
      muted: '#7A6754',
      accent: '#8C3B2A',
      accent2: '#3E5A4A',
      accent3: '#C08A3E',
      accent4: '#4A4E7A',
    },
    fonts: { heading: 'Playfair Display Variable', body: 'Inter Variable', mono },
    radius: 4,
  },
];

export function themeById(id: string): Theme {
  return structuredClone(THEMES.find((t) => t.id === id) ?? THEMES[0]!);
}

export function themePalette(theme: Theme): string[] {
  const c = theme.colors;
  return [c.accent, c.accent2, c.accent3, c.accent4, c.text, c.muted, c.surface, c.background];
}
