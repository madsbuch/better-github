package io.github.madsbuch.ghcommander

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Hands downloads (release assets, source archives) to Android's download
 * manager, which shows progress in a notification, saves the file to
 * Downloads and opens it when tapped. The URL is a short-lived signed link
 * resolved in Rust (`gh_asset_url`), so no token is involved.
 *
 * Exposed to the web view as `window.GhCommanderDownloads` (see src/lib/downloads.ts).
 */
class Downloads(private val activity: Activity) {
  /** Returns false when it can't start, so the caller can fall back to a browser tab. */
  @JavascriptInterface
  fun download(url: String, fileName: String, mimeType: String): Boolean {
    val uri = Uri.parse(url)
    if (uri.scheme != "https") return false
    val name = safeFileName(fileName)
    return try {
      val request = DownloadManager.Request(uri)
        .setTitle(name)
        .setMimeType(mimeType.ifBlank { "application/octet-stream" })
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Android 10+ lets the download manager write to Downloads without a storage permission.
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
      } else {
        request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name)
      }
      val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      manager.enqueue(request)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't start the download", e)
      false
    }
  }

  private fun safeFileName(name: String): String {
    val cleaned = name.map { c -> if (c < ' ' || c in "\\/:*?\"<>|") '_' else c }.joinToString("").trim().trimStart('.')
    return cleaned.ifEmpty { "download" }.take(120)
  }

  private companion object {
    const val TAG = "Downloads"
  }
}
