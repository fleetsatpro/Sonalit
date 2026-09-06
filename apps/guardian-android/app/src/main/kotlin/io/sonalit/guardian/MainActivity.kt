package io.sonalit.guardian

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.ui.cfo.CfoScreen
import io.sonalit.guardian.ui.enrollment.EnrollmentScreen
import io.sonalit.guardian.ui.home.HomeScreen
import io.sonalit.guardian.ui.settings.SettingsScreen
import io.sonalit.guardian.ui.theme.GuardianTheme

enum class NavDestination(
    val route: String,
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    Home("home", "Home", Icons.Filled.Home, Icons.Outlined.Home),
    Cfo("cfo", "CFO", Icons.Filled.Person, Icons.Outlined.Person),
    Settings("settings", "Settings", Icons.Filled.Settings, Icons.Outlined.Settings),
}

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            GuardianTheme {
                GuardianApp(viewModel = viewModel)
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val deepLinkUri = intent.data
        if (deepLinkUri != null) {
            viewModel.handleDeepLink(deepLinkUri.toString())
        }
        val fcmData = intent.extras?.let { extras ->
            extras.keySet().associateWith { extras.getString(it) ?: "" }
        }
        if (!fcmData.isNullOrEmpty()) {
            viewModel.handleFcmNotification(fcmData)
        }
    }
}

@Composable
private fun GuardianApp(viewModel: MainViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val navController = rememberNavController()

    LaunchedEffect(uiState.pendingDeepLink) {
        uiState.pendingDeepLink?.let { link ->
            navController.navigate(link)
            viewModel.clearDeepLink()
        }
    }

    // MainScaffold's NavigationSuiteScaffold wraps its content in a Surface
    // (giving Text its background/content-color pairing for free), but
    // EnrollmentScreen — shown before that scaffold ever mounts — had none, so
    // its default-colored Text resolved to black against the dark theme's
    // black background: invisible, while the explicitly-tinted hourglass icon
    // stayed visible. Looked exactly like a frozen black screen instead of the
    // "awaiting operator approval" state it actually was.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            uiState.isEnrolled -> MainScaffold()
            // Silent identity recovery is in flight — a reinstalled app on
            // already-registered hardware re-attaches automatically, so don't
            // flash the enrollment form at an officer who never needs it.
            !uiState.identityCheckDone -> IdentityRecoverySplash()
            else -> EnrollmentScreen(onEnrolled = { viewModel.markEnrolled() })
        }
    }
}

@Composable
private fun IdentityRecoverySplash() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(modifier = Modifier.height(14.dp))
            Text(
                text = "Checking device registration…",
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}

@Composable
private fun MainScaffold() {
    var currentDestination by rememberSaveable { mutableStateOf(NavDestination.Home) }
    RequestCorePermissionsOnFirstLaunch()
    RequestBatteryOptimizationExemptionOnFirstLaunch()

    NavigationSuiteScaffold(
        modifier = Modifier.fillMaxSize(),
        navigationSuiteItems = {
            NavDestination.entries.forEach { destination ->
                item(
                    icon = {
                        Icon(
                            imageVector = if (currentDestination == destination)
                                destination.selectedIcon else destination.unselectedIcon,
                            contentDescription = destination.label,
                        )
                    },
                    label = { Text(destination.label) },
                    selected = currentDestination == destination,
                    onClick = { currentDestination = destination },
                )
            }
        }
    ) {
        when (currentDestination) {
            NavDestination.Home -> HomeScreen(
                onNavigate = { currentDestination = it },
            )
            NavDestination.Cfo -> CfoScreen()
            NavDestination.Settings -> SettingsScreen()
        }
    }
}

/**
 * Previously every runtime permission (camera, mic, background location) was only ever
 * requested reactively, at the moment a specific feature first needed it — e.g. camera/mic
 * were requested from the panic button at the same instant the SOS was firing, too late for
 * that activation's own capture to use them. Requesting the whole set once, right when the
 * user first reaches the main app, means they're already granted by the time any feature
 * needs them. Re-launching costs nothing on later app opens — the system skips the dialog
 * for anything already granted.
 */
@Composable
private fun RequestCorePermissionsOnFirstLaunch() {
    val context = LocalContext.current
    var askedBackgroundLocation by rememberSaveable { mutableStateOf(false) }

    val backgroundLocationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* no-op — many OEMs route "Allow all the time" through Settings regardless of this dialog's outcome */ }

    val corePermissionsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val fineLocationGranted = results[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fineLocationGranted) {
            // GuardianService is started before this dialog is ever shown, and its
            // location registration no-ops without the permission. Poke the already-
            // running instance (onStartCommand) so it registers right now instead of
            // waiting for its internal retry tick.
            ContextCompat.startForegroundService(
                context, Intent(context, io.sonalit.guardian.service.GuardianService::class.java)
            )
        }
        if (fineLocationGranted && !askedBackgroundLocation && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            askedBackgroundLocation = true
            backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    LaunchedEffect(Unit) {
        val corePermissions = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACTIVITY_RECOGNITION)
        }
        val missing = corePermissions.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            corePermissionsLauncher.launch(missing.toTypedArray())
        } else if (!askedBackgroundLocation && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            askedBackgroundLocation = true
            backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }
}

/**
 * GuardianService (GPS buffering, and the volume-key SOS receiver registered
 * at runtime inside it) is only alive at all as long as
 * Android doesn't kill the process — and without this exemption, stock
 * Android's own Doze/App Standby, on top of most OEMs' much more aggressive
 * background-app killers (Xiaomi/MIUI, Oppo/ColorOS, Vivo, Huawei/EMUI
 * especially), will kill it after the app sits in the background a while.
 * The volume-key SOS then silently stops working with no visible symptom —
 * this is very likely why a previously-working triple-press stops firing
 * once the app hasn't been opened in a bit.
 *
 * This dialog only stops *stock Android's* battery management from killing
 * the service; it does not reach the OEM-specific "autostart"/"lock in
 * recents"/"battery saver whitelist" settings that MIUI/ColorOS/EMUI keep
 * entirely separate from the standard Android API — those still need to be
 * granted manually per-device and there's no universal API to request them.
 */
@Composable
private fun RequestBatteryOptimizationExemptionOnFirstLaunch() {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* no-op — re-checked via isIgnoringBatteryOptimizations on next launch regardless of result */ }

    LaunchedEffect(Unit) {
        val powerManager = context.getSystemService(android.os.PowerManager::class.java)
        if (powerManager?.isIgnoringBatteryOptimizations(context.packageName) == false) {
            runCatching {
                launcher.launch(
                    Intent(
                        android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        android.net.Uri.parse("package:${context.packageName}"),
                    )
                )
            }
        }
    }
}
