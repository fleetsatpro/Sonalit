import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
export function useRiskZones(continent, level) {
    return useQuery({
        queryKey: ['risk-zones', continent, level],
        queryFn: async () => {
            const res = await api.get('/risk/zones', {
                params: {
                    continent: continent && continent !== 'global' ? continent : undefined,
                    level: level && level !== 'all' ? level : undefined,
                },
            });
            return res.data;
        },
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
}
