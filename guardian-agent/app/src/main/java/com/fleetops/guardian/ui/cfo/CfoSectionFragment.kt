package com.fleetops.guardian.ui.cfo

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.fleetops.guardian.R
import com.fleetops.guardian.data.api.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.api.RetrofitClient
import com.fleetops.guardian.databinding.FragmentCfoBinding
import com.fleetops.guardian.databinding.ItemCfoTruckBinding
import com.google.gson.Gson
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class CfoSectionFragment : Fragment() {

    @Inject lateinit var prefs: DevicePrefs

    private var _binding: FragmentCfoBinding? = null
    private val binding get() = _binding!!

    private var contextData: CfoContextData? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentCfoBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnRetry.setOnClickListener { loadContext() }
        binding.btnCfoLogin.setOnClickListener { submitCfoLogin() }

        binding.etCfoPassword.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submitCfoLogin()
                true
            } else false
        }

        binding.btnSwitchAccount.setOnClickListener {
            viewLifecycleOwner.lifecycleScope.launch {
                prefs.clearCfoSession()
                binding.etCfoEmail.text?.clear()
                binding.etCfoPassword.text?.clear()
                binding.tvCfoLoginError.visibility = View.GONE
                showCfoLogin()
            }
        }

        loadContext()
    }

    override fun onResume() {
        super.onResume()
        loadContext()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun showCfoLogin() {
        binding.layoutLoading.visibility = View.GONE
        binding.layoutError.visibility = View.GONE
        binding.layoutContent.visibility = View.GONE
        binding.layoutCfoLogin.visibility = View.VISIBLE
        binding.btnCfoLogin.isEnabled = true
    }

    private fun submitCfoLogin() {
        val email = binding.etCfoEmail.text?.toString()?.trim() ?: ""
        val password = binding.etCfoPassword.text?.toString() ?: ""

        if (email.isEmpty() || password.isEmpty()) {
            binding.tvCfoLoginError.text = "Email and password are required"
            binding.tvCfoLoginError.visibility = View.VISIBLE
            return
        }

        viewLifecycleOwner.lifecycleScope.launch {
            binding.btnCfoLogin.isEnabled = false
            binding.tvCfoLoginError.visibility = View.GONE

            try {
                val token = prefs.deviceToken()
                val api = RetrofitClient.buildApiService(prefs.serverUrl())
                val resp = api.cfoLogin(token, CfoLoginRequest(email, password))

                if (resp.isSuccessful && resp.body() != null) {
                    val body = resp.body()!!
                    prefs.saveCfoSession(body.userId, body.name, body.email)
                    binding.layoutCfoLogin.visibility = View.GONE
                    loadContext()
                } else {
                    val errMsg = when (resp.code()) {
                        400  -> "Email and password are required"
                        401  -> "Invalid email or password"
                        403  -> "Account is not active — contact your administrator"
                        429  -> "Too many attempts — try again in 15 minutes"
                        else -> "Login failed (${resp.code()})"
                    }
                    binding.tvCfoLoginError.text = errMsg
                    binding.tvCfoLoginError.visibility = View.VISIBLE
                    binding.btnCfoLogin.isEnabled = true
                }
            } catch (e: Exception) {
                binding.tvCfoLoginError.text = "Network error — check your connection"
                binding.tvCfoLoginError.visibility = View.VISIBLE
                binding.btnCfoLogin.isEnabled = true
            }
        }
    }

    private fun loadContext() {
        binding.layoutCfoLogin.visibility = View.GONE

        viewLifecycleOwner.lifecycleScope.launch {
            val token = prefs.deviceToken()
            if (token.isEmpty()) { showError("Device not enrolled — go to Settings to re-enroll"); return@launch }

            val cfoUserId = prefs.cfoUserId()
            if (cfoUserId.isNullOrEmpty()) {
                showCfoLogin()
                return@launch
            }

            // Show logged-in user name in the top banner
            val displayName = prefs.cfoUserName()?.takeIf { it.isNotEmpty() } ?: prefs.cfoEmail() ?: ""
            if (displayName.isNotEmpty()) {
                binding.tvCfoUserName.text = displayName
                binding.layoutCfoUser.visibility = View.VISIBLE
            }

            // Show cached data immediately so the user isn't staring at a spinner
            val cachedJson = prefs.convoyContextJson()
            if (cachedJson != null) {
                try {
                    val cached = Gson().fromJson(cachedJson, CfoContextData::class.java)
                    contextData = cached
                    renderConvoy(cached)
                } catch (_: Exception) {
                    showLoading()
                }
            } else {
                showLoading()
            }

            // Fetch fresh data in the background
            try {
                val api = RetrofitClient.buildApiService(prefs.serverUrl())
                val response = api.getCfoContext(token)
                prefs.saveConvoyContext(Gson().toJson(response.data))
                contextData = response.data
                renderConvoy(response.data)
            } catch (e: Exception) {
                if (cachedJson == null) {
                    val msg = when {
                        e.message?.contains("404") == true -> "No active convoy assigned to this device.\nContact your administrator."
                        e.message?.contains("403") == true -> "CFO module is not enabled on this server."
                        e.message?.contains("401") == true -> "Device token invalid — please re-enroll."
                        else -> "Failed to load convoy: ${e.message}"
                    }
                    showError(msg)
                }
                // If cache was shown, swallow the error silently
            }
        }
    }

    private fun showLoading() {
        binding.layoutCfoLogin.visibility = View.GONE
        binding.layoutLoading.visibility = View.VISIBLE
        binding.layoutError.visibility = View.GONE
        binding.layoutContent.visibility = View.GONE
    }

    private fun showError(msg: String) {
        binding.layoutCfoLogin.visibility = View.GONE
        binding.layoutLoading.visibility = View.GONE
        binding.layoutError.visibility = View.VISIBLE
        binding.layoutContent.visibility = View.GONE
        binding.tvErrorMsg.text = msg
    }

    private fun renderConvoy(data: CfoContextData) {
        binding.layoutCfoLogin.visibility = View.GONE
        binding.layoutLoading.visibility = View.GONE
        binding.layoutError.visibility = View.GONE
        binding.layoutContent.visibility = View.VISIBLE

        val convoy = data.convoy
        binding.tvConvoyName.text = convoy.name
        binding.chipConvoyStatus.text = convoy.status.uppercase()
        when (convoy.status) {
            "active"  -> binding.chipConvoyStatus.setChipBackgroundColorResource(R.color.success)
            "planned" -> binding.chipConvoyStatus.setChipBackgroundColorResource(R.color.warning)
            else      -> binding.chipConvoyStatus.setChipBackgroundColorResource(R.color.muted)
        }

        binding.tvReportDate.text = "Report: ${data.reportDate}"
        val dateRange = buildString {
            convoy.startDate?.let { append(it.take(10)) }
            convoy.endDate?.let { append(" → "); append(it.take(10)) }
        }
        binding.tvDateRange.text = dateRange

        val totalRequired = data.assignedTrucks.size * (2 + convoy.sealCountPerTruck) * 2
        val totalUploaded = data.photosToday.size
        binding.tvPhotoProgress.text = "$totalUploaded / $totalRequired photos"

        binding.truckListContainer.removeAllViews()
        val inflater = LayoutInflater.from(requireContext())
        for (truck in data.assignedTrucks) {
            val truckBinding = ItemCfoTruckBinding.inflate(inflater, binding.truckListContainer, false)
            bindTruckCard(truckBinding, truck, data)
            binding.truckListContainer.addView(truckBinding.root)
        }
    }

    private fun bindTruckCard(b: ItemCfoTruckBinding, truck: CfoTruckDto, data: CfoContextData) {
        val sealCount = data.convoy.sealCountPerTruck
        val required = (2 + sealCount) * 2
        val truckPhotos = data.photosToday.filter { it.convoyTruckId == truck.id }
        val sodPhotos = truckPhotos.filter { it.session == "sod" }
        val eodPhotos = truckPhotos.filter { it.session == "eod" }

        b.tvPosition.text = "${truck.position}"
        b.tvDriverName.text = truck.driverName
        if (!truck.driverPhone.isNullOrEmpty()) {
            b.tvDriverPhone.text = truck.driverPhone
            b.tvDriverPhone.visibility = View.VISIBLE
        }

        val uploaded = truckPhotos.size
        b.tvSodPhotos.text = "SOD: ${sodPhotos.size}"
        b.tvEodPhotos.text = "EOD: ${eodPhotos.size}"
        b.tvRequiredPhotos.text = "Required: $required"

        val percent = if (required > 0) (uploaded * 100 / required).coerceAtMost(100) else 100
        b.progressPhotos.progress = percent

        val isComplete = uploaded >= required
        b.chipPhotoStatus.text = if (isComplete) "✓ Done" else "$uploaded/$required"
        b.chipPhotoStatus.setChipBackgroundColorResource(if (isComplete) R.color.success else R.color.muted)
        b.chipPhotoStatus.setTextColor(
            ContextCompat.getColor(requireContext(), if (isComplete) R.color.navy_950 else R.color.bright)
        )

        b.btnCapture.setOnClickListener {
            startActivity(
                Intent(requireContext(), CfoPhotoActivity::class.java).apply {
                    putExtra(CfoPhotoActivity.EXTRA_CONVOY_ID, data.convoy.id)
                    putExtra(CfoPhotoActivity.EXTRA_CONVOY_TRUCK_ID, truck.id)
                    putExtra(CfoPhotoActivity.EXTRA_TRUCK_POSITION, truck.position)
                    putExtra(CfoPhotoActivity.EXTRA_DRIVER_NAME, truck.driverName)
                    putExtra(CfoPhotoActivity.EXTRA_REPORT_DATE, data.reportDate)
                    putExtra(CfoPhotoActivity.EXTRA_SEAL_COUNT, sealCount)
                    putExtra(CfoPhotoActivity.EXTRA_PHOTOS_TODAY, Gson().toJson(truckPhotos))
                }
            )
        }
    }
}
