import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { RiskEvent } from '../types/risk.js'

export function useZoneEvents(zoneId: string | null) {
  return useQuery<{ events: RiskEvent[] }>({
    queryKey: ['risk-events', zoneId],
    queryFn: async () => {
      const res = await api.get(`/risk/zones/${zoneId!}/events`)
      return res.data as { events: RiskEvent[] }
    },
    enabled: !!zoneId,
    staleTime: 15_000,
  })
}
