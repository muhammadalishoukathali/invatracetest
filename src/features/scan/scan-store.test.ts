import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScan } from './scan-store'

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap
}

afterEach(() => {
  useScan.getState().reset()
  vi.restoreAllMocks()
})

describe('scan image lifecycle', () => {
  it('releases the previous bitmap and object URL when a new image replaces it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const first = bitmap()
    const second = bitmap()

    useScan.getState().setImage('blob:first', first, new Blob(), 'camera', 'one', 'now')
    useScan.getState().setImage('blob:second', second, new Blob(), 'camera', 'two', 'later')

    expect(first.close).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:first')
    expect(second.close).not.toHaveBeenCalled()
  })

  it('releases the decoded bitmap after inference while keeping the report photo', () => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const decoded = bitmap()
    useScan.getState().setImage('blob:photo', decoded, new Blob(), 'camera', 'one', 'now')

    useScan.getState().setResult({
      outcome: 'uncertain',
      confidence: 0.4,
      modelVersion: 'test',
      reportable: false,
    }, null)

    expect(decoded.close).toHaveBeenCalledOnce()
    expect(useScan.getState().imageBitmap).toBeNull()
    expect(useScan.getState().imageBlob).toBeInstanceOf(Blob)
    expect(useScan.getState().imageUrl).toBe('blob:photo')
  })
})
