package app.vidalune.tv

import android.animation.ValueAnimator
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.ScrollView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

/**
 * The app on Android TV / Google TV: the remote's keys for the app's own player (see RemoteKeysView)
 * and Cast Connect, casting from a phone or browser into that player (see CastConnect).
 */
/** How long a glide on the TV takes (the owner: 250 ms was a little too quick). */
private const val GLIDE_MS = 420L

/** The glide under way per scroll view, so a new one takes over from it. */
private val glides = java.util.WeakHashMap<ScrollView, ValueAnimator>()

/** Scrolls `view` to `to` (pixels) over GLIDE_MS, starting from where it is now. */
private fun glide(view: ScrollView, to: Int) {
  glides.remove(view)?.cancel()
  val from = view.scrollY
  if (from == to) return
  val animator = ValueAnimator.ofInt(from, to).apply {
    duration = GLIDE_MS
    // Soft start, long soft landing (like a swipe that comes to rest).
    interpolator = PathInterpolator(0.25f, 0.1f, 0.25f, 1f)
    addUpdateListener { view.scrollTo(0, it.animatedValue as Int) }
  }
  glides[view] = animator
  animator.start()
}

class VidaluneTvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VidaluneTv")

    Events("onCastLoad", "onCastCommand")

    OnCreate {
      CastConnect.listener = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      CastConnect.listener = null
    }

    /** The latest cast from a sender that was not opened yet (null when none). */
    Function("takeCastLoad") { CastConnect.take() }

    // On the main thread: the cast receiver and media session are used there.
    AsyncFunction("castMedia") { title: String, subtitle: String?, image: String?, duration: Double, customData: String, tracks: List<Map<String, Any?>> ->
      CastConnect.media(title, subtitle, image, duration, customData, tracks)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("castStatus") { state: String, position: Double, trackIds: List<Int> ->
      CastConnect.status(state, position, trackIds)
    }.runOnQueue(Queues.MAIN)

    // The TV home screen's scroll to the row with the focus, like a swipe: a soft start and a long
    // ease out over GLIDE_MS (Android's own smoothScrollTo always takes 250 ms, which felt too quick).
    // A new press takes over from where the scroll is, so holding ↓ never waits. `y` in points.
    AsyncFunction("glideTo") { viewTag: Int, y: Double ->
      val view: View? = try {
        appContext.findView<View>(viewTag)
      } catch (e: Exception) {
        null
      }
      if (view is ScrollView) {
        glide(view, (y * view.resources.displayMetrics.density).roundToInt())
        true
      } else {
        false
      }
    }.runOnQueue(Queues.MAIN)

    View(RemoteKeysView::class) {
      Events("onKey")
    }
  }
}
