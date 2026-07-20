import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { LiveFeedItem } from '../types/risk.js'

export function useLiveFeed(continent?: string) {
  return useQuery<{ items: LiveFeedItem[] }>({
    queryKey: ['risk-live-feed', continent],
    queryFn: async () => {
      const res = await api.get('/risk/live-feed', {
        params: { continent: continent && continent !== 'global' ? continent : undefined },
      })
      return res.data as { items: LiveFeedItem[] }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
