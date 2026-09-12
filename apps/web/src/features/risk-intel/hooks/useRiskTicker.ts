import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { TickerItem } from '../types/risk.js'

export function useRiskTicker(continent?: string) {
  return useQuery<{ items: TickerItem[] }>({
    queryKey: ['risk-ticker', continent],
    queryFn: async () => {
      const res = await api.get('/risk/ticker', {
        params: { continent: continent && continent !== 'global' ? continent : undefined },
      })
      return res.data as { items: TickerItem[] }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
