package io.sonalit.guardian

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
class MainActivity : ComponentActivity() {

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

    when {
        uiState.isEnrolled -> MainScaffold(viewModel = viewModel)
        else -> EnrollmentScreen(onEnrolled = { viewModel.markEnrolled() })
    }
}

@Composable
private fun MainScaffold(viewModel: MainViewModel) {
    var currentDestination by rememberSaveable { mutableStateOf(NavDestination.Home) }

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
            NavDestination.Home -> HomeScreen(onPanicClick = { viewModel.triggerPanic() })
            NavDestination.Cfo -> CfoScreen()
            NavDestination.Settings -> SettingsScreen()
        }
    }
}
