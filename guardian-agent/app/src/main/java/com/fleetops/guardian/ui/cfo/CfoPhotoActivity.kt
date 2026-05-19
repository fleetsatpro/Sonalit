package com.fleetops.guardian.ui.cfo

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.location.Location
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.util.Base64
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.fleetops.guardian.R
import com.fleetops.guardian.data.api.*
import com.fleetops.guardian.data.api.RetrofitClient
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.databinding.ActivityCfoPhotoBinding
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.material.chip.Chip
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import kotlin.coroutines.resume

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

    @Inject lateinit var prefs: DevicePrefs

    private lateinit var binding: ActivityCfoPhotoBinding
    private lateinit var fusedLocation: FusedLocationProviderClient
    private var photoUri: Uri? = null
    private var photoFile: File? = null

    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) showPreviewAndUpload() else setStatus("Photo capture cancelled", R.color.warning)
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants.all { it.value }) openCamera()
        else setStatus("Camera and location permissions required", R.color.danger)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCfoPhotoBinding.inflate(layoutInflater)
        setContentView(binding.root)

        fusedLocation = LocationServices.getFusedLocationProviderClient(this)

        val position = intent.getIntExtra(EXTRA_TRUCK_POSITION, 0)
        val driverName = intent.getStringExtra(EXTRA_DRIVER_NAME) ?: ""
        val sealCount = intent.getIntExtra(EXTRA_SEAL_COUNT, 3)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.title = "Truck $position — Photos"
        binding.toolbar.subtitle = driverName
        binding.toolbar.setNavigationOnClickListener { finish() }

        buildPhotoTypeChips(sealCount)

        binding.btnCapture.setOnClickListener { checkPermissionsAndCapture() }
    }

    private fun buildPhotoTypeChips(sealCount: Int) {
        val types = mutableListOf("front", "rear")
        repeat(sealCount) { i -> types.add("seal_${i + 1}") }

        types.forEachIndexed { index, type ->
            val chip = Chip(this).apply {
                text = when {
                    type == "front" -> "FRONT"
                    type == "rear" -> "REAR"
                    else -> "SEAL ${type.substringAfter("seal_")}"
                }
                tag = type
                isCheckable = true
                isChecked = index == 0
                setChipBackgroundColorResource(R.color.chip_bg_selector)
                setTextColor(ContextCompat.getColorStateList(this@CfoPhotoActivity, R.color.chip_text_selector))
            }
            binding.chipGroupType.addView(chip)
        }
    }

    private fun checkPermissionsAndCapture() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            needed.add(Manifest.permission.CAMERA)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (needed.isEmpty()) openCamera() else permissionLauncher.launch(needed.toTypedArray())
    }

    private fun openCamera() {
        val ts = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        photoFile = File.createTempFile("CFO_${ts}_", ".jpg", storageDir)
        photoUri = FileProvider.getUriForFile(this, "${packageName}.provider", photoFile!!)
        cameraLauncher.launch(photoUri!!)
    }

    private fun showPreviewAndUpload() {
        photoFile?.let { f ->
            val bmp = BitmapFactory.decodeFile(f.absolutePath)
            if (bmp != null) {
                binding.ivPreview.setImageBitmap(bmp)
                binding.ivPreview.visibility = View.VISIBLE
            }
        }
        uploadPhoto()
    }

    private fun uploadPhoto() {
        val file = photoFile ?: return
        val selectedTypeChipId = binding.chipGroupType.checkedChipId
        if (selectedTypeChipId == View.NO_ID) { setStatus("Select a photo type first", R.color.warning); return }
        val typeTag = binding.chipGroupType.findViewById<Chip>(selectedTypeChipId)?.tag?.toString() ?: return

        val isSerial = typeTag.startsWith("seal_")
        val photoType = if (isSerial) "seal" else typeTag
        val sealPosition = if (isSerial) typeTag.substringAfter("seal_") else null

        val isSod = binding.chipGroupSession.checkedChipId == R.id.chipSod
        val session = if (isSod) "sod" else "eod"

        val convoyId = intent.getStringExtra(EXTRA_CONVOY_ID)!!
        val truckId = intent.getStringExtra(EXTRA_CONVOY_TRUCK_ID)!!
        val reportDate = intent.getStringExtra(EXTRA_REPORT_DATE)!!

        binding.btnCapture.isEnabled = false
        binding.uploadProgress.visibility = View.VISIBLE
        setStatus("Uploading photo...", R.color.body)

        lifecycleScope.launch {
            try {
                val token = prefs.deviceToken()
                val api = RetrofitClient.buildApiService(prefs.serverUrl())
                val location = getLastLocation()

                val urlResp = api.getCfoPhotoUploadUrl(
                    token,
                    CfoPhotoUploadUrlRequest(
                        convoyId = convoyId,
                        convoyTruckId = truckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPosition,
                        reportDate = reportDate
                    )
                )

                val photoUrl: String
                if (urlResp.isSuccessful) {
                    val body = urlResp.body()!!
                    val client = OkHttpClient()
                    val putResp = client.newCall(
                        Request.Builder()
                            .url(body.uploadUrl)
                            .put(file.asRequestBody("image/jpeg".toMediaType()))
                            .build()
                    ).execute()

                    if (!putResp.isSuccessful) {
                        setStatus("Upload failed: HTTP ${putResp.code}", R.color.danger)
                        binding.btnCapture.isEnabled = true
                        binding.uploadProgress.visibility = View.GONE
                        return@launch
                    }
                    photoUrl = body.publicUrl
                } else if (urlResp.code() == 501) {
                    // Server has no cloud storage configured — embed photo as base64 data URI.
                    // The backend backfill job will migrate it to R2 once credentials are set.
                    setStatus("Saving photo locally...", R.color.body)
                    photoUrl = encodeFileAsDataUri(file)
                } else {
                    setStatus("Upload error: HTTP ${urlResp.code()}", R.color.danger)
                    binding.btnCapture.isEnabled = true
                    binding.uploadProgress.visibility = View.GONE
                    return@launch
                }

                val takenAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
                    .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

                api.commitCfoPhoto(
                    token,
                    CfoPhotoCommitRequest(
                        eventUuid = UUID.randomUUID().toString(),
                        convoyId = convoyId,
                        convoyTruckId = truckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPosition,
                        reportDate = reportDate,
                        photoUrl = photoUrl,
                        takenAt = takenAt,
                        lat = location?.latitude,
                        lng = location?.longitude,
                        notes = null
                    )
                )

                binding.uploadProgress.visibility = View.GONE
                setStatus("Photo saved", R.color.success)
                Toast.makeText(this@CfoPhotoActivity, "Photo saved", Toast.LENGTH_SHORT).show()

                // Brief pause so user sees success, then allow next capture
                binding.btnCapture.postDelayed({
                    binding.btnCapture.isEnabled = true
                    binding.ivPreview.visibility = View.GONE
                }, 1500)

            } catch (e: Exception) {
                binding.uploadProgress.visibility = View.GONE
                setStatus("Error: ${e.message}", R.color.danger)
                binding.btnCapture.isEnabled = true
            }
        }
    }

    /**
     * Compresses the file to JPEG at reduced quality and returns a base64 data URI.
     * Keeps the encoded size well under the server's 5 MB JSON body limit.
     */
    private fun encodeFileAsDataUri(file: File): String {
        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 50, out)
        val encoded = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$encoded"
    }

    private fun setStatus(msg: String, colorRes: Int) {
        binding.tvStatus.visibility = View.VISIBLE
        binding.tvStatus.text = msg
        binding.tvStatus.setTextColor(ContextCompat.getColor(this, colorRes))
    }

    private suspend fun getLastLocation(): Location? = suspendCancellableCoroutine { cont ->
        try {
            fusedLocation.lastLocation
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        } catch (e: SecurityException) { cont.resume(null) }
    }
}
