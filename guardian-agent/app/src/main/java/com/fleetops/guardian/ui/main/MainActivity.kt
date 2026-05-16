package com.fleetops.guardian.ui.main

import android.Manifest
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.IBinder
import android.view.LayoutInflater
import android.view.View
import android.widget.*
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fleetops.guardian.R
import com.fleetops.guardian.data.repository.PanicMode
import com.fleetops.guardian.databinding.ActivityMainBinding
import com.fleetops.guardian.service.GuardianService
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: MainViewModel by viewModels()

    private var guardianService: GuardianService? = null
    private var serviceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val guardianBinder = binder as? GuardianService.GuardianBinder
            guardianService = guardianBinder?.getService()
            serviceBound = true
            observeServiceState()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            guardianService = null
            serviceBound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupUi()
        observeViewModel()
        bindToService()
    }

    override fun onStart() {
        super.onStart()
        if (!serviceBound) bindToService()
    }

    override fun onStop() {
        if (serviceBound) {
            unbindService(serviceConnection)
            serviceBound = false
        }
        super.onStop()
    }

    private fun bindToService() {
        val intent = Intent(this, GuardianService::class.java)
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    // ─── UI Setup ─────────────────────────────────────────────────────────────

    private fun setupUi() {
        binding.btnPanic.setOnClickListener {
            showPanicDialog()
        }

        binding.btnReport.setOnClickListener {
            showReportDialog()
        }
    }

    // ─── Observers ────────────────────────────────────────────────────────────

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.deviceStatus.collect { status ->
                        updateStatusBar(status)
                    }
                }
                launch {
                    viewModel.panicState.collect { state ->
                        handlePanicState(state)
                    }
                }
                launch {
                    viewModel.reportState.collect { state ->
                        handleReportState(state)
                    }
                }
            }
        }
    }

    private fun observeServiceState() {
        val service = guardianService ?: return
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    service.trackingMode.collect { mode ->
                        viewModel.updateServiceState(service.isOnline.value, mode)
                    }
                }
                launch {
                    service.isOnline.collect { online ->
                        viewModel.updateServiceState(online, service.trackingMode.value)
                    }
                }
            }
        }
    }

    // ─── Status Bar ───────────────────────────────────────────────────────────

    private fun updateStatusBar(status: DeviceStatusUi) {
        val onlineColor = if (status.isOnline) {
            ContextCompat.getColor(this, android.R.color.holo_green_light)
        } else {
            ContextCompat.getColor(this, android.R.color.holo_red_light)
        }

        binding.chipOnlineStatus.apply {
            text = if (status.isOnline) "Online" else "Offline"
            setChipBackgroundColorResource(
                if (status.isOnline) android.R.color.holo_green_dark
                else android.R.color.holo_red_dark
            )
        }

        binding.tvTrackingMode.text = "Mode: ${status.trackingMode.uppercase()}"

        val batteryText = when {
            status.batteryLevel < 0 -> "Battery: --"
            status.batteryCharging -> "Battery: ${status.batteryLevel}% ⚡"
            else -> "Battery: ${status.batteryLevel}%"
        }
        binding.tvBattery.text = batteryText

        val signalText = when (status.networkType) {
            "offline" -> "Signal: Offline"
            else -> "Signal: ${status.signalStrength}% (${status.networkType.uppercase()})"
        }
        binding.tvSignal.text = signalText

        binding.tvDeviceName.text = status.deviceName.ifEmpty { status.deviceId }
    }

    // ─── Panic ────────────────────────────────────────────────────────────────

    private fun showPanicDialog() {
        val panicModes = arrayOf(
            "SILENT — Covert alert (no sound)",
            "LOUD — Audible alarm triggered",
            "MEDICAL — Medical emergency",
            "SECURITY — Security threat",
            "HIJACK — Vehicle hijacking"
        )

        var selectedMode = PanicMode.SILENT
        val modeValues = PanicMode.values()

        val dialogView = LayoutInflater.from(this).inflate(
            android.R.layout.simple_list_item_single_choice, null
        )

        AlertDialog.Builder(this)
            .setTitle("EMERGENCY — Select Panic Type")
            .setSingleChoiceItems(panicModes, 0) { _, which ->
                selectedMode = modeValues[which]
            }
            .setPositiveButton("SEND ALERT") { dialog, _ ->
                dialog.dismiss()
                showPanicMessageDialog(selectedMode)
            }
            .setNegativeButton("Cancel") { dialog, _ ->
                dialog.dismiss()
            }
            .setCancelable(true)
            .show()
            .also { dialog ->
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    ?.setTextColor(ContextCompat.getColor(this, android.R.color.holo_red_light))
            }
    }

    private fun showPanicMessageDialog(mode: PanicMode) {
        val input = EditText(this).apply {
            hint = "Optional message (location, details...)"
            maxLines = 3
        }

        AlertDialog.Builder(this)
            .setTitle("Confirm: ${mode.name} Alert")
            .setMessage("This will immediately alert fleet command with your location.")
            .setView(input)
            .setPositiveButton("CONFIRM ALERT") { dialog, _ ->
                val message = input.text.toString().trim().ifEmpty { null }
                dialog.dismiss()
                viewModel.triggerPanic(mode, message)
            }
            .setNegativeButton("Cancel") { dialog, _ ->
                dialog.dismiss()
            }
            .setCancelable(false)
            .show()
            .also { dialog ->
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    ?.setTextColor(ContextCompat.getColor(this, android.R.color.holo_red_light))
            }
    }

    private fun handlePanicState(state: PanicUiState) {
        when (state) {
            is PanicUiState.Idle -> {
                binding.btnPanic.isEnabled = true
                binding.tvPanicStatus.visibility = View.GONE
            }
            is PanicUiState.Loading -> {
                binding.btnPanic.isEnabled = false
                binding.tvPanicStatus.visibility = View.VISIBLE
                binding.tvPanicStatus.text = "Sending alert..."
                binding.tvPanicStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.white)
                )
            }
            is PanicUiState.Success -> {
                binding.btnPanic.isEnabled = true
                binding.tvPanicStatus.visibility = View.VISIBLE
                binding.tvPanicStatus.text = if (state.incidentId != null) {
                    "Alert sent! Incident: ${state.incidentId}"
                } else {
                    "Alert sent successfully"
                }
                binding.tvPanicStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_green_light)
                )
                // Auto-dismiss after 5 seconds
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 5000)
            }
            is PanicUiState.Queued -> {
                binding.btnPanic.isEnabled = true
                binding.tvPanicStatus.visibility = View.VISIBLE
                binding.tvPanicStatus.text = "Alert queued — will send when online"
                binding.tvPanicStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_orange_light)
                )
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 5000)
            }
            is PanicUiState.Error -> {
                binding.btnPanic.isEnabled = true
                binding.tvPanicStatus.visibility = View.VISIBLE
                binding.tvPanicStatus.text = "Error: ${state.message}"
                binding.tvPanicStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_red_light)
                )
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 8000)
            }
        }
    }

    // ─── Report ───────────────────────────────────────────────────────────────

    private fun showReportDialog() {
        val categories = arrayOf(
            "Vehicle Issue",
            "Road Hazard",
            "Suspicious Activity",
            "Route Change",
            "Cargo Issue",
            "Personnel Issue",
            "Other"
        )

        val dialogView = LayoutInflater.from(this).inflate(
            android.R.layout.simple_list_item_1, null
        )

        var selectedCategory = categories[0]

        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                categories
            )
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                    selectedCategory = categories[pos]
                }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        }

        val descInput = EditText(this).apply {
            hint = "Describe the situation..."
            maxLines = 5
            minLines = 2
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = resources.getDimensionPixelSize(android.R.dimen.app_icon_size) / 4
            setPadding(pad, pad, pad, pad)
            addView(TextView(this@MainActivity).apply {
                text = "Category:"
            })
            addView(spinner)
            addView(TextView(this@MainActivity).apply {
                text = "Description:"
                setPadding(0, pad, 0, 0)
            })
            addView(descInput)
        }

        AlertDialog.Builder(this)
            .setTitle("Submit Field Report")
            .setView(container)
            .setPositiveButton("Submit") { dialog, _ ->
                val description = descInput.text.toString().trim()
                dialog.dismiss()
                viewModel.submitReport(selectedCategory, description)
            }
            .setNegativeButton("Cancel") { dialog, _ ->
                dialog.dismiss()
            }
            .show()
    }

    private fun handleReportState(state: ReportUiState) {
        when (state) {
            is ReportUiState.Idle -> {
                binding.btnReport.isEnabled = true
                binding.tvReportStatus.visibility = View.GONE
            }
            is ReportUiState.Loading -> {
                binding.btnReport.isEnabled = false
                binding.tvReportStatus.visibility = View.VISIBLE
                binding.tvReportStatus.text = "Submitting report..."
                binding.tvReportStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.white)
                )
            }
            is ReportUiState.Success -> {
                binding.btnReport.isEnabled = true
                binding.tvReportStatus.visibility = View.VISIBLE
                binding.tvReportStatus.text = "Report submitted: #${state.reportId}"
                binding.tvReportStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_green_light)
                )
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 4000)
            }
            is ReportUiState.Queued -> {
                binding.btnReport.isEnabled = true
                binding.tvReportStatus.visibility = View.VISIBLE
                binding.tvReportStatus.text = "Report queued — will send when online"
                binding.tvReportStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_orange_light)
                )
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 4000)
            }
            is ReportUiState.Error -> {
                binding.btnReport.isEnabled = true
                binding.tvReportStatus.visibility = View.VISIBLE
                binding.tvReportStatus.text = "Error: ${state.message}"
                binding.tvReportStatus.setTextColor(
                    ContextCompat.getColor(this, android.R.color.holo_red_light)
                )
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 6000)
            }
        }
    }
}
