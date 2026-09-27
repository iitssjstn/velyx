package app.vidalune.codecs

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tells the app which video and audio formats this device can decode, from Android's own list of
 * decoders, so the Vidalune server can decide what plays directly and what has to be repackaged.
 */
class VidaluneCodecsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VidaluneCodecs")

    Function("decoders") {
      val video = linkedSetOf<String>()
      val tenBit = linkedSetOf<String>()
      val audio = linkedSetOf<String>()
      for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
        if (info.isEncoder) continue
        for (mime in info.supportedTypes) {
          val type = mime.lowercase()
          VIDEO[type]?.let { codec ->
            video.add(codec)
            val profiles = try {
              info.getCapabilitiesForType(mime).profileLevels.map { it.profile }
            } catch (e: Exception) {
              emptyList()
            }
            if (profiles.any { it in (TEN_BIT[codec] ?: emptySet()) }) tenBit.add(codec)
          }
          AUDIO[type]?.let { audio.add(it) }
        }
      }
      mapOf(
        "videoCodecs" to video.toList(),
        "tenBitCodecs" to tenBit.toList(),
        "audioCodecs" to audio.toList(),
        "hdr" to hasHdrScreen()
      )
    }
  }

  private fun hasHdrScreen(): Boolean {
    val context: Context = appContext.reactContext ?: return false
    val manager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return false
    val display = manager.getDisplay(Display.DEFAULT_DISPLAY) ?: return false
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        display.mode.supportedHdrTypes.isNotEmpty()
      } else {
        @Suppress("DEPRECATION")
        display.hdrCapabilities?.supportedHdrTypes?.isNotEmpty() == true
      }
    } catch (e: Exception) {
      false
    }
  }

  companion object {
    private val VIDEO = mapOf(
      "video/avc" to "h264",
      "video/hevc" to "hevc",
      "video/x-vnd.on2.vp9" to "vp9",
      "video/x-vnd.on2.vp8" to "vp8",
      "video/av01" to "av1",
      "video/mpeg2" to "mpeg2video",
      "video/mp4v-es" to "mpeg4"
    )

    private val AUDIO = mapOf(
      "audio/mp4a-latm" to "aac",
      "audio/mpeg" to "mp3",
      "audio/opus" to "opus",
      "audio/vorbis" to "vorbis",
      "audio/flac" to "flac",
      "audio/ac3" to "ac3",
      "audio/eac3" to "eac3",
      "audio/eac3-joc" to "eac3",
      "audio/vnd.dts" to "dts",
      "audio/vnd.dts.hd" to "dts",
      "audio/true-hd" to "truehd",
      "audio/raw" to "pcm_s16le"
    )

    /** Profiles that decode more than 8 bits per colour. */
    private val TEN_BIT = mapOf(
      "h264" to setOf(CodecProfileLevel.AVCProfileHigh10, CodecProfileLevel.AVCProfileHigh422, CodecProfileLevel.AVCProfileHigh444),
      "hevc" to setOf(CodecProfileLevel.HEVCProfileMain10, CodecProfileLevel.HEVCProfileMain10HDR10, CodecProfileLevel.HEVCProfileMain10HDR10Plus),
      "vp9" to setOf(CodecProfileLevel.VP9Profile2, CodecProfileLevel.VP9Profile3, CodecProfileLevel.VP9Profile2HDR, CodecProfileLevel.VP9Profile3HDR),
      "av1" to setOf(CodecProfileLevel.AV1ProfileMain10, CodecProfileLevel.AV1ProfileMain10HDR10, CodecProfileLevel.AV1ProfileMain10HDR10Plus)
    )
  }
}
