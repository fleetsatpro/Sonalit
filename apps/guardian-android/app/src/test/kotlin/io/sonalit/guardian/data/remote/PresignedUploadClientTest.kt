package io.sonalit.guardian.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PresignedUploadClientTest {
    @Test
    fun `storage client has bounded timeouts and no authentication interceptors`() {
        val client = PresignedUploadClient.create()

        assertTrue("Storage client must not inject application auth headers", client.interceptors.isEmpty())
        assertTrue("Storage client must not add network interceptors", client.networkInterceptors.isEmpty())
        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(60_000, client.writeTimeoutMillis)
        assertEquals(30_000, client.readTimeoutMillis)
        assertEquals(90_000, client.callTimeoutMillis)
        assertFalse("Signed URL PUTs must not be silently redirected", client.followRedirects)
        assertFalse(client.followSslRedirects)
    }
}
