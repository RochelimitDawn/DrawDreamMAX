package com.drawdream.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * 通过 GitHub Releases API 自动更新 APK：
 * - 检查仓库最新 release（tag v2.0.0-alpha.1-mobile.N，与 versionName 对齐）
 * - 下载 app-release.apk，用 SHA256SUMS.txt 校验后拉起系统安装器
 * 网络均在单线程后台执行，结果经回调回主线程。
 */
object AppUpdater {
    private const val REPO = "RochelimitDawn/DrawDreamMAX"
    private const val APK_ASSET = "app-release.apk"
    private const val SUMS_ASSET = "SHA256SUMS.txt"
    private const val UPDATE_DIR = "updates"

    private val exec = Executors.newSingleThreadExecutor { r ->
        Thread(r, "drawdream-updater").apply { isDaemon = true }
    }

    /** 更新检查结果 */
    data class UpdateInfo(
        val hasUpdate: Boolean,
        /** 最新 tag，如 v2.0.0-alpha.1-mobile.65 */
        val tagName: String,
        /** Release notes 正文 */
        val notes: String?,
        /** app-release.apk 下载地址（有更新时） */
        val downloadUrl: String?,
        /** SHA256SUMS.txt 下载地址（有更新时） */
        val sumsUrl: String?,
        /** 当前版本号（versionName） */
        val currentVersion: String,
    )

    /** 解析 `mobile.N` 中的 N；无匹配返回 null */
    fun parseVersion(version: String?): Int? {
        if (version.isNullOrBlank()) return null
        return Regex("mobile\\.(\\d+)").find(version)?.groupValues?.get(1)?.toIntOrNull()
    }

    /** 检查最新 release 并回调（主线程） */
    fun checkLatest(context: Context, onResult: (UpdateInfo) -> Unit) {
        exec.execute {
            val info = try {
                val body = httpGet("https://api.github.com/repos/$REPO/releases/latest")
                val json = JSONObject(body)
                val tag = json.optString("tag_name")
                val notes = json.optString("body").takeIf { it.isNotBlank() }
                val assets = json.optJSONArray("assets") ?: JSONArray()
                var apkUrl: String? = null
                var sumsUrl: String? = null
                for (i in 0 until assets.length()) {
                    val a = assets.optJSONObject(i) ?: continue
                    val name = a.optString("name")
                    val url = a.optString("browser_download_url").takeIf { it.isNotBlank() }
                    when (name) {
                        APK_ASSET -> apkUrl = url
                        SUMS_ASSET -> sumsUrl = url
                    }
                }
                val current = currentVersionName(context)
                val latestN = parseVersion(tag)
                val currentN = parseVersion(current)
                val hasUpdate = latestN != null && (currentN == null || latestN > currentN)
                UpdateInfo(hasUpdate, tag, notes, apkUrl, sumsUrl, current ?: "")
            } catch (e: Exception) {
                UpdateInfo(false, "", null, null, null, "")
            }
            onResult(info)
        }
    }

    /** 下载 APK → 校验 SHA256 → 拉起系统安装器；回调 (成功, 错误信息) */
    fun downloadAndInstall(
        context: Context,
        tagName: String,
        downloadUrl: String,
        sumsUrl: String?,
        onDone: (Boolean, String?) -> Unit,
    ) {
        exec.execute {
            try {
                val dir = File(context.cacheDir, UPDATE_DIR).apply { mkdirs() }
                val apk = File(dir, "app-$tagName.apk")
                httpDownload(downloadUrl, apk)

                // 校验：有 SHA256SUMS.txt 时对照，不匹配则拒绝安装
                if (!sumsUrl.isNullOrBlank()) {
                    val expected = fetchApkSha256(sumsUrl, APK_ASSET)
                    if (expected != null) {
                        val actual = sha256(apk)
                        if (!actual.equals(expected, ignoreCase = true)) {
                            apk.delete()
                            onDone(false, "SHA256 校验失败，已取消安装")
                            return@execute
                        }
                    }
                }

                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                onDone(true, null)
            } catch (e: Exception) {
                onDone(false, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** 当前 versionName（BuildConfig 或 PackageInfo） */
    private fun currentVersionName(context: Context): String? = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    } catch (e: Exception) {
        null
    }

    /** 从 SHA256SUMS.txt 文本解析目标文件的哈希 */
    private fun fetchApkSha256(sumsUrl: String, targetName: String): String? = try {
        val text = httpGet(sumsUrl)
        text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .firstOrNull { line ->
                line.endsWith(targetName) || line.contains("$targetName ")
            }
            ?.substringBefore(" ")
            ?.trim()
    } catch (e: Exception) {
        null
    }

    /** GET 文本（GitHub API / raw 下载） */
    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.setRequestProperty("User-Agent", "DrawDream-Android")
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            if (conn.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${conn.responseCode}")
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** 流式下载到文件 */
    private fun httpDownload(url: String, dest: File) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.setRequestProperty("User-Agent", "DrawDream-Android")
            conn.instanceFollowRedirects = true
            if (conn.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${conn.responseCode}")
            }
            conn.inputStream.use { input ->
                FileOutputStream(dest).use { out -> input.copyTo(out) }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
