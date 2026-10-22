# FlowForge — Deploy + Google Meet setup (copy-paste guide)

## PART A — Update your laptop copy first (WSL Ubuntu)
```bash
cd /mnt/c/Users/Asus/Downloads/web-forge-
git stash
git pull origin main
npm run setup
npm run dev
```
Open http://localhost:5173. If it says a port is busy: `sudo fuser -k 4000/tcp 5173/tcp` then `npm run dev` again.

## PART B — Put it on the internet (Render, free)
1. Open https://render.com → **Get Started** → sign in with GitHub (the account that can see the repo `sakshamtrivedi4343-sudo/web-forge-`; if it is not your account, fork the repo first and use your fork).
2. Dashboard → **New +** → **Blueprint** → choose the repo → **Connect**.
3. Render reads `render.yaml` and shows 3 things: `flowforge-db` (Postgres), `flowforge-redis` (Key Value), `flowforge` (web). Click **Apply**.
4. Wait 3–6 minutes until **flowforge** shows **Live** (green). Click its link `https://flowforge-xxxx.onrender.com`.
5. Register an account on that site. Open a template → Run. Everything works from this one link.
6. **Save your secret key:** Render → **flowforge** → **Environment** → click the eye on `CREDENTIAL_KEY` → copy it into a safe note. (It unlocks saved API keys. Don't change it later.)
7. If the build fails: Render → flowforge → **Logs** → copy the red lines and send them to me.
8. Keep it awake (free plan sleeps after ~15 min, and schedules can't fire while asleep): https://uptimerobot.com → Add monitor → HTTP(s) → URL `https://YOUR-APP.onrender.com/api/health` → every 5 minutes.
9. Updating later: `git push origin main` → Render redeploys by itself.

## PART C — Google Meet (real) setup
Goal: FlowForge creates a Google Calendar event with a Meet link at a time you choose, then posts the link to Discord.

**C1. Create a Google Cloud project**
1. Go to https://console.cloud.google.com (sign in with the Google account that should own the meetings).
2. Top bar project picker → **New project** → name `FlowForge` → **Create** → select it.

**C2. Turn on the Calendar API**
1. Menu ☰ → **APIs & Services** → **Library**.
2. Search `Google Calendar API` → open it → **Enable**.

**C3. Consent screen**
1. **APIs & Services** → **OAuth consent screen** (new UI: *Google Auth Platform* → *Get started*).
2. App name `FlowForge`, support email = yours → **Next** → Audience **External** → **Next** → contact email = yours → agree → **Create**.
3. **Audience** (or *Test users*) → **Add users** → add your own Gmail → **Save**.
4. Important: while the app status is **Testing**, Google expires the refresh token after **7 days**. For the hackathon that is fine. To avoid it, press **Publish app** (→ In production). You'll see an "unverified app" warning once; that is OK for your own account.

**C4. Create the login (Client ID + Secret)**
1. **APIs & Services** → **Credentials** → **+ Create credentials** → **OAuth client ID**.
2. Application type **Web application**, name `FlowForge`.
3. Under **Authorized redirect URIs** → **+ Add URI** → paste exactly: `https://developers.google.com/oauthplayground` → **Create**.
4. Copy the **Client ID** and **Client secret** (keep them for C6).

**C5. Get the refresh token (one time)**
1. Open https://developers.google.com/oauthplayground
2. Click the ⚙ gear (top right) → tick **Use your own OAuth credentials** → paste Client ID and Client secret → Close.
3. Left box "Input your own scopes" → paste `https://www.googleapis.com/auth/calendar.events` → **Authorize APIs**.
4. Pick your Google account → if you see "Google hasn't verified this app" → **Advanced** → **Go to FlowForge (unsafe)** → **Continue/Allow**.
5. Back in the Playground press **Exchange authorization code for tokens**. Copy the **Refresh token** (long text starting `1//`).

**C6. Save it in FlowForge**
1. FlowForge → top menu **Credentials** → fill:
   - Name: `My Google`
   - Kind: **Login that renews itself (OAuth 2)**
   - Click the blue **Google** link next to "Fill token URL for" (fills the Token URL)
   - Client ID, Client secret, Refresh token = from above
   - Scope: `https://www.googleapis.com/auth/calendar.events`
   - Save.

**C7. Use the template**
1. Home → template **Create a real Google Meet (at a set time)**.
2. Open the **⚙ Settings** step: set `title` (meeting name) and `discordUrl` (Discord channel ⚙ → Integrations → Webhooks → New Webhook → Copy URL).
3. Click the **Create Meet** step → **Authentication** → choose `My Google (oauth2)`.
4. Press **Save**, then **Run**. Open the Run → the "Create Meet" step output shows `hangoutLink` and Discord gets the link. (Meeting is set 5 minutes after the run; change `{{now.in5min}}` for another offset.)
5. For an exact time: **⏰ Schedule** → **📌 Run once** → pick date + time + time zone → Save. At that moment the meeting is created and the link is posted.

**Common problems**
| Message | Fix |
|---|---|
| `invalid_grant` | Refresh token expired/revoked (Testing mode = 7 days). Repeat C5, update the credential, or Publish app (C3.4). |
| `403 accessNotConfigured` | Calendar API not enabled (C2). |
| `403 insufficientPermissions` | Scope in C5/C6 must be `https://www.googleapis.com/auth/calendar.events`. |
| `redirect_uri_mismatch` | Redirect URI in C4 must be exactly `https://developers.google.com/oauthplayground`. |
| `access_denied` in Playground | Your Gmail isn't added as a test user (C3.3). |
| Link missing in Discord | The Create Meet step failed — open the run and read that step's error. |
