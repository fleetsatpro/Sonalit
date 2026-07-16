import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { LiveFeedItem } from '../types/risk.js'

export function useLiveFeed() {
  return useQuery<{ items: LiveFeedItem[] }>({
    queryKey: ['risk-live-feed'],
    queryFn: async () => {
      const res = await api.get('/risk/live-feed')
      return res.data as { items: LiveFeedItem[] }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
