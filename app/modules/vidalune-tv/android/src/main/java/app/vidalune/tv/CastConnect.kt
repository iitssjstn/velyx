package app.vidalune.tv

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.MediaTrack
import com.google.android.gms.cast.tv.CastReceiverContext
import com.google.android.gms.cast.tv.media.MediaCommandCallback
import com.google.android.gms.cast.tv.media.MediaLoadCommandCallback
import com.google.android.gms.common.images.WebImage
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject

/**
 * Cast Connect: a phone or browser that casts to a Google TV with the Vidalune app opens the title in
 * the app's own player instead of the web player on cast.vidalune.com. The sender's load comes in
 * here and goes to JavaScript (which opens the title); the player tells the senders what it does
 * (playing, position, subtitle) and gets their commands back (play, pause, seek, stop, subtitle).
 * Only on a TV; on a phone the app is a sender.
 */
object CastConnect {
  private const val TAG = "VidaluneCastConnect"
  private var receiver: CastReceiverContext? = null
  private var session: MediaSessionCompat? = null
  /** Whether a sender cast to this app since it started: only then is the player's state told to senders. */
  private var casting = false
  /** The latest cast for JavaScript to take (kept: the app may have been started for it). */
  @Volatile var pending: Map<String, Any?>? = null
  /** The module while JavaScript runs: told about loads and commands. */
  var listener: ((String, Map<String, Any?>) -> Unit)? = null

  fun isTv(context: Context) = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

  fun init(application: Application) {
    if (receiver != null || !isTv(application)) return
    try {
      CastReceiverContext.initInstance(application)
      val context = CastReceiverContext.getInstance()
      val media = MediaSessionCompat(application, "Vidalune")
      media.setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = command("play")
        override fun onPause() = command("pause")
        override fun onSeekTo(pos: Long) = command("seek", mapOf("position" to pos / 1000.0))
        override fun onStop() = command("stop")
      })
      val manager = context.mediaManager
      manager.setSessionCompatToken(media.sessionToken)
      manager.setMediaLoadCommandCallback(object : MediaLoadCommandCallback() {
        override fun onLoad(senderId: String?, loadRequestData: MediaLoadRequestData): Task<MediaLoadRequestData> {
          load(loadRequestData)
          return Tasks.forResult(loadRequestData)
        }
      })
      manager.setMediaCommandCallback(object : MediaCommandCallback() {
        override fun onSelectTracksByType(senderId: String?, type: Int, tracks: List<MediaTrack>): Task<Void?> {
          if (type == MediaTrack.TYPE_TEXT) command("subtitle", mapOf("trackId" to (tracks.firstOrNull()?.id?.toInt() ?: 0)))
          return Tasks.forResult(null)
        }
      })
      manager.mediaStatusModifier.setMediaCommandSupported(MediaStatus.COMMAND_EDIT_TRACKS, true)
      receiver = context
      session = media
    } catch (e: Exception) {
      Log.w(TAG, "Cast Connect is not available", e)
    }
  }

  /** In the foreground only: senders see the app as a receiver while it is open. */
  fun foreground(on: Boolean) {
    val context = receiver ?: return
    try {
      if (on) context.start() else context.stop()
    } catch (e: Exception) {
      Log.w(TAG, "Cast receiver start/stop failed", e)
    }
  }

  /** A load from a sender that started or brought back the app; true when it was one. */
  fun intent(intent: Intent?): Boolean {
    val context = receiver ?: return false
    return intent != null && context.mediaManager.onNewIntent(intent)
  }

  private fun load(request: MediaLoadRequestData) {
    casting = true
    receiver?.mediaManager?.let {
      it.setDataFromLoad(request)
      it.broadcastMediaStatus()
    }
    session?.isActive = true
    val body = mapOf(
      "customData" to (request.mediaInfo?.customData ?: request.customData)?.toString(),
      "currentTime" to request.currentTime / 1000.0,
      "activeTrackIds" to (request.activeTrackIds?.map { it.toInt() } ?: emptyList<Int>()),
    )
    pending = body
    listener?.invoke("onCastLoad", body)
  }

  private fun command(type: String, extra: Map<String, Any?> = emptyMap()) {
    listener?.invoke("onCastCommand", mapOf("type" to type) + extra)
  }

  fun take(): Map<String, Any?>? {
    val body = pending
    pending = null
    return body
  }

  /** The title the player opened while cast to (the next episode too): what senders show and follow. */
  fun media(title: String, subtitle: String?, image: String?, duration: Double, customData: String, tracks: List<Map<String, Any?>>) {
    val manager = receiver?.mediaManager ?: return
    if (!casting) return
    val meta = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE)
    meta.putString(MediaMetadata.KEY_TITLE, title)
    if (subtitle != null) meta.putString(MediaMetadata.KEY_SUBTITLE, subtitle)
    if (image != null) meta.addImage(WebImage(Uri.parse(image)))
    val info = MediaInfo.Builder("vidalune")
      .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
      .setContentType("video/mp4")
      .setMetadata(meta)
      .setStreamDuration((duration * 1000).toLong())
      .setCustomData(JSONObject(customData))
      .setMediaTracks(tracks.map {
        MediaTrack.Builder((it["id"] as Number).toLong(), MediaTrack.TYPE_TEXT)
          .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
          .setName(it["name"] as String?)
          .setLanguage(it["language"] as String?)
          .build()
      })
      .build()
    manager.setDataFromLoad(MediaLoadRequestData.Builder().setMediaInfo(info).setAutoplay(true).build())
    val metadata = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
      .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (duration * 1000).toLong())
      .build()
    session?.setMetadata(metadata)
    session?.isActive = true
    manager.broadcastMediaStatus()
  }

  /** What the player does now: playing, paused, buffering or idle (closed), where, and its subtitle. */
  fun status(state: String, position: Double, trackIds: List<Int>) {
    val media = session ?: return
    val manager = receiver?.mediaManager ?: return
    if (!casting) return
    val playback = when (state) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "paused" -> PlaybackStateCompat.STATE_PAUSED
      "buffering" -> PlaybackStateCompat.STATE_BUFFERING
      else -> PlaybackStateCompat.STATE_STOPPED
    }
    media.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SEEK_TO or PlaybackStateCompat.ACTION_STOP)
        .setState(playback, (position * 1000).toLong(), if (state == "playing") 1f else 0f)
        .build(),
    )
    manager.mediaStatusModifier.mediaTracksModifier.setActiveTrackIds(trackIds.map { it.toLong() }.toLongArray())
    manager.broadcastMediaStatus()
    // Closed: senders see it stopped; the next title the player opens (the next episode) is theirs again.
    media.isActive = state != "idle"
  }
}
