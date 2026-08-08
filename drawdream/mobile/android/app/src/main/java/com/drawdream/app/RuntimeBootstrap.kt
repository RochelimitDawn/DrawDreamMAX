package com.drawdream.app

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

/**
 * 首次启动将 assets 中的 runtime（agent/ui）解压到版本化的外部私有目录。
 * Node 与共享库来自 nativeLibraryDir（jniLibs），可执行；files/ 在 Android 10+ 不可 exec。
 *
 * assets：
 *   runtime.zip — agent/、ui/、VERSION.json（不含 bin/lib）
 *   native-node.json — { "nodeJni": "libdrawdream_node.so" }
 */
object RuntimeBootstrap {
    private const val TAG = "RuntimeBootstrap"
    const val MARKER = "runtime.ready"
    /** schema=5：裁剪树（single.mjs + assets + .drawdream），不含 server/node_modules */
    private const val READY_SCHEMA = 5
    const val DEFAULT_NODE_JNI = "libdrawdream_node.so"

    private fun appStorage(ctx: Context): File =
        (ctx.getExternalFilesDir(null) ?: ctx.filesDir).also { it.mkdirs() }

    fun runtimeRoot(ctx: Context): File {
        val active = activeVersion(ctx)
        return if (active.isNullOrBlank()) {
            File(appStorage(ctx), "runtime/active")
        } else {
            File(appStorage(ctx), "runtime/releases/$active")
        }
    }

    /** 诊断：列出 releases 目录结构（排查缓存/清理问题）。 */
    fun runtimeInfo(ctx: Context): String {
        return try {
            val releases = File(runtimeBase(ctx), "releases")
            val list = if (releases.isDirectory) releases.list()?.sorted()?.joinToString() ?: "(empty)"
            else "(no releases dir)"
            "active=${activeVersion(ctx)} previous=${
                try {
                    val f = activeFile(ctx)
                    if (f.exists()) JSONObject(f.readText()).optString("previousVersion").ifBlank { "(none)" }
                    else "(no current.json)"
                } catch (_: Exception) { "(read fail)" }
            } releases=[$list]"
        } catch (e: Exception) {
            "runtimeInfo failed: ${e.message}"
        }
    }

    fun homeDir(ctx: Context): File = File(appStorage(ctx), "home").also { it.mkdirs() }

    fun dataRoot(ctx: Context): File = File(appStorage(ctx), "data").also { it.mkdirs() }

    private fun runtimeBase(ctx: Context): File = File(appStorage(ctx), "runtime").also { it.mkdirs() }

    private fun activeFile(ctx: Context): File = File(runtimeBase(ctx), "current.json")

    fun activeVersion(ctx: Context): String? = try {
        val file = activeFile(ctx)
        if (!file.exists()) null else JSONObject(file.readText()).optString("activeVersion").ifBlank { null }
    } catch (_: Exception) {
        null
    }

    fun activateVersion(ctx: Context, version: String): Boolean {
        val release = File(runtimeBase(ctx), "releases/$version")
        if (!File(release, MARKER).exists()) return false
        return try {
            activeFile(ctx).writeText(JSONObject().put("activeVersion", version).toString())
            true
        } catch (_: Exception) {
            false
        }
    }

    /** 清理过期的历史 runtime：保留 active 与上一个版本（回退用），删除更早的。 */
    fun pruneOldReleases(ctx: Context) {
        try {
            val base = runtimeBase(ctx)
            val releases = File(base, "releases")
            if (!releases.isDirectory) return
            val active = activeVersion(ctx)
            val previous = try {
                val f = activeFile(ctx)
                if (f.exists()) JSONObject(f.readText()).optString("previousVersion").ifBlank { null }
                else null
            } catch (_: Exception) {
                null
            }
            val keep = setOfNotNull(active, previous)
            releases.listFiles()?.forEach { dir ->
                if (dir.isDirectory && dir.name !in keep) {
                    dir.deleteRecursively()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "prune old releases failed", e)
        }
    }

    fun embeddedVersion(ctx: Context): String? = try {
        val input = ctx.assets.open("runtime.zip")
        ZipInputStream(input).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (entry.name == "VERSION.json") {
                    val output = ByteArrayOutputStream()
                    zip.copyTo(output)
                    return JSONObject(output.toString(Charsets.UTF_8.name())).optString("appVersion").ifBlank { null }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        null
    } catch (_: Exception) {
        null
    }

    fun embeddedRuntimeId(ctx: Context): String? = try {
        val input = ctx.assets.open("runtime.zip")
        ZipInputStream(input).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (entry.name == "VERSION.json") {
                    val output = ByteArrayOutputStream()
                    zip.copyTo(output)
                    return JSONObject(output.toString(Charsets.UTF_8.name()))
                        .optString("runtimeId")
                        .ifBlank { null }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        null
    } catch (_: Exception) {
        null
    }

    private fun embeddedRuntimeKey(ctx: Context): String =
        embeddedRuntimeId(ctx) ?: embeddedVersion(ctx) ?: "embedded"

    /** 把旧 APK 使用的 filesDir 数据复制到持久化目录，避免覆盖安装丢失数据。 */
    private fun migrateLegacyData(ctx: Context) {
        val targetData = dataRoot(ctx)
        val targetHome = homeDir(ctx)
        copyIfMissing(File(ctx.filesDir, "data"), targetData)
        copyIfMissing(File(ctx.filesDir, "home"), targetHome)
    }

    private fun copyIfMissing(source: File, target: File) {
        if (!source.exists() || target.exists() && target.listFiles()?.isNotEmpty() == true) return
        source.walkTopDown().forEach { item ->
            val relative = item.relativeTo(source)
            val destination = File(target, relative.path)
            if (item.isDirectory) destination.mkdirs()
            else if (!destination.exists()) {
                destination.parentFile?.mkdirs()
                item.inputStream().use { input -> destination.outputStream().use { input.copyTo(it) } }
            }
        }
    }

    fun nodeJniName(ctx: Context): String {
        return try {
            ctx.assets.open("native-node.json").bufferedReader().use { br ->
                val o = JSONObject(br.readText())
                o.optString("nodeJni", DEFAULT_NODE_JNI).ifBlank { DEFAULT_NODE_JNI }
            }
        } catch (_: Exception) {
            DEFAULT_NODE_JNI
        }
    }

    /** APK 解压后的可执行 Node（libdrawdream_node.so） */
    fun nativeNode(ctx: Context): File {
        val dir = ctx.applicationInfo.nativeLibraryDir
        return File(dir, nodeJniName(ctx))
    }

    fun nativeLibDir(ctx: Context): File = File(ctx.applicationInfo.nativeLibraryDir)

    fun isReady(ctx: Context): Boolean {
        val root = runtimeRoot(ctx)
        val marker = File(root, MARKER)
        val entry = File(root, "agent/mobile-entry.mjs")
        val single = File(root, "agent/single.mjs")
        val node = nativeNode(ctx)
        if (!marker.exists() || !entry.exists() || !single.exists() || !node.exists()) return false
        val schemaOk = try {
            marker.readText().contains("schema=$READY_SCHEMA")
        } catch (_: Exception) {
            false
        }
        if (!schemaOk) return false
        // 校验 single.mjs 是单文件 bundle（含 __DD_SINGLE_FILE_BUNDLE 标志）。
        // 覆盖安装若保留了旧版（tree-shaking 漏 typebox 等）的 runtime，
        // 该标志缺失 → 视为未就绪，强制解压 APK 内的新 runtime，
        // 避免旧损坏 runtime 一直占着 active 位置导致滚动更新失效。
        return try {
            single.readText().contains("__DD_SINGLE_FILE_BUNDLE")
        } catch (_: Exception) {
            false
        }
    }

    fun ensureReady(
        ctx: Context,
        onProgress: (String) -> Unit = {},
        forceExtract: Boolean = false,
    ): Result<File> {
        return try {
            migrateLegacyData(ctx)
            val root = runtimeRoot(ctx)
            val node = nativeNode(ctx)
            if (!node.exists()) {
                return Result.failure(
                    IllegalStateException(
                        "缺少原生 Node：${node.absolutePath}。" +
                            "请确认 APK 含 jniLibs/arm64-v8a/${nodeJniName(ctx)}（inject-android-assets）。",
                    ),
                )
            }
            if (!node.canExecute()) {
                // nativeLibraryDir 一般已是 755；仍尝试
                node.setExecutable(true, false)
            }

            val expectedRuntime = embeddedRuntimeKey(ctx)
            if (!forceExtract && isReady(ctx) && activeVersion(ctx) == expectedRuntime) {
                onProgress(ctx.getString(R.string.status_runtime_ready))
                // 每次启动顺带清理过期的历史 runtime（保留 active + previous）
                pruneOldReleases(ctx)
                return Result.success(root)
            }
            // 进入解压前：先清理历史 releases 释放空间，并校验可用空间，
            // 避免历史 runtime 累积占满存储后反复解压失败/卡在解压。
            pruneOldReleases(ctx)
            val usable = runCatching { runtimeBase(ctx).usableSpace }.getOrDefault(-1L)
            if (usable > 0 && usable < 64L * 1024 * 1024) {
                return Result.failure(
                    IllegalStateException(
                        "存储空间不足（可用 ${usable / (1024 * 1024)}MB，需约 64MB）。" +
                            "请清理存储后重试。",
                    ),
                )
            }
            onProgress(ctx.getString(R.string.status_extracting))
            val version = expectedRuntime
            val staged = File(runtimeBase(ctx), "staging-$version-${System.currentTimeMillis()}")
            if (staged.exists()) staged.deleteRecursively()
            staged.mkdirs()

            val am = ctx.assets
            val names = am.list("")?.toList().orEmpty()
            when {
                names.contains("runtime.zip") -> {
                    unzipAsset(ctx, "runtime.zip", staged, onProgress)
                }
                names.contains("runtime") -> {
                    onProgress(ctx.getString(R.string.status_copying))
                    copyAssetDir(ctx, "runtime", staged)
                }
                else -> {
                    writeDevPlaceholder(root)
                    return Result.failure(
                        IllegalStateException(
                            "assets 中缺少 runtime.zip。请运行 prepare-runtime + inject-android-assets。",
                        ),
                    )
                }
            }

            val entry = File(staged, "agent/mobile-entry.mjs")
            if (!entry.exists()) {
                return Result.failure(IllegalStateException("runtime.zip 解压后缺少 agent/mobile-entry.mjs"))
            }
            val requiredAfterExtract = listOf(
                "agent/mobile-entry.mjs",
                "agent/single.mjs",
                "agent/package.json",
                "agent/.drawdream/extensions/roleplay.ts",
                "ui/index.html",
            )
            val missing = requiredAfterExtract.filter { !File(staged, it).exists() }
            if (missing.isNotEmpty()) {
                return Result.failure(
                    IllegalStateException(
                        "runtime.zip 解压后缺少关键文件（多为 packages dist 未打入）：\n" +
                            missing.joinToString("\n") { "  - $it" },
                    ),
                )
            }
            // 清理旧版误解压的 bin/lib（不可执行，且易混淆）
            File(staged, "bin").deleteRecursively()
            File(staged, "lib").deleteRecursively()

            File(staged, MARKER).writeText(
                "ok schema=$READY_SCHEMA node=${node.absolutePath}\n",
            )
            val release = File(runtimeBase(ctx), "releases/$version")
            release.parentFile?.mkdirs()
            if (release.exists()) release.deleteRecursively()
            // renameTo 在同一文件系统内通常成功；失败（跨存储/个别 ROM）时回退为逐文件复制
            val moved = staged.renameTo(release)
            if (!moved) {
                release.mkdirs()
                staged.copyRecursively(release, overwrite = true)
                staged.deleteRecursively()
                if (!File(release, MARKER).exists()) {
                    throw IllegalStateException("无法安装 runtime $version（rename + copy 均失败）")
                }
            }
            val previous = activeVersion(ctx)
            val pointer = JSONObject().put("activeVersion", version)
            if (!previous.isNullOrBlank()) pointer.put("previousVersion", previous)
            activeFile(ctx).writeText(pointer.toString())
            pruneOldReleases(ctx)
            onProgress("Runtime extracted")
            Result.success(release)
        } catch (e: Exception) {
            Log.e(TAG, "bootstrap failed", e)
            Result.failure(e)
        }
    }

    /** 后台准备 APK 内的新 runtime；当前进程可继续使用旧版本。 */
    fun prepareUpdate(ctx: Context, onProgress: (String) -> Unit = {}): Result<File?> {
        val embedded = embeddedRuntimeKey(ctx)
        if (embedded == activeVersion(ctx) && isReady(ctx)) return Result.success(null)
        return ensureReady(ctx, onProgress, forceExtract = true).map { root -> root }
    }

    private fun writeDevPlaceholder(root: File) {
        root.mkdirs()
        File(root, "README.txt").writeText(
            "Need assets/runtime.zip (agent+ui) and jniLibs node. See mobile/README.md\n",
        )
    }

    private fun unzipAsset(
        ctx: Context,
        assetName: String,
        dest: File,
        onProgress: (String) -> Unit,
    ) {
        val started = SystemClock.elapsedRealtime()
        var files = 0
        var bytes = 0L
        var lastUi = 0L
        Log.i(TAG, "unzipAsset start: $assetName -> ${dest.absolutePath}")
        ctx.assets.open(assetName).use { input ->
            ZipInputStream(input).use { zis ->
                var entry = zis.nextEntry
                val buf = ByteArray(128 * 1024)
                while (entry != null) {
                    val name = entry.name
                    // 跳过旧 zip 里的 bin/lib（若有）
                    if (name == "bin" || name.startsWith("bin/") ||
                        name == "lib" || name.startsWith("lib/")
                    ) {
                        zis.closeEntry()
                        entry = zis.nextEntry
                        continue
                    }
                    val outFile = File(dest, name).canonicalFile
                    if (!outFile.path.startsWith(dest.canonicalPath + File.separator) &&
                        outFile.path != dest.canonicalPath
                    ) {
                        throw IllegalStateException("zip slip blocked: $name")
                    }
                    if (entry.isDirectory) {
                        outFile.mkdirs()
                    } else {
                        outFile.parentFile?.mkdirs()
                        FileOutputStream(outFile).use { fos ->
                            var n: Int
                            while (zis.read(buf).also { n = it } > 0) {
                                fos.write(buf, 0, n)
                                bytes += n
                            }
                        }
                        files++
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastUi > 400) {
                        lastUi = now
                        val mb = bytes / (1024.0 * 1024.0)
                        onProgress(
                            ctx.getString(R.string.status_extracting_progress, files, mb),
                        )
                    }
                }
            }
        }
        val sec = (SystemClock.elapsedRealtime() - started) / 1000.0
        onProgress(ctx.getString(R.string.status_extracted, files, sec))
    }

    private fun copyAssetDir(ctx: Context, assetPath: String, dest: File) {
        val list = ctx.assets.list(assetPath) ?: return
        if (list.isEmpty()) {
            ctx.assets.open(assetPath).use { input ->
                dest.parentFile?.mkdirs()
                FileOutputStream(dest).use { input.copyTo(it) }
            }
            return
        }
        dest.mkdirs()
        for (name in list) {
            val childAsset = "$assetPath/$name"
            val childDest = File(dest, name)
            val sub = ctx.assets.list(childAsset)
            if (sub != null && sub.isNotEmpty()) {
                copyAssetDir(ctx, childAsset, childDest)
            } else {
                ctx.assets.open(childAsset).use { input ->
                    childDest.parentFile?.mkdirs()
                    FileOutputStream(childDest).use { input.copyTo(it) }
                }
            }
        }
    }

    fun readVersion(ctx: Context): String {
        val f = File(runtimeRoot(ctx), "VERSION.json")
        if (!f.exists()) return "unknown"
        return try {
            val o = JSONObject(f.readText())
            o.optString("appVersion", "unknown")
        } catch (_: Exception) {
            "unknown"
        }
    }

    fun tailLog(ctx: Context, maxChars: Int = 2500): String {
        val logFile = File(appStorage(ctx), "logs/agent.log")
        if (!logFile.exists()) return "(no agent.log yet)"
        return try {
            val text = logFile.readText()
            if (text.length <= maxChars) text else text.takeLast(maxChars)
        } catch (e: Exception) {
            "(read log failed: ${e.message})"
        }
    }
}
