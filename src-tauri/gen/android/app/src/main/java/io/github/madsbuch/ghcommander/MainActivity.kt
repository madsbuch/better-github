package io.github.madsbuch.ghcommander

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private val theme by lazy { Theme(this) }
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android 15+ always lays apps out edge-to-edge. Keep the web content clear
    // of the status bar, navigation bar, display cutouts and the soft keyboard
    // by padding the content container with the current window insets. The
    // padded area shows the theme's window background (see values/themes.xml).
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    // Let the themed window background show until the page paints, avoiding a
    // white flash on startup in dark mode.
    webView.setBackgroundColor(Color.TRANSPARENT)
    // Runs before the first page load, so the page always sees the interface.
    webView.addJavascriptInterface(BrowserTabs(this), "GhCommanderAndroid")
    webView.addJavascriptInterface(Downloads(this), "GhCommanderDownloads")
    webView.addJavascriptInterface(theme, "GhCommanderTheme")
    this.webView = webView
  }

  // uiMode is in the manifest's configChanges, so switching the device between
  // light and dark lands here instead of recreating the activity. Tell the page,
  // which re-reads the setting from Theme.kt (see src/lib/theme.ts).
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (theme.onConfigurationChanged(newConfig)) {
      webView?.evaluateJavascript("window.dispatchEvent(new Event('ghc:systemtheme'))", null)
    }
  }
}
