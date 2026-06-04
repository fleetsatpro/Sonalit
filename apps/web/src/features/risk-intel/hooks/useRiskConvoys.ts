import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { RiskConvoy } from '../types/risk.js'

export function useRiskConvoys(continent?: string) {
  return useQuery<{ convoys: RiskConvoy[] }>({
    queryKey: ['risk-convoys', continent],
    queryFn: async () => {
      const res = await api.get('/risk/convoys', {
        params: { continent: continent && continent !== 'global' ? continent : undefined },
      })
      return res.data as { convoys: RiskConvoy[] }
    },
    staleTime: 30_000,
  })
}
