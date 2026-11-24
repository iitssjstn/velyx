/** A movie's or show's trailer, as the server finds it at TMDB (a YouTube video). */
export interface Trailer {
  key: string;
  name: string;
}

const validKey = (key: string): boolean => /^[\w-]{6,20}$/.test(key);

/** Where the trailer plays outside the app (when it cannot play in its window): the YouTube app when installed, otherwise the browser. */
export function trailerUrl(trailer: Trailer): string | null {
  return validKey(trailer.key) ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}

/** Where the server gives the trailer: an item in the library by its id, any other title by its TMDB id. */
export function trailerPath(type: 'movie' | 'show', id: number | string, outsideLibrary = false): string {
  if (outsideLibrary) return `/api/seerr/${type === 'movie' ? 'movie' : 'tv'}/${id}/trailer`;
  return `/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/trailer`;
}

/**
 * Where the trailer window says it comes from: YouTube refuses embedded players without one. The
 * website's own address, where the same trailers already play in a window.
 */
export const TRAILER_ORIGIN = 'https://app.vidalune.com';


/**
 * The page in the app's trailer window: YouTube's embedded player (the privacy-friendly host, as on
 * the website), playing at once, which tells the app when the trailer ends or cannot be embedded.
 * Null for an odd video id.
 */
export function trailerHtml(trailer: Trailer): string | null {
  if (!validKey(trailer.key)) return null;
  const vars = JSON.stringify({ autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: TRAILER_ORIGIN });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%}</style></head><body><div id="p"></div><script>
function say(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m)}
function onYouTubeIframeAPIReady(){new YT.Player('p',{host:'https://www.youtube-nocookie.com',videoId:${JSON.stringify(trailer.key)},playerVars:${vars},events:{onReady:function(e){e.target.playVideo()},onError:function(e){say('error:'+e.data)},onStateChange:function(e){if(e.data===0)say('ended')}}})}
</script><script src="https://www.youtube.com/iframe_api" onerror="say('error:load')"></script></body></html>`;
}

/** What the trailer window reports: it ended, or YouTube could not play it here (then the YouTube app opens). */
export function trailerEvent(message: string): 'ended' | 'failed' | null {
  if (message === 'ended') return 'ended';
  if (message.startsWith('error:')) return 'failed';
  return null;
}
