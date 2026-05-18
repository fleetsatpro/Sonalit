# SONALIT · Proxy Patch
## Removes the API key screen — users go straight to the platform

---

## WHAT THIS PATCH DOES

Instead of asking every user for an API key, Sonalit now calls
your own `/api/chat` serverless function on Vercel. Your API key
stays on the server — users never see it.

---

## HOW TO APPLY (3 steps)

### Step 1 — Copy files into your frontend folder

```bash
# From your Codespace root:
cp -r sonalit-patch/api /workspaces/Sonalit/frontend/
cp sonalit-patch/vercel.json /workspaces/Sonalit/frontend/
cp sonalit-patch/src/App.jsx /workspaces/Sonalit/frontend/src/
cp sonalit-patch/src/components/ChatArea.jsx /workspaces/Sonalit/frontend/src/components/
```

### Step 2 — Add your API key to Vercel

Go to: vercel.com → sonalit project → Settings → Environment Variables

Add:
  Name:  ANTHROPIC_API_KEY
  Value: sk-ant-your-actual-key-here

Note: NO "VITE_" prefix — this is a server-side variable.

### Step 3 — Push and deploy

```bash
cd /workspaces/Sonalit/frontend
git add .
git commit -m "Add proxy — remove API key screen"
git push
```

Vercel auto-deploys. Done — sonalit.vercel.app works for everyone
with no login screen.

---

## FILES IN THIS PATCH

api/chat.js          — Vercel serverless function (the proxy)
vercel.json          — Routes /api/* correctly
src/App.jsx          — Removed auth gate
src/components/ChatArea.jsx  — Calls /api/chat instead of Anthropic

---

*SONALIT · Logistics Intelligence Platform*
