package com.fleetops.guardian.data.api

import com.fleetops.guardian.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private const val CONNECT_TIMEOUT_SECONDS = 15L
    private const val READ_TIMEOUT_SECONDS = 30L
    private const val WRITE_TIMEOUT_SECONDS = 30L
    private const val MAX_RETRIES = 3

    /**
     * Retry interceptor — retries on IOException (network failure) with
     * exponential back-off.  Does NOT retry on HTTP error responses.
     */
    private class RetryInterceptor(private val maxRetries: Int = MAX_RETRIES) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            var lastException: IOException? = null

            repeat(maxRetries) { attempt ->
                try {
                    val response = chain.proceed(request)
                    // Only retry on server errors (5xx) that are transient
                    if (response.isSuccessful || response.code < 500) return response
                    val body = response.peekBody(512).string()
                    lastException = IOException("HTTP ${response.code}: $body")
                    response.close()
                } catch (e: IOException) {
                    lastException = e
                }

                if (attempt < maxRetries - 1) {
                    val backoffMs = (INITIAL_BACKOFF_MS * Math.pow(2.0, attempt.toDouble())).toLong()
                    Thread.sleep(backoffMs)
                }
            }

            throw lastException ?: IOException("Request failed after $maxRetries retries")
        }

        companion object {
            private const val INITIAL_BACKOFF_MS = 500L
        }
    }

    /**
     * User-Agent interceptor — tags every request with app version info.
     */
    private val userAgentInterceptor = Interceptor { chain ->
        val request: Request = chain.request().newBuilder()
            .header("User-Agent", "GuardianAgent/${BuildConfig.VERSION_NAME} Android/${android.os.Build.VERSION.RELEASE}")
            .header("X-App-Version", BuildConfig.VERSION_NAME)
            .build()
        chain.proceed(request)
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BODY
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }

    private fun buildOkHttpClient(): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(userAgentInterceptor)
            .addInterceptor(RetryInterceptor())
            .addInterceptor(loggingInterceptor)
            .build()

    fun buildRetrofit(baseUrl: String): Retrofit =
        Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(buildOkHttpClient())
            .addConverterFactory(GsonConverterFactory.create())
            .build()

    fun buildApiService(baseUrl: String): GuardianApiService =
        buildRetrofit(baseUrl).create(GuardianApiService::class.java)
}
