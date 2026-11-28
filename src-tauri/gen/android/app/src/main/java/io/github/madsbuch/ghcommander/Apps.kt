package io.github.madsbuch.ghcommander

import android.app.Activity
import android.app.DownloadManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * The apps installed on the device, and installing downloaded APKs through
 * Android's PackageInstaller, so Better GitHub becomes their installer of
 * record. On Android 12+ that lets later updates of those apps install without
 * a confirmation dialog (USER_ACTION_NOT_REQUIRED; Android decides).
 *
 * Exposed to the web view as `window.GhCommanderApps` (see src/lib/apps.ts).
 * Installs run in the background: `install` returns an id, and the page polls
 * `installStatus` with it.
 */
class Apps(private val activity: Activity) {
  private val packages: PackageManager get() = activity.packageManager
  private val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  private val worker = Executors.newSingleThreadExecutor()

  /** Every app the user installed (no system apps), as a JSON array. Needs QUERY_ALL_PACKAGES. */
  @JavascriptInterface
  fun installed(): String {
    val list = JSONArray()
    try {
      for (info in installedPackages()) {
        val app = info.applicationInfo ?: continue
        if (app.flags and ApplicationInfo.FLAG_SYSTEM != 0) continue
        list.put(JSONObject().apply {
          put("packageName", info.packageName)
          put("label", packages.getApplicationLabel(app).toString())
          put("versionName", info.versionName ?: "")
          put("versionCode", versionCode(info))
          put("lastUpdated", info.lastUpdateTime)
        })
      }
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't list installed apps", e)
    }
    return list.toString()
  }

  /** An app's launcher icon as a PNG data URL, or an empty string. */
  @JavascriptInterface
  fun icon(packageName: String): String {
    return try {
      val drawable = packages.getApplicationIcon(packageName)
      val size = (48 * activity.resources.displayMetrics.density).roundToInt().coerceIn(48, 192)
      val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      drawable.setBounds(0, 0, size, size)
      drawable.draw(Canvas(bitmap))
      val png = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, png)
      bitmap.recycle()
      "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
      ""
    }
  }

  /** Opens an installed app, after a user tap. */
  @JavascriptInterface
  fun launch(packageName: String): Boolean {
    return try {
      val intent = packages.getLaunchIntentForPackage(packageName) ?: return false
      activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't open $packageName", e)
      false
    }
  }

  /**
   * Installs a completed download (an APK) of this app's download manager.
   * Answers `{"result":"started","id":…}`, or a result without an id:
   * `permission_required`, `not_ready`, `missing` or `failed`.
   */
  @JavascriptInterface
  fun install(downloadId: String): String {
    val id = downloadId.toLongOrNull()?.takeIf { it > 0 } ?: return started("missing")
    return try {
      val status = downloadStatus(id) ?: return started("missing")
      if (status != DownloadManager.STATUS_SUCCESSFUL) return started("not_ready")
      val uri = downloads.getUriForDownloadedFile(id) ?: return started("missing")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packages.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
        return started("permission_required")
      }
      val token = UUID.randomUUID().toString()
      Installs.put(token, Installs.State("preparing"))
      worker.execute { runInstall(token, uri) }
      JSONObject().put("result", "started").put("id", token).toString()
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't start the installation", e)
      started("failed")
    }
  }

  /** `{"status": preparing | installing | waiting | installed | failed | cancelled | missing, …}`. */
  @JavascriptInterface
  fun installStatus(id: String): String {
    val state = Installs.get(id) ?: return JSONObject().put("status", "missing").toString()
    return JSONObject().apply {
      put("status", state.status)
      if (state.packageName != null) put("packageName", state.packageName)
      if (state.versionName != null) put("versionName", state.versionName)
      if (state.versionCode != null) put("versionCode", state.versionCode)
      if (state.message != null) put("message", state.message)
    }.toString()
  }

  private fun runInstall(token: String, uri: Uri) {
    // getPackageArchiveInfo needs a path, and the session needs the size up front.
    val file = File(activity.cacheDir, "install-$token.apk")
    try {
      val input = activity.contentResolver.openInputStream(uri)
      if (input == null) {
        Installs.finish(token, "failed", "The downloaded file was moved or deleted. Download it again.")
        return
      }
      input.use { source -> file.outputStream().use { source.copyTo(it) } }
      val archive = archiveInfo(file)
      if (archive == null) {
        Installs.finish(token, "failed", "This file isn't an Android app, or it is damaged. Download it again.")
        return
      }
      Installs.update(token) {
        it.copy(status = "installing", packageName = archive.packageName, versionName = archive.versionName, versionCode = versionCode(archive))
      }
      val installer = packages.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        setAppPackageName(archive.packageName)
        setSize(file.length())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
      }
      val sessionId = installer.createSession(params)
      installer.openSession(sessionId).use { session ->
        file.inputStream().use { source ->
          session.openWrite("base.apk", 0, file.length()).use { target ->
            source.copyTo(target)
            session.fsync(target)
          }
        }
        val result = Intent(activity, InstallResults::class.java)
          .setAction(InstallResults.ACTION)
          .putExtra(InstallResults.EXTRA_TOKEN, token)
        // The installer fills in the result extras, so the intent must be mutable (it is explicit).
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        session.commit(PendingIntent.getBroadcast(activity, sessionId, result, flags).intentSender)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't install the download", e)
      Installs.finish(token, "failed", "Android couldn't install it. Try again.")
    } finally {
      file.delete()
    }
  }

  private fun downloadStatus(id: Long): Int? {
    downloads.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      return cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
    }
    return null
  }

  @Suppress("DEPRECATION")
  private fun installedPackages(): List<PackageInfo> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packages.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
    } else {
      packages.getInstalledPackages(0)
    }

  @Suppress("DEPRECATION")
  private fun archiveInfo(file: File): PackageInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packages.getPackageArchiveInfo(file.path, PackageManager.PackageInfoFlags.of(0))
    } else {
      packages.getPackageArchiveInfo(file.path, 0)
    }

  private fun started(result: String): String = JSONObject().put("result", result).toString()

  private companion object {
    const val TAG = "Apps"

    @Suppress("DEPRECATION")
    fun versionCode(info: PackageInfo): Long =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
  }
}

/** Installations in progress and finished, by the id `Apps.install` handed out. Lost when the process ends. */
object Installs {
  data class State(
    val status: String,
    val packageName: String? = null,
    val versionName: String? = null,
    val versionCode: Long? = null,
    val message: String? = null,
  )

  private val states = ConcurrentHashMap<String, State>()

  fun put(token: String, state: State) {
    states[token] = state
  }

  fun get(token: String): State? = states[token]

  fun update(token: String, change: (State) -> State) {
    states.computeIfPresent(token) { _, state -> change(state) }
  }

  fun finish(token: String, status: String, message: String?) {
    update(token) { it.copy(status = status, message = message) }
  }
}

/** Receives PackageInstaller's verdicts on the sessions `Apps` commits. */
class InstallResults : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val token = intent.getStringExtra(EXTRA_TOKEN) ?: return
    when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = confirmation(intent)
        if (confirm == null) {
          Installs.finish(token, "failed", "Android didn't ask to confirm the installation. Try again.")
          return
        }
        Installs.update(token) { it.copy(status = "waiting") }
        try {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
          Log.w(TAG, "Couldn't show the installation dialog", e)
          Installs.finish(token, "failed", "Android couldn't show the installation dialog. Try again.")
        }
      }
      PackageInstaller.STATUS_SUCCESS -> Installs.finish(token, "installed", null)
      PackageInstaller.STATUS_FAILURE_ABORTED -> Installs.finish(token, "cancelled", null)
      else -> Installs.finish(token, "failed", failure(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)))
    }
  }

  @Suppress("DEPRECATION")
  private fun confirmation(intent: Intent): Intent? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
    } else {
      intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
    }

  private fun failure(status: Int, detail: String?): String = when (status) {
    PackageInstaller.STATUS_FAILURE_CONFLICT ->
      "It conflicts with the installed app: it is signed with a different key, or it is an older version. Uninstall the app to install this build."
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This build doesn't support this device."
    PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough storage space to install it. Free some space and try again."
    PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked the installation."
    PackageInstaller.STATUS_FAILURE_INVALID -> "The APK is invalid or damaged. Download it again."
    else -> if (detail.isNullOrBlank()) "Android couldn't install it." else "Android couldn't install it: $detail"
  }

  companion object {
    const val ACTION = "io.github.madsbuch.ghcommander.INSTALL_RESULT"
    const val EXTRA_TOKEN = "token"
    private const val TAG = "InstallResults"
  }
}
