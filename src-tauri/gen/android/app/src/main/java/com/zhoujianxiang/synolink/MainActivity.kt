package com.zhoujianxiang.synolink

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Let the system Back gesture navigate Vue's WebView history first.
  override val handleBackNavigation: Boolean = true

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    if (intent.getBooleanExtra("synolink_photo_backup", false)) PhotoBackupPlugin.callback?.send(app.tauri.plugin.JSObject().put("reason", "open"))
    if (intent.getBooleanExtra("synolink_transfers", false)) DownloadService.callback?.send(app.tauri.plugin.JSObject().put("reason", "open"))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }
}
