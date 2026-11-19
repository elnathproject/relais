/*
 * Relais, sequential countdowns for performers.
 * Copyright (c) 2026 Elnath Project (Alessandro Ciccarelli)
 * Released under the MIT License: see the LICENSE file.
 */
package com.ciccarelli.relais

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    // Export: the page hands over the text, the system file picker chooses where to save it.
    private var pendingExport: String? = null
    private val createJson = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        val text = pendingExport
        pendingExport = null
        if (uri == null || text == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Could not save the file", Toast.LENGTH_LONG).show()
        }
    }

    // Import: the system file picker chooses a file, its text goes to the page, which checks it.
    private val openJson = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@registerForActivityResult
        try {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@registerForActivityResult
            if (bytes.size > 1_000_000) {
                Toast.makeText(this, "File too large", Toast.LENGTH_LONG).show()
                return@registerForActivityResult
            }
            val text = String(bytes, Charsets.UTF_8)
            web.evaluateJavascript("window.relaisImport && window.relaisImport(${JSONObject.quote(text)})", null)
        } catch (_: Exception) {
            Toast.makeText(this, "Could not read the file", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the screen on while the app is open.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Draw under the camera cutout too, if there is one.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0d0f10"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            addJavascriptInterface(Bridge(), "Android")
            // External links (the website in About) open in the phone's browser.
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.scheme == "file") return false
                    try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) {}
                    return true
                }
            }
            settings.setSupportMultipleWindows(false)
        }
        setContentView(web)
        web.requestFocus()  // keys from a Bluetooth pedal reach the page
        hideSystemBars()

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/index.html")

        // Back: from the player or the editor to the worklists; from the worklists, the app goes to the background.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("!!(window.relaisBack && window.relaisBack())") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })
    }

    // Full screen: status and navigation bars hidden; a swipe from the edge brings them back.
    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // Native functions the page can call. They run on a background thread: anything that
    // touches the interface goes back to the main thread.
    inner class Bridge {
        @JavascriptInterface
        fun vibrate(ms: Long) {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, ms, 80, ms), -1))
        }

        @JavascriptInterface
        fun saveFile(name: String, text: String) {
            runOnUiThread {
                pendingExport = text
                try { createJson.launch(name) } catch (_: Exception) {
                    pendingExport = null
                    Toast.makeText(this@MainActivity, "No file manager available", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun openFile() {
            runOnUiThread {
                try { openJson.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "No file manager available", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun isApp(): Boolean = true
    }
}
