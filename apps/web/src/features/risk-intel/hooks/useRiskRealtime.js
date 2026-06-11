import { useEffect } from 'react';
import { subscribe } from '../../../lib/centrifuge.js';
export function useRiskRealtime(orgId, queryClient) {
    useEffect(() => {
        if (!orgId)
            return;
        return subscribe(`risk:updates:${orgId}`, (data) => {
            if (data.type === 'zone_updated' || data.type === 'event_added') {
                void queryClient.invalidateQueries({ queryKey: ['risk-zones'] });
                if (data.zone_id) {
                    void queryClient.invalidateQueries({ queryKey: ['risk-events', data.zone_id] });
                }
                void queryClient.invalidateQueries({ queryKey: ['risk-ticker'] });
            }
        });
    }, [orgId, queryClient]);
}
