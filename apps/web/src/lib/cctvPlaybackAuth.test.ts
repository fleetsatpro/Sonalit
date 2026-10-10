import { describe, expect, test } from 'vitest'
import { isTrustedCctvApiMediaRequest } from './cctvPlaybackAuth.js'

describe('CCTV HLS credential boundary', () => {
  const pageOrigin = 'https://console.sonalit.example'

  test('allows credentials for the configured same-origin CCTV proxy', () => {
    expect(isTrustedCctvApiMediaRequest(
      '/api/v1/cctv/opencctv%3Auk-hls-1/media?target=https%3A%2F%2Fmedia.example%2Fsegment.ts',
      '/api/v1',
      pageOrigin,
    )).toBe(true)
  })

  test('allows credentials when the configured API has its own origin', () => {
    expect(isTrustedCctvApiMediaRequest(
      'https://api.sonalit.example/api/v1/cctv/opencctv%3Auk-hls-1/media',
      'https://api.sonalit.example/api/v1',
      pageOrigin,
    )).toBe(true)
  })

  test('never authorizes direct public-camera manifests or segments', () => {
    expect(isTrustedCctvApiMediaRequest(
      'https://public-camera.example/live/master.m3u8',
      '/api/v1',
      pageOrigin,
    )).toBe(false)
    expect(isTrustedCctvApiMediaRequest(
      'https://cdn.public-camera.example/segment-001.ts',
      'https://api.sonalit.example/api/v1',
      pageOrigin,
    )).toBe(false)
  })

  test('rejects unrelated routes and prefix lookalikes', () => {
    expect(isTrustedCctvApiMediaRequest('/api/v1/auth/refresh', '/api/v1', pageOrigin)).toBe(false)
    expect(isTrustedCctvApiMediaRequest('/api/v1/cctv-evil/stream', '/api/v1', pageOrigin)).toBe(false)
  })

  test('fails closed for malformed URLs', () => {
    expect(isTrustedCctvApiMediaRequest('http://[invalid', '/api/v1', pageOrigin)).toBe(false)
  })
})
