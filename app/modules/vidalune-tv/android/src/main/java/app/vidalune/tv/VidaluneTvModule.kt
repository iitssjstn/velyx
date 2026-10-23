package app.vidalune.tv

import android.view.View
import android.widget.ScrollView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

/**
 * The app on Android TV / Google TV: the remote's keys for the app's own player (see RemoteKeysView)
 * and Cast Connect, casting from a phone or browser into that player (see CastConnect).
 */
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

    // The TV home screen's scroll to the row with the focus: Android's own smooth scroll, quick at the
    // start and easing out like a swipe (React Native's animated scrollTo also eases in, which felt slow
    // with the remote). A press within its 250 ms jumps straight on, so holding ↓ never waits. `y` in points.
    AsyncFunction("glideTo") { viewTag: Int, y: Double ->
      val view: View? = try {
        appContext.findView<View>(viewTag)
      } catch (e: Exception) {
        null
      }
      if (view is ScrollView) {
        view.smoothScrollTo(0, (y * view.resources.displayMetrics.density).roundToInt())
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
