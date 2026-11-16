import { describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ api: { get: vi.fn() } }))

import { api } from './api.js'
import { fetchWorldContext, WORLD_CONTEXT_REQUEST_TIMEOUT_MS } from './spatialClient.js'

describe('fetchWorldContext request budget', () => {
  it('allows slow multi-provider aggregation to return before the client aborts it', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { data: { generatedAt: '2026-11-17T00:00:00.000Z' } },
    } as never)

    const result = await fetchWorldContext({
      center: { latitude: -1.286, longitude: 36.817 },
      radiusM: 100_000,
      layers: ['aircraft', 'weather'],
      signal: undefined,
    })

    expect(WORLD_CONTEXT_REQUEST_TIMEOUT_MS).toBe(30_000)
    expect(result.generatedAt).toBe('2026-11-17T00:00:00.000Z')
    expect(api.get).toHaveBeenCalledWith(
      '/spatial/world-context',
      expect.objectContaining({
        timeout: 30_000,
        params: expect.objectContaining({
          lat: -1.286,
          lng: 36.817,
          layers: 'aircraft,weather',
        }),
      }),
    )
  })
})
