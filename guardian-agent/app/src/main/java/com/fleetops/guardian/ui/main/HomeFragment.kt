package com.fleetops.guardian.ui.main

import android.app.AlertDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fleetops.guardian.R
import com.fleetops.guardian.data.repository.PanicMode
import com.fleetops.guardian.databinding.FragmentHomeBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    private val viewModel: MainViewModel by activityViewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnPanic.setOnClickListener { showPanicDialog() }
        binding.btnReport.setOnClickListener { showReportDialog() }
        observeViewModel()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { viewModel.deviceStatus.collect { updateStatusBar(it) } }
                launch { viewModel.panicState.collect { handlePanicState(it) } }
                launch { viewModel.reportState.collect { handleReportState(it) } }
            }
        }
    }

    private fun updateStatusBar(status: DeviceStatusUi) {
        binding.tvDeviceName.text = status.deviceName.ifEmpty { status.deviceId.take(16) }
        binding.chipOnlineStatus.text = if (status.isOnline) "Online" else "Offline"
        binding.chipOnlineStatus.setChipBackgroundColorResource(
            if (status.isOnline) R.color.success else R.color.danger
        )
        binding.tvTrackingMode.text = "Mode: ${status.trackingMode.uppercase()}"
        binding.tvBattery.text = when {
            status.batteryLevel < 0 -> "Battery: --"
            status.batteryCharging -> "Battery: ${status.batteryLevel}% ⚡"
            else -> "Battery: ${status.batteryLevel}%"
        }
        binding.tvSignal.text = when (status.networkType) {
            "offline" -> "Signal: Offline"
            else -> "Signal: ${status.signalStrength}% (${status.networkType.uppercase()})"
        }
    }

    private fun showPanicDialog() {
        val modes = arrayOf(
            "SILENT — Covert alert (no sound)",
            "LOUD — Audible alarm triggered",
            "MEDICAL — Medical emergency",
            "SECURITY — Security threat",
            "HIJACK — Vehicle hijacking"
        )
        var selected = PanicMode.SILENT
        AlertDialog.Builder(requireContext())
            .setTitle("EMERGENCY — Select Panic Type")
            .setSingleChoiceItems(modes, 0) { _, i -> selected = PanicMode.values()[i] }
            .setPositiveButton("SEND ALERT") { d, _ -> d.dismiss(); showPanicConfirm(selected) }
            .setNegativeButton("Cancel") { d, _ -> d.dismiss() }
            .setCancelable(true)
            .show()
            .also { it.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(ContextCompat.getColor(requireContext(), R.color.danger)) }
    }

    private fun showPanicConfirm(mode: PanicMode) {
        val input = EditText(requireContext()).apply {
            hint = "Optional message (location, details...)"
            maxLines = 3
            setPadding(48, 24, 48, 24)
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Confirm: ${mode.name} Alert")
            .setMessage("This will immediately alert fleet command with your location.")
            .setView(input)
            .setPositiveButton("CONFIRM ALERT") { d, _ ->
                d.dismiss()
                viewModel.triggerPanic(mode, input.text.toString().trim().ifEmpty { null })
            }
            .setNegativeButton("Cancel") { d, _ -> d.dismiss() }
            .setCancelable(false)
            .show()
            .also { it.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(ContextCompat.getColor(requireContext(), R.color.danger)) }
    }

    private fun handlePanicState(state: PanicUiState) {
        binding.btnPanic.isEnabled = state !is PanicUiState.Loading
        when (state) {
            is PanicUiState.Idle -> binding.tvPanicStatus.visibility = View.GONE
            is PanicUiState.Loading -> showPanicStatus("Sending alert...", R.color.body)
            is PanicUiState.Success -> {
                showPanicStatus(if (state.incidentId != null) "Alert sent! Incident: ${state.incidentId}" else "Alert sent successfully", R.color.success)
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 5000)
            }
            is PanicUiState.Queued -> {
                showPanicStatus("Alert queued — will send when online", R.color.warning)
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 5000)
            }
            is PanicUiState.Error -> {
                showPanicStatus("Error: ${state.message}", R.color.danger)
                binding.tvPanicStatus.postDelayed({ viewModel.resetPanicState() }, 8000)
            }
        }
    }

    private fun showPanicStatus(msg: String, colorRes: Int) {
        binding.tvPanicStatus.visibility = View.VISIBLE
        binding.tvPanicStatus.text = msg
        binding.tvPanicStatus.setTextColor(ContextCompat.getColor(requireContext(), colorRes))
    }

    private fun showReportDialog() {
        val categoryLabels = arrayOf("Vehicle Issue", "Road Hazard", "Suspicious Activity", "Route Change", "Cargo Issue", "Personnel Issue", "Other")
        val categoryValues = arrayOf("vehicle_issue", "road_hazard", "suspicious", "route_change", "cargo_issue", "personnel_issue", "other")
        var categoryValue = categoryValues[0]
        val spinner = Spinner(requireContext()).apply {
            adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, categoryLabels)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) { categoryValue = categoryValues[pos] }
                override fun onNothingSelected(p: AdapterView<*>?) {}
            }
        }
        val descInput = EditText(requireContext()).apply { hint = "Describe the situation..."; maxLines = 4; minLines = 2 }
        val pad = resources.getDimensionPixelSize(android.R.dimen.app_icon_size) / 4
        val container = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(requireContext()).apply { text = "Category:" })
            addView(spinner)
            addView(TextView(requireContext()).apply { text = "Description:"; setPadding(0, pad, 0, 0) })
            addView(descInput)
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Submit Field Report")
            .setView(container)
            .setPositiveButton("Submit") { d, _ -> d.dismiss(); viewModel.submitReport(categoryValue, descInput.text.toString().trim()) }
            .setNegativeButton("Cancel") { d, _ -> d.dismiss() }
            .show()
    }

    private fun handleReportState(state: ReportUiState) {
        binding.btnReport.isEnabled = state !is ReportUiState.Loading
        when (state) {
            is ReportUiState.Idle -> binding.tvReportStatus.visibility = View.GONE
            is ReportUiState.Loading -> showReportStatus("Submitting report...", R.color.body)
            is ReportUiState.Success -> {
                showReportStatus("Report submitted: #${state.reportId}", R.color.success)
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 4000)
            }
            is ReportUiState.Queued -> {
                showReportStatus("Report queued — will send when online", R.color.warning)
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 4000)
            }
            is ReportUiState.Error -> {
                showReportStatus("Error: ${state.message}", R.color.danger)
                binding.tvReportStatus.postDelayed({ viewModel.resetReportState() }, 6000)
            }
        }
    }

    private fun showReportStatus(msg: String, colorRes: Int) {
        binding.tvReportStatus.visibility = View.VISIBLE
        binding.tvReportStatus.text = msg
        binding.tvReportStatus.setTextColor(ContextCompat.getColor(requireContext(), colorRes))
    }
}
