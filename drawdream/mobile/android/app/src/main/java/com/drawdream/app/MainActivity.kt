package com.drawdream.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.animation.AnimationUtils
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var splash: View
    private lateinit var splashLog: android.widget.LinearLayout
    private lateinit var logScroller: android.widget.ScrollView
    private lateinit var statusLabel: TextView
    private lateinit var gridOverlay: View
    private lateinit var gridFadeMask: View
    private lateinit var splashTitle: TextView
    private lateinit var splashTagline: TextView
    private lateinit var splashFooter: TextView
    private lateinit var splashProgress: ProgressBar
    private var loaded = false
    private val handler = Handler(Looper.getMainLooper())
    private var lastLogText = ""

    /** 入场动画主题（浅/深），跟随设置里的主题设置 */
    private val prefs: SharedPreferences by lazy {
        getSharedPreferences("drawdream_theme", Context.MODE_PRIVATE)
    }

    /** <input type="file"> 回调；未处理时 WebView 上导入按钮无任何反应 */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val poll = object : Runnable {
        override fun run() {
            if (loaded || isFinishing) return
            val st = AgentRuntimeService.lastStatus
            val detail = AgentRuntimeService.lastDetail.ifBlank {
                AgentRuntimeService.lastError.orEmpty()
            }
            applyStatus(st, detail)
            handler.postDelayed(this, 500)
        }
    }

    private val notifPerm = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* optional */ }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return@registerForActivityResult

        val uris: Array<Uri>? = when {
            result.resultCode != Activity.RESULT_OK -> null
            result.data == null -> null
            result.data?.clipData != null -> {
                val clip = result.data!!.clipData!!
                Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
            }
            result.data?.data != null -> arrayOf(result.data!!.data!!)
            else -> null
        }
        cb.onReceiveValue(uris)
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val st = intent?.getStringExtra(AgentRuntimeService.EXTRA_STATUS)
                ?: AgentRuntimeService.lastStatus
            val detail = intent?.getStringExtra(AgentRuntimeService.EXTRA_DETAIL)
                ?: AgentRuntimeService.lastDetail
            runOnUiThread { applyStatus(st, detail) }
        }
    }

    private val readyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            runOnUiThread {
                if (loaded) webView.reload() else openUi()
            }
        }
    }

    /** JS → Kotlin：blob / data URL 导出落盘 */
    inner class DrawDreamBridge {
        @JavascriptInterface
        fun saveDataUrl(dataUrl: String?, filename: String?, mimeHint: String?) {
            if (dataUrl.isNullOrBlank()) return
            handler.post {
                try {
                    saveDataUrlToDownloads(dataUrl, filename.orEmpty(), mimeHint.orEmpty())
                } catch (e: Exception) {
                    toast("保存失败：${e.message ?: e.javaClass.simpleName}")
                }
            }
        }

        @JavascriptInterface
        fun checkUpdate() {
            AppUpdater.checkLatest(this@MainActivity) { info ->
                handler.post { deliverUpdateResult(info) }
            }
        }

        @JavascriptInterface
        fun downloadUpdate(tagName: String?, downloadUrl: String?, sumsUrl: String?) {
            if (tagName.isNullOrBlank() || downloadUrl.isNullOrBlank()) {
                toast("更新信息不完整")
                return
            }
            AppUpdater.downloadAndInstall(
                this@MainActivity,
                tagName,
                downloadUrl,
                sumsUrl,
                onProgress = { p ->
                    handler.post { deliverUpdateProgress(p) }
                },
                onDone = { ok, err ->
                    handler.post { deliverUpdateDone(ok, err) }
                },
            )
        }

        @JavascriptInterface
        fun cancelUpdate() {
            AppUpdater.cancelUpdate()
        }

        @JavascriptInterface
        fun setTheme(mode: String?) {
            val t = mode?.trim()?.lowercase(Locale.ROOT)
            val resolved = if (t == "dark" || t == "light") t else if (t == "system") {
                when (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) {
                    android.content.res.Configuration.UI_MODE_NIGHT_YES -> "dark"
                    else -> "light"
                }
            } else "light"
            prefs.edit().putString("theme", resolved).apply()
            handler.post { applySplashTheme(resolved) }
        }
    }

    /** 入场动画主题切换：暖金背景 + 网格 + 文字色跟随浅色/深色 */
    private fun applySplashTheme(mode: String) {
        val dark = mode == "dark"
        val rootView = findViewById<android.widget.FrameLayout>(R.id.root)
        rootView.setBackgroundResource(if (dark) R.drawable.splash_bg_dark else R.drawable.splash_bg_light)
        if (this::gridOverlay.isInitialized) {
            gridOverlay.setBackgroundResource(if (dark) R.drawable.grid_overlay_dark else R.drawable.grid_overlay_light)
        }
        if (this::gridFadeMask.isInitialized) {
            gridFadeMask.setBackgroundResource(if (dark) R.drawable.grid_fade_mask_dark else R.drawable.grid_fade_mask_light)
        }
        splashTitle.setTextColor(Color.parseColor(if (dark) "#E0B06A" else "#8B5124"))
        splashTagline.setTextColor(Color.parseColor(if (dark) "#B8A894" else "#8A7660"))
        splashFooter.setTextColor(Color.parseColor(if (dark) "#8A7B68" else "#B8A894"))
        splashProgress.indeterminateTintList = android.content.res.ColorStateList.valueOf(
            Color.parseColor(if (dark) "#E0B06A" else "#C47A3A"),
        )
    }

    /** 下载进度回传 JS（window.__ddUpdateProgress，百分比 0-100） */
    private fun deliverUpdateProgress(p: Float) {
        val pct = (p * 100).toInt().coerceIn(0, 100)
        webView.evaluateJavascript(
            "window.__ddUpdateProgress && window.__ddUpdateProgress($pct);",
            null,
        )
    }

    /** 下载完成回传 JS（window.__ddUpdateDownloadDone） */
    private fun deliverUpdateDone(ok: Boolean, err: String?) {
        val msgJson = org.json.JSONObject.quote(err ?: "")
        webView.evaluateJavascript(
            "window.__ddUpdateDownloadDone && window.__ddUpdateDownloadDone($ok, $msgJson);",
            null,
        )
    }

    /** 把更新检查结果回传给 JS（window.__ddUpdateResult） */
    private fun deliverUpdateResult(info: AppUpdater.UpdateInfo) {
        val obj = org.json.JSONObject().apply {
            put("hasUpdate", info.hasUpdate)
            put("tagName", info.tagName)
            put("notes", info.notes ?: "")
            put("downloadUrl", info.downloadUrl ?: "")
            put("sumsUrl", info.sumsUrl ?: "")
            put("currentVersion", info.currentVersion)
        }
        webView.evaluateJavascript(
            "window.__ddUpdateResult && window.__ddUpdateResult(${obj.toString()});",
            null,
        )
    }

    /** 启动后延迟自动检查更新（页面加载后触发；失败静默） */
    private fun scheduleAutoUpdateCheck() {
        handler.postDelayed({
            if (this::webView.isInitialized) {
                AppUpdater.checkLatest(this@MainActivity) { info ->
                    handler.post {
                        if (info.hasUpdate) deliverUpdateResult(info)
                    }
                }
            }
        }, 6000)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)
        splash = findViewById(R.id.splash)
        splashLog = findViewById(R.id.splashLog)
        logScroller = findViewById(R.id.logScroller)
        statusLabel = findViewById(R.id.statusLabel)
        gridOverlay = findViewById(R.id.gridOverlay)
        gridFadeMask = findViewById(R.id.gridFadeMask)
        splashTitle = findViewById(R.id.splashTitle)
        splashTagline = findViewById(R.id.splashTagline)
        splashFooter = findViewById(R.id.splashFooter)
        splashProgress = findViewById(R.id.splashProgress)

        applySplashTheme(prefs.getString("theme", "light") ?: "light")

        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        val ws = webView.settings
        ws.javaScriptEnabled = true
        ws.domStorageEnabled = true
        ws.databaseEnabled = true
        ws.allowFileAccess = true
        ws.allowContentAccess = true
        ws.loadWithOverviewMode = true
        ws.useWideViewPort = true
        ws.mediaPlaybackRequiresUserGesture = false
        ws.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        ws.cacheMode = WebSettings.LOAD_DEFAULT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ws.safeBrowsingEnabled = true
        }

        webView.addJavascriptInterface(DrawDreamBridge(), "DrawDreamAndroid")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    // 优先 ACTION_OPEN_DOCUMENT（DocumentProvider，URI 权限更稳）
                    // accept 含 .json/.png 时 createIntent 的 MIME 在部分 ROM 上过严导致「选了没结果」
                    val accept = fileChooserParams?.acceptTypes?.filter { it.isNotBlank() }.orEmpty()
                    val mime = when {
                        accept.any { it.contains("json", true) || it == ".json" } &&
                            accept.any { it.contains("png", true) || it == ".png" || it.contains("image") } -> "*/*"
                        accept.any { it.contains("json", true) || it == ".json" } -> "application/json"
                        accept.any { it.contains("png", true) || it == ".png" || it.contains("image") } -> "image/*"
                        accept.isNotEmpty() && accept.none { it.startsWith(".") } -> accept[0]
                        else -> "*/*"
                    }
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = mime
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    }
                    val fallback = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = mime
                        if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    }
                    val chooser = Intent.createChooser(intent, getString(R.string.file_chooser_title)).apply {
                        putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(fallback))
                    }
                    fileChooserLauncher.launch(chooser)
                    true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    filePathCallback?.onReceiveValue(null)
                    toast("无法打开文件选择器：${e.message}")
                    false
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url
                val host = uri?.host.orEmpty()
                val isLocalAgent = (uri?.scheme == "http" || uri?.scheme == "https") &&
                    (host == "127.0.0.1" || host == "localhost") &&
                    (uri?.port == -1 || uri.port == 7620)
                if (isLocalAgent) {
                    return false
                }
                // 外链用系统浏览器
                return try {
                    if (uri != null) startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectDownloadHook()
            }
        }
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            handleDownload(url, userAgent, contentDisposition, mimeType)
        })

        registerReceivers()
        AgentRuntimeService.start(this)
        handler.post(poll)
        scheduleAutoUpdateCheck()

        if (AgentRuntimeService.lastStatus == "ready") {
            openUi()
        }
    }

    /**
     * 拦截 <a download> + blob:/data:，走原生落盘。
     * 纯 WebView 对 blob 的 a.download 通常无反应。
     */
    private fun injectDownloadHook() {
        val js = """
            (function () {
              if (window.__ddAndroidDlHook) return;
              window.__ddAndroidDlHook = true;
              function pushDataUrl(dataUrl, name, mime) {
                try {
                  if (window.DrawDreamAndroid && DrawDreamAndroid.saveDataUrl) {
                    DrawDreamAndroid.saveDataUrl(
                      String(dataUrl || ''),
                      String(name || 'download'),
                      String(mime || '')
                    );
                    return true;
                  }
                } catch (e) {}
                return false;
              }
              function blobToDataUrl(blob) {
                return new Promise(function (resolve, reject) {
                  var r = new FileReader();
                  r.onload = function () { resolve(r.result); };
                  r.onerror = function () { reject(r.error || new Error('read failed')); };
                  r.readAsDataURL(blob);
                });
              }
              document.addEventListener('click', function (ev) {
                var t = ev.target;
                if (!t) return;
                var a = t.closest ? t.closest('a') : null;
                if (!a || !a.hasAttribute('download')) return;
                var href = a.getAttribute('href') || '';
                var name = a.getAttribute('download') || 'download';
                if (href.indexOf('blob:') === 0) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  fetch(href).then(function (res) { return res.blob(); }).then(function (blob) {
                    return blobToDataUrl(blob).then(function (dataUrl) {
                      pushDataUrl(dataUrl, name, blob.type || '');
                    });
                  }).catch(function () {});
                } else if (href.indexOf('data:') === 0) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  pushDataUrl(href, name, '');
                }
              }, true);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun handleDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        when {
            url.startsWith("blob:") -> {
                val name = guessFileName(url, contentDisposition, mimeType)
                val mime = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
                val script = """
                    (async function(){
                      try {
                        const res = await fetch(${jsonStr(url)});
                        const blob = await res.blob();
                        const reader = new FileReader();
                        const dataUrl = await new Promise((resolve, reject) => {
                          reader.onload = () => resolve(reader.result);
                          reader.onerror = () => reject(reader.error || new Error('read'));
                          reader.readAsDataURL(blob);
                        });
                        DrawDreamAndroid.saveDataUrl(String(dataUrl), ${jsonStr(name)}, ${jsonStr(mime)});
                      } catch (e) {}
                    })();
                """.trimIndent()
                webView.evaluateJavascript(script, null)
            }
            url.startsWith("data:") -> {
                try {
                    val name = guessFileName("download", contentDisposition, mimeType)
                    saveDataUrlToDownloads(url, name, mimeType.orEmpty())
                } catch (e: Exception) {
                    toast("保存失败：${e.message}")
                }
            }
            url.startsWith("http://") || url.startsWith("https://") -> {
                try {
                    val name = guessFileName(url, contentDisposition, mimeType)
                    val req = DownloadManager.Request(Uri.parse(url))
                    req.setMimeType(mimeType)
                    req.addRequestHeader("User-Agent", userAgent ?: System.getProperty("http.agent"))
                    val cookie = CookieManager.getInstance().getCookie(url)
                    if (!cookie.isNullOrBlank()) {
                        req.addRequestHeader("Cookie", cookie)
                    }
                    req.setDescription(getString(R.string.download_description))
                    req.setTitle(name)
                    req.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    )
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                    val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                    dm.enqueue(req)
                    toast(getString(R.string.download_started, name))
                } catch (e: Exception) {
                    toast("下载失败：${e.message}")
                }
            }
            else -> toast("不支持的下载地址")
        }
    }

    private fun guessFileName(url: String, contentDisposition: String?, mimeType: String?): String {
        var name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        if (name.isBlank() || name == "downloadfile" || name == "null") {
            val ts = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val ext = when {
                mimeType?.contains("json") == true -> ".json"
                mimeType?.contains("png") == true -> ".png"
                mimeType?.contains("jpeg") == true || mimeType?.contains("jpg") == true -> ".jpg"
                mimeType?.contains("text") == true -> ".txt"
                else -> ""
            }
            name = "drawdream-$ts$ext"
        }
        return name.replace(Regex("""[\\/:*?"<>|]"""), "_")
    }

    private fun saveDataUrlToDownloads(dataUrl: String, filename: String, mimeHint: String) {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || comma < 0) {
            throw IllegalArgumentException("invalid data url")
        }
        val meta = dataUrl.substring(5, comma) // e.g. application/json;base64
        val payload = dataUrl.substring(comma + 1)
        val isBase64 = meta.contains(";base64", ignoreCase = true)
        val mime = meta.substringBefore(';').ifBlank {
            mimeHint.ifBlank { "application/octet-stream" }
        }
        val bytes = if (isBase64) {
            Base64.decode(payload, Base64.DEFAULT)
        } else {
            Uri.decode(payload).toByteArray(Charsets.UTF_8)
        }
        val name = filename.ifBlank { guessFileName("download", null, mime) }
            .replace(Regex("""[\\/:*?"<>|]"""), "_")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore insert failed")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!dir.exists()) dir.mkdirs()
            val out = File(dir, name)
            FileOutputStream(out).use { it.write(bytes) }
            // 通知媒体库
            @Suppress("DEPRECATION")
            sendBroadcast(
                Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(out)),
            )
        }
        toast(getString(R.string.download_saved, name))
    }

    private fun jsonStr(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\""

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun applyStatus(st: String, detail: String) {
        when {
            st == "ready" || st.equals("Ready", true) -> {
                appendLogLine(getString(R.string.status_ready), false)
                handler.postDelayed({ openUi() }, 600)
            }
            st == "error" -> {
                val err = detail.ifBlank {
                    AgentRuntimeService.lastError ?: getString(R.string.status_error)
                }
                appendLogLine(err, false)
                statusLabel.text = err
                statusLabel.setTextColor(0xFFFF6B6B.toInt())
                splash.setOnClickListener {
                    splashLog.removeAllViews()
                    lastLogText = ""
                    statusLabel.text = getString(R.string.status_preparing)
                    statusLabel.setTextColor(0xFF64748B.toInt())
                    splash.setOnClickListener(null)
                    AgentRuntimeService.start(this@MainActivity)
                }
            }
            else -> {
                val msg = detail.ifBlank { st.ifBlank { getString(R.string.status_preparing) } }
                statusLabel.text = msg
                appendLogLine(msg, true)
            }
        }
    }

    private fun appendLogLine(line: String, dedupProgress: Boolean) {
        if (line.isBlank()) return
        if (lastLogText == line) return

        // progress-like lines: overwrite last instead of stacking
        if (dedupProgress && sameProgressGroup(lastLogText, line)) {
            val childCount = splashLog.childCount
            if (childCount > 0) {
                val last = splashLog.getChildAt(childCount - 1) as? TextView ?: return
                last.text = formatLogLine(line)
                last.setTextColor(logLineColor(line))
                lastLogText = line
                logScroller.post { logScroller.fullScroll(View.FOCUS_DOWN) }
                return
            }
        }

        val pad = (3f * resources.displayMetrics.density).toInt()
        val color = logLineColor(line)
        val tv = TextView(this).apply {
            // code-editor style: keyword-ish colors
            setText(formatLogLine(line))
            setTextColor(color)
            textSize = 12f
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(0, pad, 0, pad)
            setLineHeight((17f * resources.displayMetrics.density).toInt())
            maxLines = 4
            ellipsize = android.text.TextUtils.TruncateAt.END
        }

        val anim = AnimationUtils.loadAnimation(this, R.anim.slide_up_fade_in)
        tv.startAnimation(anim)
        splashLog.addView(tv)
        lastLogText = line

        logScroller.post { logScroller.fullScroll(View.FOCUS_DOWN) }
    }

    private fun sameProgressGroup(a: String, b: String): Boolean {
        if (a.isBlank() || b.isBlank()) return false
        val strip = { s: String -> s.replace(Regex("\\d+(\\.\\d+)?"), "#").trim() }
        return strip(a) == strip(b)
    }

    private fun formatLogLine(line: String): CharSequence {
        // user@host:~$ message  (terminal prompt style)
        val sb = android.text.SpannableStringBuilder()
        fun appendColored(text: String, color: Int) {
            val start = sb.length
            sb.append(text)
            sb.setSpan(
                android.text.style.ForegroundColorSpan(color),
                start,
                sb.length,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        appendColored("drawdream", 0xFF00FF9C.toInt())
        appendColored("@", 0xFFFFFFFF.toInt())
        appendColored("mobile", 0xFF0066FF.toInt())
        appendColored(":", 0xFFFFFFFF.toInt())
        appendColored("~", 0xFFFF00FF.toInt())
        appendColored("$ ", 0xFFFFFFFF.toInt())

        val prop = Regex("""^([A-Za-z_][\w.-]*)\s*[:=]\s*(.+)$""").find(line)
        if (prop != null) {
            appendColored(prop.groupValues[1], 0xFF569CD6.toInt())
            appendColored("=", 0xFFFFFFFF.toInt())
            appendColored(prop.groupValues[2], 0xFFCE9178.toInt())
        } else {
            appendColored(line, logLineColor(line))
        }
        return sb
    }

    private fun logLineColor(line: String): Int {
        val s = line.lowercase()
        return when {
            s.contains("error") || s.contains("失败") || s.contains("fail") -> 0xFFFF6B6B.toInt()
            s.contains("ready") || s.contains("就绪") || s.contains("ok") || s.contains("完成") ->
                0xFF00FF9C.toInt()
            s.contains("解压") || s.contains("extract") || s.contains("copy") || s.contains("复制") ->
                0xFF9CDCFE.toInt()
            s.contains("start") || s.contains("启动") || s.contains("waiting") || s.contains("等待") ->
                0xFF569CD6.toInt()
            else -> 0xFFE5E7EB.toInt()
        }
    }

    private fun registerReceivers() {
        val f1 = IntentFilter(AgentRuntimeService.ACTION_STATUS)
        val f2 = IntentFilter(AgentRuntimeService.ACTION_READY)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, f1, RECEIVER_NOT_EXPORTED)
            registerReceiver(readyReceiver, f2, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, f1)
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(readyReceiver, f2)
        }
    }

    private fun openUi() {
        if (loaded) return
        loaded = true
        handler.removeCallbacks(poll)
        splash.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl("http://127.0.0.1:${AgentRuntimeService.PORT}/")
    }

    override fun onPause() {
        if (this::webView.isInitialized) {
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (this::webView.isInitialized) {
            webView.onResume()
        }
        // 切后台再切回：若 bootstrap 已完成但 openUi 尚未触发（poll 曾在 onDestroy 被移除），
        // 这里确保恢复。lastStatus 静态跨实例保留，能兜底切后台/进程重建场景。
        if (!loaded && AgentRuntimeService.lastStatus == "ready") {
            openUi()
        } else if (!loaded && !isFinishing) {
            handler.removeCallbacks(poll)
            handler.post(poll)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(poll)
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        try {
            unregisterReceiver(statusReceiver)
            unregisterReceiver(readyReceiver)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
