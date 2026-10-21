package app.vidalune.tv

import android.content.Context
import android.os.Build
import android.view.KeyEvent
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Holds the focus while the player is open and passes the remote's arrows, OK and media keys to the
 * player (onKey, with Android's key code), instead of letting Android move the focus around. Back is
 * left to the app (BackHandler), so it can close a menu first or leave the player.
 */
class RemoteKeysView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onKey by EventDispatcher()

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    descendantFocusability = FOCUS_BLOCK_DESCENDANTS
    // No grey focus box over the video.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) defaultFocusHighlightEnabled = false
    setOnKeyListener { _: View, keyCode: Int, event: KeyEvent ->
      if (keyCode !in KEYS) return@setOnKeyListener false
      if (event.action == KeyEvent.ACTION_DOWN) onKey(mapOf("keyCode" to keyCode, "repeat" to event.repeatCount))
      true
    }
    // Something else took the focus (a view that appeared): take it back.
    setOnFocusChangeListener { _, focused -> if (!focused) post { if (isAttachedToWindow) requestFocus() } }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { requestFocus() }
  }

  companion object {
    private val KEYS = setOf(
      KeyEvent.KEYCODE_DPAD_UP,
      KeyEvent.KEYCODE_DPAD_DOWN,
      KeyEvent.KEYCODE_DPAD_LEFT,
      KeyEvent.KEYCODE_DPAD_RIGHT,
      KeyEvent.KEYCODE_DPAD_CENTER,
      KeyEvent.KEYCODE_ENTER,
      KeyEvent.KEYCODE_NUMPAD_ENTER,
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
      KeyEvent.KEYCODE_MEDIA_PLAY,
      KeyEvent.KEYCODE_MEDIA_PAUSE,
      KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
      KeyEvent.KEYCODE_MEDIA_REWIND,
    )
  }
}
