package io.sonalit.guardian

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Minimal, dependency-free crash capture for field devices.
 *
 * On an uncaught exception it writes the stack trace + device/app metadata to a
 * small JSON file in the app's private storage, then delegates to the previous
 * handler so Android still shows its normal crash dialog. Pending files are
 * uploaded on the next heartbeat (see HeartbeatWorker) and deleted on success —
 * so a crash on a field officer's phone comes back to the backend with the exact
 * file and line instead of being invisible.
 */
object CrashReporter {
    private const val DIR = "crashes"
    private const val MAX_FILES = 20

    fun install(context: Context) {
        val appCtx = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try { writeCrash(appCtx, thread, throwable) } catch (_: Throwable) { /* never mask the crash */ }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun crashDir(context: Context): File =
        File(context.filesDir, DIR).apply { mkdirs() }

    /** Crash files still awaiting upload. */
    fun pending(context: Context): List<File> =
        crashDir(context).listFiles { f -> f.isFile && f.name.startsWith("crash_") }?.sortedBy { it.name }
            ?: emptyList()

    private fun writeCrash(context: Context, thread: Thread, throwable: Throwable) {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
        val pkg = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
        val build = pkg?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode
            else @Suppress("DEPRECATION") it.versionCode.toLong()
        } ?: 0L
        val json = JSONObject().apply {
            put("occurred_at", iso)
            put("thread", thread.name)
            put("app_version", pkg?.versionName ?: "?")
            put("app_build", build)
            put("android_version", Build.VERSION.RELEASE)
            put("sdk_int", Build.VERSION.SDK_INT)
            put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("stack_trace", sw.toString().take(12000))
        }
        val dir = crashDir(context)
        File(dir, "crash_${System.currentTimeMillis()}.json").writeText(json.toString())

        // Bound the folder so a crash-looping device can't fill storage.
        val files = dir.listFiles { f -> f.isFile && f.name.startsWith("crash_") }?.sortedBy { it.name }
        if (files != null && files.size > MAX_FILES) {
            files.take(files.size - MAX_FILES).forEach { runCatching { it.delete() } }
        }
    }
}
