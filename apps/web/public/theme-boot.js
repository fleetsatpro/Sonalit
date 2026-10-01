/* Sonalit theme bootstrap. Same-origin external script so the strict CSP can execute it. */
(function () {
  try {
    var raw = window.localStorage.getItem('sonalit-ui');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    var value = parsed && parsed.state && parsed.state.theme;
    var aliases = { dark: 'obsidian', light: 'daylight' };
    var valid = {
      obsidian: true,
      arctic: true,
      graphite: true,
      copper: true,
      signal: true,
      daylight: true,
      dark: true,
      light: true
    };
    if (typeof value === 'string' && valid[value]) {
      document.documentElement.setAttribute('data-theme', aliases[value] || value);
    }
  } catch (_) {
    /* Corrupt/unavailable local storage must never block application boot. */
  }
}());
