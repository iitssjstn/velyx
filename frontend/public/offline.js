// Dutch when the device or the last used account is Dutch; English otherwise.
(function () {
  var lang;
  try {
    lang = localStorage.getItem('velyx.language') || navigator.language || 'en';
  } catch {
    lang = navigator.language || 'en';
  }
  if (/^nl/i.test(lang)) {
    document.documentElement.lang = 'nl';
    document.getElementById('title').textContent = 'Velyx is niet bereikbaar';
    document.getElementById('text').textContent = 'Controleer je internetverbinding of dat de server draait, en probeer het opnieuw.';
    document.getElementById('retry').textContent = 'Opnieuw proberen';
  }
  document.getElementById('retry').addEventListener('click', function () {
    location.reload();
  });
})();
