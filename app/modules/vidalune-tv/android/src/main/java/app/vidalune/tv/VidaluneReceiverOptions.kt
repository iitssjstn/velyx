package app.vidalune.tv

import android.content.Context
import com.google.android.gms.cast.tv.CastReceiverOptions
import com.google.android.gms.cast.tv.ReceiverOptionsProvider

/** Cast Connect on the TV (see CastConnect); named in the manifest by the withTv plugin. */
class VidaluneReceiverOptions : ReceiverOptionsProvider {
  override fun getOptions(context: Context): CastReceiverOptions = CastReceiverOptions.Builder(context).build()
}
