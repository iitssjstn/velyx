package app.vidalune.tv

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    View(RemoteKeysView::class) {
      Events("onKey")
    }
  }
}
