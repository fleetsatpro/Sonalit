import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
export function useRiskConvoys(continent) {
    return useQuery({
        queryKey: ['risk-convoys', continent],
        queryFn: async () => {
            const res = await api.get('/risk/convoys', {
                params: { continent: continent && continent !== 'global' ? continent : undefined },
            });
            return res.data;
        },
        staleTime: 30_000,
    });
}
