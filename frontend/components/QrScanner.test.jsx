import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QrScanner from './QrScanner.jsx'

function fakeCamera() {
  const track = { stop: vi.fn() }
  return { track, openCamera: vi.fn().mockResolvedValue({ getTracks: () => [track] }) }
}

describe('QrScanner', () => {
  it('hands the first decoded code to onDetected and turns the camera off', async () => {
    const { track, openCamera } = fakeCamera()
    const detect = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('ad3126f8cbc4')
    const onDetected = vi.fn()
    render(<QrScanner onDetected={onDetected} onClose={vi.fn()} openCamera={openCamera}
      createDetector={async () => ({ detect })} intervalMs={1} />)

    await vi.waitFor(() => expect(onDetected).toHaveBeenCalledWith('ad3126f8cbc4'))
    expect(onDetected).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalled()
  })

  it("says so when the camera can't be opened", async () => {
    const openCamera = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    render(<QrScanner onDetected={vi.fn()} onClose={vi.fn()} openCamera={openCamera}
      createDetector={async () => ({ detect: vi.fn() })} />)
    expect(await screen.findByText("Can't open the camera. Allow camera access, or type the code instead.")).toBeInTheDocument()
  })

  it('closing stops the camera', async () => {
    const { track, openCamera } = fakeCamera()
    const onClose = vi.fn()
    render(<QrScanner onDetected={vi.fn()} onClose={onClose} openCamera={openCamera}
      createDetector={async () => ({ detect: vi.fn().mockResolvedValue(null) })} intervalMs={1} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }))
    expect(onClose).toHaveBeenCalled()
  })
})
