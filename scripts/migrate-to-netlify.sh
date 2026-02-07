#!/bin/bash

# Netlify Site ID provided by user
SITE_ID="9d7de87b-09d2-4eb8-8a7c-a6efef905cd6"

echo "🔗 Linking to Netlify site ($SITE_ID)..."
# Link the project to the existing Netlify site
# We use npx to avoid requiring global installation
# --id specifies the site directly
if npx netlify link --id $SITE_ID; then
    echo "✅ Site linked successfully."
else
    echo "❌ Failed to link site. Please make sure you are logged in using 'npx netlify login'."
    exit 1
fi

echo "📦 Importing environment variables from .env.local..."
# Import variables from .env.local to Netlify
# This effectively copies NEXT_PUBLIC_SUPABASE_URL, etc.
if npx netlify env:import .env.local; then
    echo "✅ Environment variables imported successfully!"
    echo "   (Note: You may want to manually remove VERCEL_OIDC_TOKEN from Netlify dashboard if imported, but it's harmless)"
else
    echo "❌ Failed to import environment variables."
    exit 1
fi

echo "🚀 Usage confirmation:"
echo "   Run 'npx netlify open' to view your site dashboard and verify settings."
