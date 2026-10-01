/* Sonalit first-paint theme bootstrap. Same-origin and CSP-approved. */
(function () {
  try {
    var raw = window.localStorage.getItem('sonalit-ui');
    var parsed = raw ? JSON.parse(raw) : null;
    var value = parsed && parsed.state && parsed.state.theme;
    var aliases = { dark: 'obsidian', light: 'ivory' };
    var valid = {
      obsidian: true,
      arctic: true,
      graphite: true,
      copper: true,
      signal: true,
      ivory: true,
      dark: true,
      light: true
    };
    var theme = typeof value === 'string' && valid[value]
      ? (aliases[value] || value)
      : 'obsidian';
    var light = theme === 'arctic' || theme === 'ivory';
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', !light);
    root.style.colorScheme = light ? 'light' : 'dark';
    var colors = {
      obsidian: '#030711',
      arctic: '#f4f8fc',
      graphite: '#0e1012',
      copper: '#130f0d',
      signal: '#090d09',
      ivory: '#f8faf8'
    };
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors[theme] || colors.obsidian);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'obsidian');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
}());
