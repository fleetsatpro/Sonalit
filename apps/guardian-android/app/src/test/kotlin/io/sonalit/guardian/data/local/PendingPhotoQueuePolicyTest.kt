package io.sonalit.guardian.data.local

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingPhotoQueuePolicyTest {
    @Test
    fun attemptsBelowLimitRemainEligibleForAutomaticRetry() {
        assertEquals(PendingPhotoQueueState.RETRYABLE, classifyPendingPhotoAttempts(0))
        assertEquals(PendingPhotoQueueState.RETRYABLE, classifyPendingPhotoAttempts(MAX_PENDING_PHOTO_ATTEMPTS - 1))
    }

    @Test
    fun reachingRetryLimitMovesPhotoToNeedsAttentionWithoutDeletingIt() {
        assertEquals(PendingPhotoQueueState.NEEDS_ATTENTION, classifyPendingPhotoAttempts(MAX_PENDING_PHOTO_ATTEMPTS))
        assertEquals(PendingPhotoQueueState.NEEDS_ATTENTION, classifyPendingPhotoAttempts(MAX_PENDING_PHOTO_ATTEMPTS + 1))
    }
}
