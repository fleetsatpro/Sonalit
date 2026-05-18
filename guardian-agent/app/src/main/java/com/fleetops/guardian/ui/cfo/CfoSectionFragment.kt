package com.fleetops.guardian.ui.cfo

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.fleetops.guardian.data.api.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Displays CFO assignment context: assigned trucks and today's photo upload status.
 * CFOs tap a truck row to launch CfoPhotoActivity for photo capture.
 */
@AndroidEntryPoint
class CfoSectionFragment : Fragment() {

    @Inject lateinit var api: GuardianApiService
    @Inject lateinit var prefs: DevicePrefs

    private lateinit var progressBar: ProgressBar
    private lateinit var errorText: TextView
    private lateinit var convoyNameText: TextView
    private lateinit var reportDateText: TextView
    private lateinit var truckList: LinearLayout

    private var context_data: CfoContextData? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        val root = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        progressBar = ProgressBar(requireContext()).also { root.addView(it) }
        errorText = TextView(requireContext()).apply {
            visibility = View.GONE
            setTextColor(0xFFCC0000.toInt())
        }.also { root.addView(it) }
        convoyNameText = TextView(requireContext()).apply {
            textSize = 18f
            visibility = View.GONE
        }.also { root.addView(it) }
        reportDateText = TextView(requireContext()).apply {
            visibility = View.GONE
        }.also { root.addView(it) }
        truckList = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
        }.also { root.addView(it) }

        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        loadContext()
    }

    override fun onResume() {
        super.onResume()
        loadContext()
    }

    private fun loadContext() {
        progressBar.visibility = View.VISIBLE
        errorText.visibility = View.GONE
        truckList.removeAllViews()

        lifecycleScope.launch {
            try {
                val token = prefs.deviceToken()
                if (token.isEmpty()) {
                    showError("Device not enrolled")
                    return@launch
                }
                val response = api.getCfoContext(token)
                context_data = response.data
                renderContext(response.data)
            } catch (e: Exception) {
                showError("Failed to load assignment: ${e.message}")
            }
        }
    }

    private fun renderContext(data: CfoContextData) {
        progressBar.visibility = View.GONE
        convoyNameText.apply {
            text = "Convoy: ${data.convoy.name} (${data.convoy.status})"
            visibility = View.VISIBLE
        }
        reportDateText.apply {
            text = "Report date: ${data.reportDate}"
            visibility = View.VISIBLE
        }

        val uploadedIds = data.photosToday.map { it.convoyTruckId }.toSet()
        val sealCount = data.convoy.sealCountPerTruck

        for (truck in data.assignedTrucks) {
            val truckPhotos = data.photosToday.filter { it.convoyTruckId == truck.id }
            val uploaded = truckPhotos.size
            val required = (2 + sealCount) * 2

            val row = LinearLayout(requireContext()).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
            }

            val label = TextView(requireContext()).apply {
                text = "Truck ${truck.position}: ${truck.driverName}  ($uploaded/$required photos)"
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            row.addView(label)

            val captureBtn = Button(requireContext()).apply {
                text = "Add Photo"
                setOnClickListener { launchPhotoCapture(truck, data) }
            }
            row.addView(captureBtn)

            truckList.addView(row)
        }
    }

    private fun launchPhotoCapture(truck: CfoTruckDto, data: CfoContextData) {
        val intent = Intent(requireContext(), CfoPhotoActivity::class.java).apply {
            putExtra(CfoPhotoActivity.EXTRA_CONVOY_ID, data.convoy.id)
            putExtra(CfoPhotoActivity.EXTRA_CONVOY_TRUCK_ID, truck.id)
            putExtra(CfoPhotoActivity.EXTRA_TRUCK_POSITION, truck.position)
            putExtra(CfoPhotoActivity.EXTRA_DRIVER_NAME, truck.driverName)
            putExtra(CfoPhotoActivity.EXTRA_REPORT_DATE, data.reportDate)
            putExtra(CfoPhotoActivity.EXTRA_SEAL_COUNT, data.convoy.sealCountPerTruck)
        }
        startActivity(intent)
    }

    private fun showError(msg: String) {
        progressBar.visibility = View.GONE
        errorText.apply {
            text = msg
            visibility = View.VISIBLE
        }
    }
}
