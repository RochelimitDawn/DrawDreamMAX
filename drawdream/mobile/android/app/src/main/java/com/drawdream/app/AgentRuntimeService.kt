package com.drawdream.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * 前台服务：启动 / 保活本机 Node Agent（127.0.0.1:7620）。
 */
class AgentRuntimeService : Service() {
    companion object {
        const val CHANNEL_ID = "drawdream_agent"
        const val NOTIF_ID = 7620
        const val ACTION_START = "com.drawdream.app.START_AGENT"
        const val ACTION_STOP = "com.drawdream.app.STOP_AGENT"
        const val EXTRA_STATUS = "status"
        const val EXTRA_DETAIL = "detail"
        const val ACTION_STATUS = "com.drawdream.app.AGENT_STATUS"
        const val ACTION_READY = "com.drawdream.app.AGENT_READY"

        const val PORT = 7620
        private const val TAG = "AgentRuntime"

        @Volatile
        var lastStatus: String = "idle"
            private set

        @Volatile
        var lastDetail: String = ""
            private set

        @Volatile
        var lastError: String? = null
            private set

        fun start(ctx: Context) {
            val i = Intent(ctx, AgentRuntimeService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(ctx, i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, AgentRuntimeService::class.java).setAction(ACTION_STOP))
        }
    }

    private var process: Process? = null
    private val running = AtomicBoolean(false)
    private var logThread: Thread? = null
    private var watchThread: Thread? = null
    private var bootstrapThread: Thread? = null
    private var updateThread: Thread? = null
    @Volatile private var stopping = false
    @Volatile private var switchingRuntime = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopping = true
                stopAgent()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                // 必须尽快 startForeground，避免 ANR / 被系统杀
                startForeground(NOTIF_ID, buildNotification(getString(R.string.status_preparing)))
                if (bootstrapThread?.isAlive != true) {
                    bootstrapThread = thread(name = "agent-bootstrap") {
                        bootstrapAndStart()
                    }
                }
            }
        }
        return START_STICKY
    }

    private fun bootstrapAndStart() {
        stopping = false
        setStatus("preparing", getString(R.string.status_preparing))
        val boot = RuntimeBootstrap.ensureReady(
            this,
            onProgress = { msg ->
                Log.i(TAG, msg)
                setStatus("preparing", msg)
                updateNotification(msg)
            },
        )
        if (boot.isFailure) {
            val err = boot.exceptionOrNull()
            lastError = err?.message ?: "bootstrap failed"
            Log.e(TAG, "bootstrap failed", err)
            setStatus("error", lastError!!)
            updateNotification(getString(R.string.status_error))
            return
        }
        if (!stopping) {
            // 覆盖安装后旧 Node 进程可能仍存活，必须重启进程加载新 runtime。
            if (running.get() || process?.isAlive == true) stopAgent()
            startNodeProcess()
        }
    }

    private fun startNodeProcess() {
        if (running.get() && process?.isAlive == true) {
            Log.i(TAG, "already running")
            setStatus("starting", getString(R.string.status_agent_running))
            thread(name = "agent-reprobe") { waitUntilHealthy(timeoutMs = 30_000) }
            return
        }
        running.set(true)
        try {
            val root = RuntimeBootstrap.runtimeRoot(this)
            // Android 10+：files/ 不可执行；Node 必须从 nativeLibraryDir（jniLibs）启动
            val node = RuntimeBootstrap.nativeNode(this)
            val libDir = RuntimeBootstrap.nativeLibDir(this)
            val entry = File(root, "agent/mobile-entry.mjs")
            val home = RuntimeBootstrap.homeDir(this)
            val data = RuntimeBootstrap.dataRoot(this)
            val storage = getExternalFilesDir(null) ?: filesDir
            val logDir = File(storage, "logs").also { it.mkdirs() }
            val logFile = File(logDir, "agent.log")

            if (!node.exists()) {
                throw IllegalStateException(
                    "native node missing: ${node.absolutePath} (nativeLibraryDir=${libDir.absolutePath})",
                )
            }
            if (!entry.exists()) {
                throw IllegalStateException("mobile-entry.mjs missing under ${root.absolutePath}")
            }

            fun applyNativeEnv(env: MutableMap<String, String>) {
                env["HOME"] = home.absolutePath
                env["TMPDIR"] = cacheDir.absolutePath
                // 依赖 so 与 node 同目录（jniLibs 解压后）
                val prev = env["LD_LIBRARY_PATH"] ?: ""
                env["LD_LIBRARY_PATH"] =
                    if (prev.isBlank()) libDir.absolutePath else libDir.absolutePath + ":" + prev
            }

            // 启动前自检：能否 exec jni Node
            val selfCheck = try {
                val pb0 = ProcessBuilder(node.absolutePath, "-e", "console.log('node-ok', process.version)")
                    .directory(libDir)
                    .redirectErrorStream(true)
                applyNativeEnv(pb0.environment())
                val p0 = pb0.start()
                val out = p0.inputStream.bufferedReader().readText()
                val code = p0.waitFor()
                Pair(code, out.trim())
            } catch (e: Exception) {
                Pair(-1, e.message ?: "self-check exception")
            }
            Log.i(TAG, "node self-check path=${node.absolutePath} code=${selfCheck.first} out=${selfCheck.second}")
            if (selfCheck.first != 0 || !selfCheck.second.contains("node-ok")) {
                val listing = libDir.list()?.take(12)?.joinToString() ?: "(empty)"
                throw IllegalStateException(
                    "Node 无法执行 (code=${selfCheck.first}): ${selfCheck.second}\n" +
                        "path=${node.absolutePath}\nnativeLibs sample: $listing",
                )
            }

            setStatus("starting", getString(R.string.status_starting_node, selfCheck.second))
            updateNotification(getString(R.string.status_starting))

            val pb = ProcessBuilder(
                node.absolutePath,
                entry.absolutePath,
            ).directory(File(root, "agent"))

            val env = pb.environment()
            applyNativeEnv(env)
            env["HOST"] = "127.0.0.1"
            env["PORT"] = PORT.toString()
            env["DRAWDREAM_UI_DIST"] = File(root, "ui").absolutePath
            env["DRAWDREAM_SKIP_BUILTIN_MODELS"] = "1"
            env["DRAWDREAM_CODING_AGENT_DIR"] = File(home, ".drawdream/agent").absolutePath
            env["DD_DATA_ROOT"] = data.absolutePath
            // 单机 APK：单用户模式，前端自动本地会话，不走登录页
            env["DD_AUTH_MODE"] = "single"
            env["DD_ALLOW_REGISTER"] = "0"
            env["npm_config_cache"] = File(cacheDir, "npm").absolutePath

            pb.redirectErrorStream(true)
            // 清空旧日志
            logFile.writeText("=== agent start ${System.currentTimeMillis()} ===\n")
            logFile.appendText("self-check: ${selfCheck.second}\n")
            val p = pb.start()
            process = p

            logThread = thread(name = "agent-log") {
                try {
                    BufferedReader(InputStreamReader(p.inputStream)).use { br ->
                        java.io.FileOutputStream(logFile, true).bufferedWriter(Charsets.UTF_8).use { w ->
                            var line: String?
                            while (br.readLine().also { line = it } != null) {
                                val l = line ?: ""
                                w.appendLine(l)
                                w.flush()
                                Log.d(TAG, l)
                                if (l.contains("listening") || l.contains("7620") ||
                                    l.contains("[mobile-entry]") || l.contains("Error")
                                ) {
                                    setStatus(lastStatus, l.take(200))
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "log pump end", e)
                }
            }

            watchThread = thread(name = "agent-watch") {
                waitUntilHealthy(timeoutMs = 120_000)
                if (!stopping) scheduleRuntimeUpdate()
                val code = try {
                    p.waitFor()
                } catch (_: Exception) {
                    -1
                }
                running.set(false)
                if (!stopping && !switchingRuntime && code != 0) {
                    val tail = RuntimeBootstrap.tailLog(this@AgentRuntimeService, 800)
                    lastError = "agent exited code=$code\n$tail"
                    setStatus("error", lastError!!)
                    updateNotification(getString(R.string.status_error))
                    Thread.sleep(3_000)
                    if (!stopping) {
                        startNodeProcess()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "start failed", e)
            lastError = e.message
            running.set(false)
            setStatus("error", e.message ?: getString(R.string.status_error))
            updateNotification(getString(R.string.status_error))
        }
    }

    /** 先让当前 runtime 提供服务，再在后台准备 APK 内的新 runtime。 */
    private fun scheduleRuntimeUpdate() {
        if (updateThread?.isAlive == true) return
        updateThread = thread(name = "runtime-update") {
            val current = RuntimeBootstrap.activeVersion(this@AgentRuntimeService)
            val result = RuntimeBootstrap.prepareUpdate(this@AgentRuntimeService) { msg ->
                Log.i(TAG, "background update: $msg")
            }
            if (stopping || result.isFailure || result.getOrNull() == null) return@thread
            val next = RuntimeBootstrap.activeVersion(this@AgentRuntimeService)
            if (next.isNullOrBlank() || next == current) return@thread
            Log.i(TAG, "switch runtime $current -> $next")
            switchingRuntime = true
            stopAgent()
            if (!stopping) {
                startNodeProcess()
                thread(name = "runtime-switch-check") {
                    waitUntilHealthy(timeoutMs = 20_000)
                    if (lastStatus == "error" && !stopping && !current.isNullOrBlank()) {
                        Log.w(TAG, "new runtime failed; rolling back to $current")
                        RuntimeBootstrap.activateVersion(this@AgentRuntimeService, current)
                        stopAgent()
                        if (!stopping) startNodeProcess()
                    }
                    switchingRuntime = false
                }
            }
        }
    }

    private fun waitUntilHealthy(timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        var n = 0
        while (System.currentTimeMillis() < deadline && !stopping) {
            if (probeHealth()) {
                lastError = null
                setStatus("ready", getString(R.string.status_ready))
                updateNotification(getString(R.string.status_ready))
                sendBroadcast(Intent(ACTION_READY).setPackage(packageName))
                return
            }
            n++
            if (n % 5 == 0) {
                setStatus("starting", getString(R.string.status_waiting_health, n * 400))
            }
            // 进程已死则提前失败
            val p = process
            if (p != null && !p.isAlive) {
                val tail = RuntimeBootstrap.tailLog(this, 1200)
                lastError = "agent process died before healthz\n$tail"
                setStatus("error", lastError!!)
                updateNotification(getString(R.string.status_error))
                return
            }
            Thread.sleep(400)
        }
        if (stopping) return
        val tail = RuntimeBootstrap.tailLog(this, 1200)
        lastError = "healthz timeout\n$tail"
        setStatus("error", lastError!!)
        updateNotification(getString(R.string.status_error))
    }

    private fun probeHealth(): Boolean {
        return try {
            val url = URL("http://127.0.0.1:$PORT/healthz")
            val c = url.openConnection() as HttpURLConnection
            c.connectTimeout = 800
            c.readTimeout = 800
            c.requestMethod = "GET"
            val code = c.responseCode
            c.disconnect()
            code == 200
        } catch (_: Exception) {
            false
        }
    }

    private fun stopAgent() {
        running.set(false)
        try {
            process?.destroy()
            process?.waitFor()
        } catch (_: Exception) {
        }
        try {
            process?.destroyForcibly()
        } catch (_: Exception) {
        }
        process = null
        setStatus("stopped", getString(R.string.status_stopped))
    }

    override fun onDestroy() {
        stopping = true
        stopAgent()
        super.onDestroy()
    }

    private fun setStatus(s: String, detail: String = s) {
        lastStatus = s
        lastDetail = detail
        if (s == "error") lastError = detail
        val i = Intent(ACTION_STATUS)
            .setPackage(packageName)
            .putExtra(EXTRA_STATUS, s)
            .putExtra(EXTRA_DETAIL, detail)
        sendBroadcast(i)
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.agent_notification_title))
            .setContentText(text.take(80))
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }
}
