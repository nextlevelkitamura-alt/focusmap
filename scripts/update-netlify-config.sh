#!/bin/bash

# New Production URL
SITE_URL="https://shikumika.netlify.app"

echo "⚙️ Updating Netlify Environment Variables for $SITE_URL..."

# 1. Update NEXTAUTH_URL
echo "   Setting NEXTAUTH_URL..."
npx netlify env:set NEXTAUTH_URL "$SITE_URL"

# 2. Update GOOGLE_REDIRECT_URI
echo "   Setting GOOGLE_REDIRECT_URI..."
npx netlify env:set GOOGLE_REDIRECT_URI "$SITE_URL/api/auth/callback/google"

# 3. Cleanup unused Vercel variables
echo "🧹 Cleaning up unused Vercel variables..."
npx netlify env:unset VERCEL_OIDC_TOKEN

echo "✅ Configuration updated!"
echo "   Please adhere to the manual steps for Google Cloud Console and Supabase as CLI cannot access them."
