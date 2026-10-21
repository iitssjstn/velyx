package app.vidalune.tv

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Starts Cast Connect with the app and passes it the activity's intents and foreground state. */
class VidaluneTvPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) = CastConnect.init(application)
    })

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        CastConnect.intent(activity.intent)
      }

      override fun onNewIntent(intent: Intent): Boolean = CastConnect.intent(intent)

      override fun onResume(activity: Activity) = CastConnect.foreground(true)

      override fun onPause(activity: Activity) = CastConnect.foreground(false)
    })
}
