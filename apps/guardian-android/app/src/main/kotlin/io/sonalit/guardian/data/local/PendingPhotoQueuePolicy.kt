package io.sonalit.guardian.data.local

/**
 * A queued photo is automatically retried five times. Once the budget is
 * exhausted the row remains durable, but it needs an explicit operator retry.
 */
const val MAX_PENDING_PHOTO_ATTEMPTS = 5

enum class PendingPhotoQueueState {
    RETRYABLE,
    NEEDS_ATTENTION,
}

fun classifyPendingPhotoAttempts(attempts: Int): PendingPhotoQueueState =
    if (attempts < MAX_PENDING_PHOTO_ATTEMPTS) {
        PendingPhotoQueueState.RETRYABLE
    } else {
        PendingPhotoQueueState.NEEDS_ATTENTION
    }
