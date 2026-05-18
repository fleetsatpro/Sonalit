package com.fleetops.guardian.ui.main

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fleetops.guardian.R
import com.fleetops.guardian.databinding.ActivityMainBinding
import com.fleetops.guardian.service.GuardianService
import com.fleetops.guardian.ui.cfo.CfoSectionFragment
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    val viewModel: MainViewModel by viewModels()

    private var guardianService: GuardianService? = null
    private var serviceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val b = binder as? GuardianService.GuardianBinder
            guardianService = b?.getService()
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

        setupBottomNav()
        if (savedInstanceState == null) showFragment(HomeFragment(), TAB_HOME)
        bindToService()
    }

    override fun onStart() {
        super.onStart()
        if (!serviceBound) bindToService()
    }

    override fun onStop() {
        if (serviceBound) { unbindService(serviceConnection); serviceBound = false }
        super.onStop()
    }

    private fun bindToService() {
        bindService(Intent(this, GuardianService::class.java), serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun setupBottomNav() {
        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.tab_home -> { showFragment(HomeFragment(), TAB_HOME); true }
                R.id.tab_convoy -> { showFragment(CfoSectionFragment(), TAB_CONVOY); true }
                else -> false
            }
        }
    }

    private fun showFragment(fragment: Fragment, tag: String) {
        val existing = supportFragmentManager.findFragmentByTag(tag)
        if (existing != null && existing.isVisible) return
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment, tag)
            .commit()
    }

    private fun observeServiceState() {
        val svc = guardianService ?: return
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    svc.trackingMode.collect { mode ->
                        viewModel.updateServiceState(svc.isOnline.value, mode)
                    }
                }
                launch {
                    svc.isOnline.collect { online ->
                        viewModel.updateServiceState(online, svc.trackingMode.value)
                    }
                }
            }
        }
    }

    companion object {
        private const val TAB_HOME = "tab_home"
        private const val TAB_CONVOY = "tab_convoy"
    }
}
