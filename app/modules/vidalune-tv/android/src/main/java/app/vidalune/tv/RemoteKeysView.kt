package app.vidalune.tv

import android.content.Context
import android.os.Build
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
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
    // Something else took the focus (a view that appeared): take it back, while the player is on screen.
    setOnFocusChangeListener { _, focused -> if (!focused) post { if (isAttachedToWindow && isShown) requestFocus() } }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { requestFocus() }
  }

  override fun onDetachedFromWindow() {
    val root = rootView as? ViewGroup
    super.onDetachedFromWindow()
    // Leaving the player: the focus can be left on nothing, or on a view that is no longer on screen, and
    // then the remote's arrows do nothing. Give it to the screen underneath once that is back (its
    // transition takes a moment), checking a few times.
    if (root != null) restoreFocus(root, RESTORE_TRIES)
  }

  private fun restoreFocus(root: ViewGroup, tries: Int) {
    root.postDelayed({
      val focused = root.findFocus()
      if (focused == null || !focused.isShown) root.requestFocus(View.FOCUS_DOWN)
      val now = root.findFocus()
      if ((now == null || !now.isShown) && tries > 1) restoreFocus(root, tries - 1)
    }, RESTORE_EVERY_MS)
  }

  companion object {
    private const val RESTORE_TRIES = 15
    private const val RESTORE_EVERY_MS = 200L
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
