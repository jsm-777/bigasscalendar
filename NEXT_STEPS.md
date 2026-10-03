# Big Ass Calendar — Next Steps

Everything here is free (Vercel Hobby, Google Cloud without billing, GitHub). Do steps 1–4 on a computer; step 5 on your phone.

Your site address is shown in Vercel (e.g. `https://bigasscalendar.vercel.app`). Below it's called **YOUR-SITE**.

---

## ☐ 1. Vercel: deploy from `main`

- [ ] Vercel → your project → **Settings → Git** → **Production Branch** = `main` → **Save**
- [ ] Write down YOUR-SITE (shown on the project's overview page)
- [ ] *(Optional)* GitHub → `jsm-777/bigasscalendar` → **Settings → General → Default branch** → switch to `main`

## ☐ 2. Google Cloud: create the app

Go to <https://console.cloud.google.com> and sign in with your Gmail. If Google asks for a card or a "free trial", skip it; this doesn't need billing.

- [ ] Project picker (top bar) → **New project** → name it `Big Ass Calendar` → **Create**, then make sure it's selected
- [ ] **APIs & Services → Library**: search for and **Enable** each one:
  - [ ] Google Calendar API
  - [ ] Google Tasks API
  - [ ] Google Drive API
- [ ] **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform") → **Get started**
  - [ ] App name `Big Ass Calendar`; your Gmail as the support and contact email
  - [ ] Audience: **External**
  - [ ] **Test users** → add your Gmail **and** Tehron's Gmail
  - [ ] **Audience → Publish app**. This stops Google from signing you out every 7 days, and no verification is needed for two people.
- [ ] **Credentials → Create credentials → OAuth client ID** → type **Web application**
  - [ ] Authorized JavaScript origins: `https://YOUR-SITE`
  - [ ] Authorized redirect URIs: `https://YOUR-SITE/api/auth/callback`
  - [ ] **Create**, then copy the **Client ID** and **Client secret** (keep them private)

## ☐ 3. Vercel: add the keys

Vercel → **Settings → Environment Variables** → environment **Production**:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID from step 2 |
| `GOOGLE_CLIENT_SECRET` | Client secret from step 2 |
| `SESSION_SECRET` | 40+ random characters (mash the keyboard, or run `openssl rand -base64 32`) |
| `APP_ORIGIN` | `https://YOUR-SITE` (no slash at the end) |
| `ALLOWED_EMAILS` | `you@gmail.com,tehron@gmail.com` |

- [ ] Add all five
- [ ] Delete the old `DATABASE_URL`, `POSTGRES_URL` and `CRON_SECRET` if they exist (no longer used)

## ☐ 4. Redeploy

- [ ] Vercel → **Deployments** → newest one → **⋯ → Redeploy**
- [ ] Wait until it says **Ready**

## ☐ 5. Test on your phone

- [ ] Open YOUR-SITE → **Sign in with Google**
- [ ] On "Google hasn't verified this app", tap **Advanced → Go to Big Ass Calendar**
- [ ] Leave **all** permission boxes ticked (Calendar, Tasks, Drive app data)
- [ ] Check that your Google Calendar events show up on the Day, Week and Year screens
- [ ] Add a test event and confirm it appears in the Google Calendar app
- [ ] Add a to-do and confirm it appears in Google Tasks
- [ ] iPhone: **Share → Add to Home Screen** for an app icon

Want to look before setting up Google? Tap **Try the demo** on the sign-in screen.

## ☐ 6. Connect Tehron

- [ ] Tehron signs in at YOUR-SITE with his own Gmail. He must be in **Test users** (step 2) and in `ALLOWED_EMAILS` (step 3).
- [ ] To see each other's events: on a computer, Google Calendar → **Settings** → click your calendar → **Share with specific people** → add the other person's Gmail → **See all event details**
- [ ] The shared calendar then appears in the app automatically. Show or hide it in **Menu → Calendars**.

## ☐ 7. Optional cleanup

- [ ] Supabase: the new version doesn't use it. Delete the project (Project Settings → General → Delete project) or leave it on the free tier.

---

## If something goes wrong

| You see | Fix |
| --- | --- |
| `redirect_uri_mismatch` | The redirect URI in step 2 must exactly equal `APP_ORIGIN` + `/api/auth/callback` |
| "Access blocked" / "has not completed verification" | Add your Gmail under **Test users**, or **Publish app** |
| "is not allowed to use this app" | Add that email to `ALLOWED_EMAILS`, then redeploy |
| Sign-in button greyed out | The Vercel variables are missing, or you haven't redeployed |
| Signed out every week | The app is still in Testing; **Publish app** |
| Anything else | Send Claude a screenshot or the exact error text |

## Good to know

- **Reminders** come from the Google Calendar app on your phone. Set them per event in the app, or keep Google's defaults.
- **Goals, streaks and notes** are saved privately in a hidden folder in your Google Drive.
- **To-do due dates** are date-only, because that's all Google Tasks supports.
- **Moving an event** works by editing its date and time; drag-and-drop isn't in this version.
- **"This and following" edits** on a repeating event start a new series. One-off changes you had made to later occurrences aren't carried over.
- **The previous Supabase version** is saved in GitHub under the tag `v1-supabase`.
