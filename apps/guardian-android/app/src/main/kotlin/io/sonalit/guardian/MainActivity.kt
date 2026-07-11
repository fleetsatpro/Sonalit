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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
            else -> EnrollmentScreen(onEnrolled = { viewModel.markEnrolled() })
        }
    }
}

@Composable
private fun MainScaffold() {
    var currentDestination by rememberSaveable { mutableStateOf(NavDestination.Home) }
    RequestCorePermissionsOnFirstLaunch()

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
