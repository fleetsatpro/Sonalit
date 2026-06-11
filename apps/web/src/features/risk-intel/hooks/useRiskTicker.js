import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
export function useRiskTicker() {
    return useQuery({
        queryKey: ['risk-ticker'],
        queryFn: async () => {
            const res = await api.get('/risk/ticker');
            return res.data;
        },
        refetchInterval: 30_000,
        staleTime: 15_000,
    });
}
