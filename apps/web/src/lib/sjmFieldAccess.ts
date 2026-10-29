import type { QueryClient } from '@tanstack/react-query';

type AssignmentSnapshot = { data?: Array<{ id: string }>; [key: string]: unknown };

/**
 * Immediately revoke cached field mission detail after the current mission
 * channel reports a roster rotation. The caller gates the selected mission in
 * React state synchronously; this helper cancels in-flight requests, removes
 * private detail/event/channel caches, filters the assignment list, then
 * authorises a fresh list read.
 */
export async function clearRevokedSjmFieldMissionCache(
  queryClient: QueryClient,
  orgId: string | undefined,
  userId: string | undefined,
  missionId: string,
  refreshAssignments = true,
): Promise<void> {
  const assignmentKey = ['sjm-my-assignments', orgId, userId] as const;
  const privateKeys = [
    ['sjm-field-detail', missionId] as const,
    ['sjm-field-events', missionId] as const,
    ['sjm-mission-channel', missionId] as const,
  ];

  const cancellation = Promise.all([
    ...privateKeys.map(queryKey => queryClient.cancelQueries({ queryKey, exact: true })),
    ...(orgId && userId
      ? [queryClient.cancelQueries({ queryKey: assignmentKey, exact: true })]
      : []),
  ]);

  const filterAssignmentSnapshot = () => {
    if (!orgId || !userId) return;
    const current = queryClient.getQueryData<AssignmentSnapshot>(assignmentKey);
    if (current?.data) {
      queryClient.setQueryData<AssignmentSnapshot>(assignmentKey, {
        ...current,
        data: current.data.filter(item => item.id !== missionId),
      });
    }
  };

  filterAssignmentSnapshot();
  await cancellation;
  privateKeys.forEach(queryKey => queryClient.removeQueries({ queryKey, exact: true }));
  // A cancelled fetch can restore its pre-fetch snapshot; re-filter after all
  // cancellation settles, even when the first snapshot was absent.
  filterAssignmentSnapshot();
  if (orgId && userId && refreshAssignments) {
    await queryClient.invalidateQueries({ queryKey: assignmentKey, exact: true });
  }
}

export function classifyRosterRevalidation(
  missionIds: readonly string[],
  assignments: readonly { id: string }[],
): { stillAssigned: string[]; revoked: string[] } {
  const assignedIds = new Set(assignments.map(assignment => assignment.id));
  return {
    stillAssigned: missionIds.filter(id => assignedIds.has(id)),
    revoked: missionIds.filter(id => !assignedIds.has(id)),
  };
}

export function isFieldMissionRelevantForRosterChange(
  missionId: string,
  selectedMissionId: string,
  assignedMissionIds: ReadonlySet<string>,
  pendingMissionIds: ReadonlySet<string>,
  hasPrivateCache: boolean,
): boolean {
  return missionId === selectedMissionId ||
    assignedMissionIds.has(missionId) ||
    pendingMissionIds.has(missionId) ||
    hasPrivateCache;
}
