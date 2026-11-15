package io.github.madsbuch.ghcommander

import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import org.json.JSONObject
import java.io.FileNotFoundException
import java.util.Locale
import java.util.UUID

/**
 * Hands downloads (release assets, source archives) to Android's download
 * manager. The page keeps the returned ID, polls status, and explicitly opens
 * the completed file through its content URI. The URL is a short-lived signed
 * link resolved in Rust (`gh_asset_url`), so no token is involved.
 *
 * Exposed to the web view as `window.GhCommanderDownloads` (see src/lib/downloads.ts).
 */
class Downloads(private val activity: Activity) {
  private val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  /** Kept for pages using the original bridge. New pages use enqueue to track completion. */
  @JavascriptInterface
  fun download(url: String, fileName: String, mimeType: String): Boolean =
    enqueue(url, fileName, mimeType).isNotEmpty()

  /** Decimal ID (not a JS number), or an empty string if nothing was enqueued. */
  @JavascriptInterface
  fun enqueue(url: String, fileName: String, mimeType: String): String {
    return try {
      val uri = Uri.parse(url)
      if (uri.scheme != "https") return ""
      val name = safeFileName(fileName)
      // DownloadManager refuses to overwrite a file. Give each attempt a unique
      // destination so downloading a newer release with the same name works.
      val destination = "${UUID.randomUUID()}-$name"
      val request = DownloadManager.Request(uri)
        .setTitle(name)
        .setMimeType(contentType(fileName, mimeType))
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Android 10+ lets the download manager write to Downloads without a storage permission.
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, destination)
      } else {
        request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, destination)
      }
      manager.enqueue(request).toString()
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't start the download", e)
      ""
    }
  }

  /** Only public status fields cross the bridge; never the signed URL or filesystem path. */
  @JavascriptInterface
  fun status(id: String): String {
    val downloadId = id.toLongOrNull()?.takeIf { it > 0 } ?: return result("missing")
    return try {
      val info = query(downloadId) ?: return result("missing")
      val state = when (info.status) {
        DownloadManager.STATUS_PENDING -> "pending"
        DownloadManager.STATUS_RUNNING -> "running"
        DownloadManager.STATUS_PAUSED -> "paused"
        DownloadManager.STATUS_SUCCESSFUL -> "successful"
        DownloadManager.STATUS_FAILED -> "failed"
        else -> "pending"
      }
      result(state, info.downloadedBytes, info.totalBytes, reason(info))
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't read download status", e)
      // A temporary query failure must not make the page enqueue a duplicate.
      result("paused", reason = "Couldn't read download progress. Trying again…")
    }
  }

  /** Opens only a completed download belonging to this app, after a user tap. */
  @JavascriptInterface
  fun open(id: String): String {
    val downloadId = id.toLongOrNull()?.takeIf { it > 0 } ?: return "missing"
    return try {
      val info = query(downloadId) ?: return "missing"
      if (info.status != DownloadManager.STATUS_SUCCESSFUL) return "not_ready"
      val uri = manager.getUriForDownloadedFile(downloadId) ?: return "missing"
      // A completed DownloadManager row can outlive a file deleted in Files.
      val descriptor = activity.contentResolver.openFileDescriptor(uri, "r") ?: return "missing"
      descriptor.close()
      val mime = contentType(info.name, info.mimeType)
      if (mime == APK_MIME && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && !activity.packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
        return "permission_required"
      }
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(info.name, uri)
      }
      // Don't preflight with resolveActivity: package visibility can hide a
      // perfectly valid viewer/installer on Android 11+. Try the launch itself.
      activity.startActivity(intent)
      "opened"
    } catch (e: FileNotFoundException) {
      "missing"
    } catch (e: ActivityNotFoundException) {
      "no_handler"
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't open the download", e)
      "failed"
    }
  }

  private data class DownloadInfo(
    val status: Int,
    val downloadedBytes: Long,
    val totalBytes: Long,
    val reason: Int,
    val name: String,
    val mimeType: String,
  )

  private fun query(id: Long): DownloadInfo? {
    manager.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      return DownloadInfo(
        cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
        cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
        cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)).orEmpty(),
        cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE)).orEmpty(),
      )
    }
    return null
  }

  private fun result(status: String, downloadedBytes: Long = 0, totalBytes: Long = -1, reason: String? = null): String =
    JSONObject().apply {
      put("status", status)
      put("downloadedBytes", downloadedBytes)
      put("totalBytes", totalBytes)
      if (reason != null) put("reason", reason)
    }.toString()

  private fun reason(info: DownloadInfo): String? = when (info.status) {
    DownloadManager.STATUS_PAUSED -> when (info.reason) {
      DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "Waiting for a network connection."
      DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "Waiting for Wi-Fi."
      DownloadManager.PAUSED_WAITING_TO_RETRY -> "Waiting to retry the download."
      else -> "Download paused. Android will resume it when possible."
    }
    DownloadManager.STATUS_FAILED -> when (info.reason) {
      DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Not enough storage space. Free some space and try again."
      DownloadManager.ERROR_DEVICE_NOT_FOUND -> "Download storage is unavailable."
      DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "A file with that name already exists. Try downloading again."
      DownloadManager.ERROR_CANNOT_RESUME -> "The download was interrupted and couldn't resume. Try again."
      DownloadManager.ERROR_FILE_ERROR -> "Android couldn't save the downloaded file."
      in 400..599 -> "The server rejected the download (HTTP ${info.reason}). Try again for a fresh link."
      else -> "The download failed. Try again."
    }
    else -> null
  }

  private fun contentType(name: String, declared: String): String {
    val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
    // Release APIs often label APKs application/octet-stream. The installer
    // needs the APK MIME type even when that metadata is generic or incorrect.
    if (extension == "apk") return APK_MIME
    val mime = declared.substringBefore(';').trim()
    if (mime.isNotEmpty() && mime != "application/octet-stream") return mime
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
  }

  private fun safeFileName(name: String): String {
    val cleaned = name.map { c -> if (c < ' ' || c in "\\/:*?\"<>|") '_' else c }.joinToString("").trim().trimStart('.')
    return cleaned.ifEmpty { "download" }.take(120)
  }

  private companion object {
    const val TAG = "Downloads"
    const val APK_MIME = "application/vnd.android.package-archive"
  }
}
