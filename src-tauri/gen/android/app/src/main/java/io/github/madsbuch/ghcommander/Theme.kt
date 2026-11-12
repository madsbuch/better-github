package io.github.madsbuch.ghcommander

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.webkit.JavascriptInterface
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

/**
 * Light and dark theme. The page picks the theme (src/lib/theme.ts): it asks
 * here for the device setting, because the web view's prefers-color-scheme
 * isn't reliable and doesn't change while the app is open (MainActivity
 * handles uiMode changes itself, so it isn't recreated). MainActivity tells
 * the page when the setting changes. The page then hands its choice back, and
 * the window background behind the system bars and their icons follow it, also
 * when the Theme setting overrides the device.
 *
 * Exposed to the web view as `window.GhCommanderTheme`.
 */
class Theme(private val activity: ComponentActivity) {
  @Volatile
  private var systemDark = isDark(activity.resources.configuration)

  fun onConfigurationChanged(config: Configuration): Boolean {
    val dark = isDark(config)
    val changed = dark != systemDark
    systemDark = dark
    return changed
  }

  @JavascriptInterface
  fun systemDark(): Boolean = systemDark

  @JavascriptInterface
  fun apply(dark: Boolean) {
    activity.runOnUiThread {
      // Keep in sync with --bg in src/styles/theme.css.
      activity.window.setBackgroundDrawable(ColorDrawable(if (dark) DARK_BG else LIGHT_BG))
      val style =
        if (dark) SystemBarStyle.dark(Color.TRANSPARENT)
        else SystemBarStyle.light(Color.TRANSPARENT, LIGHT_SCRIM)
      activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
  }

  private companion object {
    const val DARK_BG = 0xFF0D1117.toInt()
    const val LIGHT_BG = 0xFFFFFFFF.toInt()
    // Behind the navigation bar on Android 7, which can't draw dark icons.
    const val LIGHT_SCRIM = 0x801B1B1B.toInt()

    fun isDark(config: Configuration) =
      config.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
  }
}
