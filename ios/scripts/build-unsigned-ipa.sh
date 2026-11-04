#!/usr/bin/env bash
# Збирає непідписаний LifeGame.ipa на macOS (GitHub Actions / Codemagic).
# Підписуєш його вже на Windows через Sideloadly або AltStore своїм безкоштовним Apple ID.
set -euo pipefail
cd "$(dirname "$0")/../.."

# найновіший Xcode на машині (AlarmKit потребує Xcode 26+)
LATEST_XCODE=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1 || true)
if [ -n "${LATEST_XCODE}" ] && [ -z "${CM_BUILD_ID:-}" ]; then
  sudo xcode-select -s "${LATEST_XCODE}/Contents/Developer" || true
fi
xcodebuild -version

npm ci
npx ng build
npx cap sync ios

xcodebuild -project ios/App/App.xcodeproj -scheme App -resolvePackageDependencies
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build

rm -rf Payload LifeGame.ipa
mkdir Payload
cp -R build/Build/Products/Release-iphoneos/App.app Payload/
zip -qry LifeGame.ipa Payload
ls -lh LifeGame.ipa
