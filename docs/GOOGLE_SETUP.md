# Connecting Google (about 10 minutes, free)

Big Ass Calendar signs in with Google and reads and writes your own Google Calendar, Google Tasks and a private app folder in Google Drive. To allow that, Google needs to know about the app. You do this once in Google Cloud, then paste three values into Vercel.

You need the address of your Vercel site, for example `https://bigasscalendar.vercel.app`. In the steps below it's called **YOUR-SITE**.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with your Gmail.
2. Click the project picker at the top → **New project** → name it `Big Ass Calendar` → **Create**. Make sure it's selected.

## 2. Turn on the three APIs

Go to **APIs & Services → Library**. Search for each of these, open it, and click **Enable**:

- **Google Calendar API**
- **Google Tasks API**
- **Google Drive API**

## 3. Set up the consent screen

Go to **APIs & Services → OAuth consent screen**. On newer consoles this is called **Google Auth Platform**.

1. **Get started** / **Branding**: app name `Big Ass Calendar`, your email as the support email and the developer contact.
2. **Audience**: choose **External**.
3. **Test users** → **Add users**: add your Gmail and Tehron's Gmail.
4. **Data access** (optional but tidy) → **Add or remove scopes** and tick:
   - `.../auth/calendar`
   - `.../auth/tasks`
   - `.../auth/drive.appdata`

> **Testing vs. In production.** While the app is in **Testing**, Google signs you out every **7 days** (its refresh tokens expire), so you would have to sign in again weekly. To avoid that, go to **Audience → Publish app**.
>
> - You do **not** need Google's verification for two people.
> - Each of you will see a "Google hasn't verified this app" screen once. Click **Advanced → Go to Big Ass Calendar**.
> - Keep `ALLOWED_EMAILS` set in Vercel (step 5) so only the two of you can sign in.

## 4. Create the OAuth client

Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. On newer consoles: **Clients → Create client**.

1. Application type: **Web application**. Name: `Big Ass Calendar web`.
2. **Authorized JavaScript origins** → add `https://YOUR-SITE`.
3. **Authorized redirect URIs** → add `https://YOUR-SITE/api/auth/callback`.
   - For local development you can also add `http://localhost:5173/api/auth/callback`.
4. Click **Create**. Copy the **Client ID** and **Client secret**.

## 5. Add the values in Vercel

In Vercel, open your project → **Settings → Environment Variables**, and add these for **Production**:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 4 |
| `SESSION_SECRET` | a long random string; run `openssl rand -base64 32`, or mash the keyboard for 40+ characters |
| `APP_ORIGIN` | `https://YOUR-SITE` (no trailing slash) |
| `ALLOWED_EMAILS` | `you@gmail.com,tehron@gmail.com` |

You can delete the old `DATABASE_URL`, `POSTGRES_URL` and `CRON_SECRET` variables; this version doesn't use them.

Then go to **Deployments → ⋯ → Redeploy**, so the new variables take effect.

## 6. Sign in

Open `https://YOUR-SITE` on your phone → **Sign in with Google**. On the permission screen, keep all boxes ticked: Calendar, Tasks, and "see, create, and delete its own configuration data in your Google Drive".

Tip: on iPhone, tap **Share → Add to Home Screen** for an app-like icon.

## Seeing Tehron's schedule

Tehron signs in with his own Gmail; he must be in **Test users** (or the app must be published) and in `ALLOWED_EMAILS`. To see each other's events:

1. On a computer, open Google Calendar → **Settings** → under *Settings for my calendars*, click the calendar.
2. **Share with specific people or groups** → add the other person's Gmail → choose **See all event details** (or **Make changes to events**).

The shared calendar then appears in Big Ass Calendar automatically. Show or hide it from **Menu → Calendars**.

## Troubleshooting

- **"redirect_uri_mismatch"**: the redirect URI in step 4 must exactly match `APP_ORIGIN` + `/api/auth/callback`.
  - Vercel *preview* links have different addresses, so use your production address.
- **"Access blocked: app has not completed verification"**: your Gmail isn't in **Test users** yet, or the app isn't published (step 3).
- **Signed out every week**: the app is still in Testing; publish it (step 3).
- **"is not allowed to use this app"**: add that email to `ALLOWED_EMAILS` and redeploy.
- **Sign-in button greyed out**: the Vercel variables are missing, or you haven't redeployed.
