/** A movie's or show's trailer, as the server finds it at TMDB (a YouTube video). */
export interface Trailer {
  key: string;
  name: string;
}

/** Where the trailer plays: the YouTube app when installed, otherwise the browser. */
export function trailerUrl(trailer: Trailer): string | null {
  return /^[\w-]{6,20}$/.test(trailer.key) ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}

/** Where the server gives the trailer: an item in the library by its id, any other title by its TMDB id. */
export function trailerPath(type: 'movie' | 'show', id: number | string, outsideLibrary = false): string {
  if (outsideLibrary) return `/api/seerr/${type === 'movie' ? 'movie' : 'tv'}/${id}/trailer`;
  return `/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/trailer`;
}
