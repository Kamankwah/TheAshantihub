import { render, screen } from '@testing-library/react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import TicketQr, { QR_OPTIONS } from './TicketQr.jsx'

describe('TicketQr', () => {
  it('renders an SVG QR image labelled with the ticket code', async () => {
    render(<TicketQr code="ad3126f8cbc4" />)
    const img = await screen.findByAltText('QR code for ticket ad3126f8cbc4')
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
  })

  it('encodes the code so the check-in scanner reads it back exactly', () => {
    // The same options TicketQr draws with, decoded by jsQR (the scanner's fallback decoder).
    const { modules } = QRCode.create('ad3126f8cbc4', QR_OPTIONS)
    const scale = 4
    const quiet = 4 * scale
    const side = modules.size * scale + quiet * 2
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const mx = Math.floor((x - quiet) / scale)
        const my = Math.floor((y - quiet) / scale)
        const dark = mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(my, mx)
        if (dark) pixels.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3)
      }
    }
    expect(jsQR(pixels, side, side)?.data).toBe('ad3126f8cbc4')
  })
})
