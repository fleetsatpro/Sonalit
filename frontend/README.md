# SONALIT · Logistics Intelligence Platform

The autonomous AI intelligence layer for world-class logistics operations.
35 operational domains · 7 production phases · Mobile-first · Fully responsive

---

## QUICK START

```bash
npm install
cp .env.example .env
# Add your Anthropic API key to .env
npm run dev
```

Open http://localhost:3000

---

## ENVIRONMENT

```
VITE_ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your key at https://console.anthropic.com

---

## ARCHITECTURE

```
src/
  App.jsx                  Root layout, auth, mobile tab state
  systemPrompt.js          Full Sonalit AI system prompt (98k chars)
  index.css                Mobile-first styles, CSS variables
  main.jsx                 React entry point
  components/
    TopBar.jsx             Platform header, status, dropdowns (desktop)
    BottomNav.jsx          4-tab mobile navigation
    Sidebar.jsx            35-module navigator (desktop panel / mobile tab)
    ChatArea.jsx           Sonalit AI chat, full prompt, Sonalit identity
    MetricsPanel.jsx       Live KPIs, latency §2.3, infra §2.1 (desktop/mobile)
    Settings.jsx           User class + autonomy level (mobile settings tab)
```

---

## MOBILE LAYOUT

| Tab | Content |
|-----|---------|
| CHAT | Sonalit AI conversation |
| MODULES | All 35 module navigator |
| METRICS | Live KPIs, alerts, latency, infra |
| CONFIG | User class, autonomy level, priority hierarchy |

## DESKTOP LAYOUT

3-column: Sidebar · Chat · Metrics — full TopBar with dropdowns

---

*SONALIT · Logistics Intelligence Platform*
