package io.github.madsbuch.ghcommander

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService

/**
 * Opens web pages in a browser tab inside the app (a Custom Tab) that is pinned
 * to a browser. The opener plugin's Custom Tab intent names no app, so Android
 * hands the link to any app that claims it: with GitHub's own app installed,
 * github.com links, the sign-in page included, would open GitHub's app instead.
 *
 * Exposed to the web view as `window.GhCommanderAndroid` (see src/lib/backend.ts).
 */
class BrowserTabs(private val activity: Activity) {
  /** Returns false when it can't handle the link, so the caller falls back to the opener plugin. */
  @JavascriptInterface
  fun openBrowserTab(url: String): Boolean {
    val uri = Uri.parse(url)
    if (uri.scheme != "https") return false
    val browser = customTabsBrowser() ?: return false
    activity.runOnUiThread {
      val tab = CustomTabsIntent.Builder().build()
      tab.intent.setPackage(browser)
      try {
        tab.launchUrl(activity, uri)
      } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "$browser could not open the link", e)
      }
    }
    return true
  }

  /** The default browser if it supports Custom Tabs, otherwise any browser that does. */
  @Suppress("DEPRECATION")
  private fun customTabsBrowser(): String? =
    CustomTabsClient.getPackageName(activity, null)
      ?: activity.packageManager
        .queryIntentServices(Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION), 0)
        .firstOrNull()?.serviceInfo?.packageName

  private companion object {
    const val TAG = "BrowserTabs"
  }
}
