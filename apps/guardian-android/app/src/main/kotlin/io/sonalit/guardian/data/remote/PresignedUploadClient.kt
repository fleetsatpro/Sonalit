package io.sonalit.guardian.data.remote

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Client for direct uploads to pre-signed object-storage URLs.
 *
 * Do not use the authenticated Retrofit OkHttpClient here: its interceptor adds
 * X-Device-Token, which must never be forwarded to Cloudflare R2 or another
 * storage host. Finite per-call timeouts also prevent a stalled upload from
 * keeping the CFO submit action in a permanent loading state.
 */
internal object PresignedUploadClient {
    fun create(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(90, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
}
