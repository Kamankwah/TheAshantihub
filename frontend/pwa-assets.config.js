import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

// Renders the staff app's PWA icons from public/icons/staff-icon.svg.
// Run `npm run generate-pwa-assets` after changing the SVG; commit the PNGs.
// Maskable/apple variants are padded onto the icon's own dark-brown ground so
// the artwork stays inside the maskable safe zone.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions: { background: '#2C1810' } },
    apple: { ...preset.apple, resizeOptions: { background: '#2C1810' } },
  },
  images: ['public/icons/staff-icon.svg'],
})
