package app.vidalune.tv

import android.content.Context
import com.google.android.gms.cast.LaunchOptions
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions
import com.google.android.gms.cast.framework.media.NotificationOptions

/**
 * The phone's cast options (Vidalune's cast app, the cast notification), with Cast
 * Connect on: a Google TV with the Vidalune app plays the title in the app. Replaces the options of
 * react-native-google-cast in the manifest (withTv plugin).
 */
class VidaluneCastOptions : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions {
    val info = context.packageManager.getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
    val appId = info.metaData?.getString("com.reactnative.googlecast.RECEIVER_APPLICATION_ID") ?: "920BF057"
    val media = CastMediaOptions.Builder()
      .setNotificationOptions(NotificationOptions.Builder().build())
      .build()
    return CastOptions.Builder()
      .setReceiverApplicationId(appId)
      .setCastMediaOptions(media)
      .setLaunchOptions(LaunchOptions.Builder().setAndroidReceiverCompatible(true).build())
      .build()
  }

  override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
