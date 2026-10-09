package io.sonalit.guardian.data.local

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingPhotoUploadPolicyTest {
    @Test
    fun allowsBoundedAutomaticRetriesBeforeTheCeiling() {
        assertTrue(PendingPhotoUploadPolicy.canAutoRetry(0))
        assertTrue(PendingPhotoUploadPolicy.canAutoRetry(1))
        assertTrue(PendingPhotoUploadPolicy.canAutoRetry(PendingPhotoUploadPolicy.MAX_AUTOMATIC_ATTEMPTS - 1))
    }

    @Test
    fun exhaustedPhotosStopAutomaticRetriesWithoutDeletingEvidence() {
        val ceiling = PendingPhotoUploadPolicy.MAX_AUTOMATIC_ATTEMPTS
        assertFalse(PendingPhotoUploadPolicy.canAutoRetry(ceiling))
        assertTrue(PendingPhotoUploadPolicy.isExhausted(ceiling))
        assertTrue(PendingPhotoUploadPolicy.isExhausted(ceiling + 1))
        assertFalse(PendingPhotoUploadPolicy.isExhausted(ceiling - 1))
    }

    @Test
    fun negativeCountersAreNotTreatedAsRetryableState() {
        assertFalse(PendingPhotoUploadPolicy.canAutoRetry(-1))
        assertFalse(PendingPhotoUploadPolicy.isExhausted(-1))
    }
}
