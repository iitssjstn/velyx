package app.vidalune.tv

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The keys of a TV remote for the app's own player on Android TV / Google TV (see RemoteKeysView). */
class VidaluneTvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VidaluneTv")

    View(RemoteKeysView::class) {
      Events("onKey")
    }
  }
}
