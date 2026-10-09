package io.sonalit.guardian.data.local

/** Bounded automatic retries. Exhaustion never deletes captured evidence. */
object PendingPhotoUploadPolicy {
    const val MAX_AUTOMATIC_ATTEMPTS = 5
    const val MAX_BATCH_SIZE = 10

    fun canAutoRetry(attempts: Int): Boolean =
        attempts >= 0 && attempts < MAX_AUTOMATIC_ATTEMPTS

    fun isExhausted(attempts: Int): Boolean =
        attempts >= MAX_AUTOMATIC_ATTEMPTS

    /** Unknown legacy ownership or another login must never qualify for replay. */
    fun belongsToOwner(photoOwnerUserId: String?, activeUserId: String?): Boolean =
        !photoOwnerUserId.isNullOrBlank() &&
            !activeUserId.isNullOrBlank() &&
            photoOwnerUserId == activeUserId
}
