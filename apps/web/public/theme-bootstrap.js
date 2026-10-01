(() => {
  try {
    const raw = localStorage.getItem('sonalit-ui');
    const saved = raw ? JSON.parse(raw) : null;
    const legacy = { dark: 'obsidian', light: 'ivory' };
    const themes = ['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory'];
    const candidate = saved?.state?.theme;
    const theme = themes.includes(candidate) ? candidate : (legacy[candidate] || 'obsidian');
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', 'obsidian');
  }
})();
