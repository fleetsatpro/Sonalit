package com.fleetops.guardian.ui.enrollment

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fleetops.guardian.BuildConfig
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.databinding.ActivityEnrollmentBinding
import com.fleetops.guardian.receiver.GuardianDeviceAdminReceiver
import com.fleetops.guardian.service.GuardianService
import com.fleetops.guardian.ui.main.MainActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class EnrollmentActivity : AppCompatActivity() {

    @Inject lateinit var devicePrefs: DevicePrefs

    private lateinit var binding: ActivityEnrollmentBinding
    private val viewModel: EnrollmentViewModel by viewModels()

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (!fineGranted && !coarseGranted) {
            Toast.makeText(this, "Location permission is required for fleet tracking", Toast.LENGTH_LONG).show()
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* handled silently */ }

    private val deviceAdminLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { navigateToMain() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEnrollmentBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Hide form until enrollment check completes — prevents flash on already-enrolled devices
        binding.enrollForm.visibility = View.INVISIBLE

        lifecycleScope.launch {
            if (devicePrefs.isEnrolled()) {
                navigateToMain()
            } else {
                binding.enrollForm.visibility = View.VISIBLE
                setupUi()
                observeViewModel()
                requestRequiredPermissions()
            }
        }
    }

    private fun setupUi() {
        binding.etServerUrl.setText(BuildConfig.SERVER_URL)

        binding.btnEnroll.setOnClickListener {
            viewModel.enroll(
                serverUrl = binding.etServerUrl.text.toString(),
                orgToken = binding.etOrgToken.text.toString(),
                deviceName = binding.etDeviceName.text.toString(),
            )
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state -> handleUiState(state) }
            }
        }
    }

    private fun handleUiState(state: EnrollmentUiState) {
        when (state) {
            is EnrollmentUiState.Idle -> {
                setLoading(false)
                binding.tvStatus.visibility = View.GONE
            }
            is EnrollmentUiState.Loading -> {
                setLoading(true)
                binding.tvStatus.visibility = View.VISIBLE
                binding.tvStatus.text = "Enrolling device..."
                binding.tvStatus.setTextColor(ContextCompat.getColor(this, android.R.color.white))
            }
            is EnrollmentUiState.Success -> {
                setLoading(false)
                binding.tvStatus.visibility = View.VISIBLE
                binding.tvStatus.text = "Enrollment successful! Activating security..."
                binding.tvStatus.setTextColor(ContextCompat.getColor(this, android.R.color.holo_green_light))
                requestDeviceAdmin()
            }
            is EnrollmentUiState.Error -> {
                setLoading(false)
                binding.tvStatus.visibility = View.VISIBLE
                binding.tvStatus.text = "Error: ${state.message}"
                binding.tvStatus.setTextColor(ContextCompat.getColor(this, android.R.color.holo_red_light))
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnEnroll.isEnabled = !loading
        binding.etServerUrl.isEnabled = !loading
        binding.etOrgToken.isEnabled = !loading
        binding.etDeviceName.isEnabled = !loading
    }

    private fun navigateToMain() {
        GuardianService.startService(this)
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun requestDeviceAdmin() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val component = ComponentName(this, GuardianDeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(component)) {
            navigateToMain()
            return
        }
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
            putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Required to protect fleet data, prevent app removal, and enable remote device management.")
        }
        deviceAdminLauncher.launch(intent)
    }

    private fun requestRequiredPermissions() {
        val permissionsToRequest = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
            permissionsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        if (permissionsToRequest.isNotEmpty()) {
            locationPermissionLauncher.launch(permissionsToRequest.toTypedArray())
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
