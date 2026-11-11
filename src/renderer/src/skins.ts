import type { Skin } from '../../shared/types'

export interface SkinDefinition {
  id: Skin
  name: string
  caption: string
  description: string
  typography: string
  colors: [string, string, string]
}

// Appearance is independent of workspace layout. These definitions drive the skin browser.
export const skins: SkinDefinition[] = [
  {
    id: 'classic',
    name: 'Classic',
    caption: 'Eucalyptus & soft grey',
    description: 'Muted eucalyptus, soft corners and understated sans serif type.',
    typography: 'Sans serif · soft corners',
    colors: ['#477568', '#f6f7f9', '#283243'],
  },
  {
    id: 'folio',
    name: 'Folio',
    caption: 'Rust & warm paper',
    description: 'Warm paper, rust accents, fine rules and editorial serif type.',
    typography: 'Serif · fine rules',
    colors: ['#a34728', '#f5efe2', '#302b26'],
  },
  {
    id: 'studio',
    name: 'Studio',
    caption: 'Cobalt & cool grey',
    description: 'Cobalt accents, cool surfaces and bold sans serif type.',
    typography: 'Bold sans serif · rounded controls',
    colors: ['#3157ce', '#edf0f7', '#182740'],
  },
  {
    id: 'terminal',
    name: 'Terminal',
    caption: 'Amber & graphite',
    description: 'Amber accents, crisp rules, square controls and monospace type.',
    typography: 'Monospace · square controls',
    colors: ['#9a5a00', '#f6f1e5', '#342b1b'],
  },
  {
    id: 'focus',
    name: 'Focus',
    caption: 'Violet & soft lavender',
    description: 'Violet accents, soft lavender surfaces and rounded controls.',
    typography: 'Light sans serif · pill controls',
    colors: ['#7553b6', '#f4f1fa', '#332d42'],
  },
]

export const skinDefinition = (id: Skin) => skins.find((skin) => skin.id === id)!
