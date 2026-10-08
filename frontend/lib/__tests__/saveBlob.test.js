import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBlob } from '../saveBlob.js'

afterEach(() => vi.restoreAllMocks())

describe('saveBlob', () => {
  it('downloads the blob under the given name and cleans up', () => {
    const create = vi.fn(() => 'blob:fake')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    let clicked = null
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked = { href: this.href, download: this.download } })
    const blob = new Blob(['x'])
    saveBlob(blob, 'codes.txt')
    expect(create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(clicked).toEqual({ href: 'blob:fake', download: 'codes.txt' })
    expect(revoke).toHaveBeenCalledWith('blob:fake')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
