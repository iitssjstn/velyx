/** A movie's or show's trailer, as the server finds it at TMDB (a YouTube video). */
export interface Trailer {
  key: string;
  name: string;
}

/** Where the trailer plays: the YouTube app when installed, otherwise the browser. */
export function trailerUrl(trailer: Trailer): string | null {
  return /^[\w-]{6,20}$/.test(trailer.key) ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}
