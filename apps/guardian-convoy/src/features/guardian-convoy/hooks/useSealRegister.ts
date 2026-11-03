import { useState, useCallback } from 'react';
import type { SealDisplayEntry, SealStatus } from '../types/SealEntry';
import { sealApi } from '../api/sealApi';

export function useSealRegister(token: string, convoyId: string) {
  const [submitting, setSubmitting] = useState(false);

  const verifyAndSubmit = useCallback(
    async (
      entry: SealDisplayEntry,
      phase: 'sod' | 'eod',
      status: SealStatus,
      photoId: string | null,
      lat: number | null,
      lng: number | null
    ) => {
      setSubmitting(true);
      try {
        return await sealApi.submitVerification(
          entry.seal_id,
          convoyId,
          phase,
          photoId,
          status,
          lat,
          lng,
          token
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, convoyId]
  );

  const reportTamper = useCallback(
    async (sealId: string, lat: number | null, lng: number | null) => {
      setSubmitting(true);
      try {
        return await sealApi.reportTamper(sealId, convoyId, lat, lng, token);
      } finally {
        setSubmitting(false);
      }
    },
    [token, convoyId]
  );

  return { submitting, verifyAndSubmit, reportTamper };
}
