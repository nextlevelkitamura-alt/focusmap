# Netlify Migration Guide

This guide outlines the steps to migrate the SHIKUMIKA application from Vercel to Netlify.

## 1. Prerequisites

- A GitHub account with access to the `shikumika-app` repository.
- A Netlify account (can be created using GitHub).

## 2. Setting up Netlify

1.  Log in to [Netlify](https://app.netlify.com/).
2.  Click **"Add new site"** > **"Import from an existing project"**.
3.  Select **"GitHub"**.
4.  Authorize Netlify to access your GitHub repositories.
5.  Search for and select **`shikumika-app`**.

## 3. Build Settings

Netlify should automatically detect the Next.js project settings:

- **Build command**: `npm run build` (or `next build`)
- **Publish directory**: `.next`
- **Netlify Plugin**: ensure the "Essential Next.js" plugin is installed (usually automatic).

## 4. Environment Variables

Click on **"Show advanced"** or go to **"Site settings" > "Environment variables"** after creation, and add the following keys.

**CRITICAL**: You must copy these values from your local `.env.local` or the Vercel dashboard.

| Key | Description |
| :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Key |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `NEXTAUTH_URL` | **UPDATE THIS**: Set to your new Netlify URL (e.g., `https://shikumika-app.netlify.app`) |
| `NEXTAUTH_SECRET` | (Optional) Recommended to set a random string for production security |

> **Note**: `VERCEL_OIDC_TOKEN` is specific to Vercel and **should not** be copied.

### Option B: Automatic Migration via CLI (Recommended)

Since you provided the Project ID, you can run the helper script we created:

```bash
./scripts/migrate-to-netlify.sh
```

This script will:
1. Link your local folder to the Netlify site (`9d7de87b-09d2-4eb8-8a7c-a6efef905cd6`).
2. Automatically import all variables from `.env.local` to Netlify.

### Option C: Update & Cleanup Script (For URL Changes)

If your URL changes (e.g. to `https://shikumika.netlify.app`), run:

```bash
./scripts/update-netlify-config.sh
```

This will automatically:
- Update `NEXTAUTH_URL`
- Update `GOOGLE_REDIRECT_URI`
- Remove unused `VERCEL_OIDC_TOKEN`

## 5. Post-Migration Steps

1.  **Deploy**: Click "Deploy site".
2.  **Update Google OAuth**:
    - Go to [Google Cloud Console](https://console.cloud.google.com/).
    - Navigate to APIs & Services > Credentials.
    - Edit your OAuth 2.0 Client ID.
    - Add your new Netlify URL to **"Authorized JavaScript origins"** (e.g., `https://shikumika-app.netlify.app`).
    - Add the new callback URL to **"Authorized redirect URIs"**:
        - `https://shikumika-app.netlify.app/api/auth/callback/google`
3.  **Verify**: Open the new Netlify URL and check if:
    - Login works
    - Calendar data loads
    - Task creation works
