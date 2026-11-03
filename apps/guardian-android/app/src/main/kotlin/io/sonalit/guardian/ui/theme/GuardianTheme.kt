package io.sonalit.guardian.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFD97706),
    onPrimary = Color(0xFF1A2235),
    primaryContainer = Color(0xFF92400E),
    onPrimaryContainer = Color(0xFFFEF3C7),
    secondary = Color(0xFF60A5FA),
    onSecondary = Color(0xFF1A2235),
    background = Color(0xFF0B0F1A),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1F2937),
    onSurfaceVariant = Color(0xFF9CA3AF),
    error = Color(0xFFEF4444),
    onError = Color(0xFF1A2235),
)

// Heavier weights across the board — the stock M3 defaults read too quiet for
// a field app operators glance at in bright sunlight or in a hurry.
private val BaseTypography = Typography()
private val BoldTypography = Typography(
    headlineLarge = BaseTypography.headlineLarge.copy(fontWeight = FontWeight.ExtraBold),
    headlineMedium = BaseTypography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
    headlineSmall = BaseTypography.headlineSmall.copy(fontWeight = FontWeight.Bold),
    titleLarge = BaseTypography.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = BaseTypography.titleMedium.copy(fontWeight = FontWeight.Bold),
    titleSmall = BaseTypography.titleSmall.copy(fontWeight = FontWeight.Bold),
    bodyLarge = BaseTypography.bodyLarge.copy(fontWeight = FontWeight.Medium),
    bodyMedium = BaseTypography.bodyMedium.copy(fontWeight = FontWeight.Medium),
    labelLarge = BaseTypography.labelLarge.copy(fontWeight = FontWeight.Bold),
    labelMedium = BaseTypography.labelMedium.copy(fontWeight = FontWeight.Bold),
    labelSmall = BaseTypography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
)

@Composable
fun GuardianTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = BoldTypography,
        content = content,
    )
}
