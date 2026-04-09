#!/bin/bash
cd /Users/guyso/Code/Wix/wix-paperclip-ui
git add vercel.json
git commit -m "fix: optimize Vercel build with npm ci and legacy-peer-deps"
git push origin main
echo "✅ Changes pushed! Vercel will auto-deploy."
