package com.fleetops.guardian.ui.cfo

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.fleetops.guardian.data.api.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import kotlin.coroutines.resume

/**
 * Camera capture flow for CFO truck photos.
 * Steps: request permissions → select session/type → capture → PUT to R2 → commit record.
 */
@AndroidEntryPoint
class CfoPhotoActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_CONVOY_ID = "convoy_id"
        const val EXTRA_CONVOY_TRUCK_ID = "convoy_truck_id"
        const val EXTRA_TRUCK_POSITION = "truck_position"
        const val EXTRA_DRIVER_NAME = "driver_name"
        const val EXTRA_REPORT_DATE = "report_date"
        const val EXTRA_SEAL_COUNT = "seal_count"
    }

    @Inject lateinit var api: GuardianApiService
    @Inject lateinit var prefs: DevicePrefs

    private lateinit var fusedLocation: FusedLocationProviderClient
    private lateinit var statusText: TextView
    private lateinit var captureButton: Button
    private lateinit var sessionSpinner: Spinner
    private lateinit var typeSpinner: Spinner
    private lateinit var sealPositionInput: EditText

    private var photoUri: Uri? = null
    private var photoFile: File? = null

    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success) uploadPhoto()
        else statusText.text = "Photo capture cancelled"
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants.all { it.value }) openCamera()
        else statusText.text = "Camera and location permissions required"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fusedLocation = LocationServices.getFusedLocationProviderClient(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        val driverName = intent.getStringExtra(EXTRA_DRIVER_NAME) ?: ""
        val position = intent.getIntExtra(EXTRA_TRUCK_POSITION, 0)
        val sealCount = intent.getIntExtra(EXTRA_SEAL_COUNT, 3)

        root.addView(TextView(this).apply { text = "Truck $position — $driverName"; textSize = 16f })

        sessionSpinner = Spinner(this).also {
            it.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, listOf("SOD", "EOD")).apply {
                setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            root.addView(it)
        }

        val photoTypes = listOf("front", "rear") + (1..sealCount).map { "seal" }
        typeSpinner = Spinner(this).also {
            it.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, photoTypes).apply {
                setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            root.addView(it)
        }

        sealPositionInput = EditText(this).apply {
            hint = "Seal position (e.g. 1, 2, 3) — seal photos only"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }.also { root.addView(it) }

        statusText = TextView(this).also { root.addView(it) }

        captureButton = Button(this).apply {
            text = "Capture Photo"
            setOnClickListener { checkPermissionsAndCapture() }
        }.also { root.addView(it) }

        setContentView(root)
    }

    private fun checkPermissionsAndCapture() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (needed.isEmpty()) openCamera() else permissionLauncher.launch(needed.toTypedArray())
    }

    private fun openCamera() {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        photoFile = File.createTempFile("CFO_${timeStamp}_", ".jpg", storageDir)
        photoUri = FileProvider.getUriForFile(this, "${packageName}.provider", photoFile!!)
        cameraLauncher.launch(photoUri!!)
    }

    private fun uploadPhoto() {
        val file = photoFile ?: return
        val photoType = typeSpinner.selectedItem.toString().lowercase()
        val sealPos = sealPositionInput.text.toString().trim().takeIf { it.isNotEmpty() && photoType == "seal" }
        val session = if (sessionSpinner.selectedItemPosition == 0) "sod" else "eod"
        val convoyId = intent.getStringExtra(EXTRA_CONVOY_ID)!!
        val truckId = intent.getStringExtra(EXTRA_CONVOY_TRUCK_ID)!!
        val reportDate = intent.getStringExtra(EXTRA_REPORT_DATE)!!

        if (photoType == "seal" && sealPos == null) {
            statusText.text = "Enter seal position for seal photos"
            return
        }

        captureButton.isEnabled = false
        statusText.text = "Uploading…"

        lifecycleScope.launch {
            try {
                val token = prefs.deviceToken()
                val location = getLastLocation()

                val urlResp = api.getCfoPhotoUploadUrl(
                    token,
                    CfoPhotoUploadUrlRequest(
                        convoyId = convoyId,
                        convoyTruckId = truckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPos,
                        reportDate = reportDate
                    )
                )

                // Direct PUT to R2 presigned URL — no base64, no server proxy
                val client = OkHttpClient()
                val putRequest = Request.Builder()
                    .url(urlResp.uploadUrl)
                    .put(file.asRequestBody("image/jpeg".toMediaType()))
                    .build()
                val putResponse = client.newCall(putRequest).execute()
                if (!putResponse.isSuccessful) {
                    statusText.text = "Upload failed: HTTP ${putResponse.code}"
                    captureButton.isEnabled = true
                    return@launch
                }

                val takenAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault()).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }.format(Date())

                api.commitCfoPhoto(
                    token,
                    CfoPhotoCommitRequest(
                        eventUuid = UUID.randomUUID().toString(),
                        convoyId = convoyId,
                        convoyTruckId = truckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPos,
                        reportDate = reportDate,
                        photoUrl = urlResp.publicUrl,
                        takenAt = takenAt,
                        lat = location?.latitude,
                        lng = location?.longitude,
                        notes = null
                    )
                )

                statusText.text = "Photo uploaded successfully"
                finish()
            } catch (e: Exception) {
                statusText.text = "Error: ${e.message}"
                captureButton.isEnabled = true
            }
        }
    }

    private suspend fun getLastLocation(): Location? = suspendCancellableCoroutine { cont ->
        try {
            fusedLocation.lastLocation.addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        } catch (e: SecurityException) {
            cont.resume(null)
        }
    }
}
