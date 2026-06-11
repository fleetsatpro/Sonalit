import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
export function useZoneEvents(zoneId) {
    return useQuery({
        queryKey: ['risk-events', zoneId],
        queryFn: async () => {
            const res = await api.get(`/risk/zones/${zoneId}/events`);
            return res.data;
        },
        enabled: !!zoneId,
        staleTime: 15_000,
    });
}
