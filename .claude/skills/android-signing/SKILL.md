---
name: android-signing
description: Create or replace Better GitHub's Android signing key and the GitHub Actions secrets CI signs with. Use when setting up signing for the first time, when builds warn "ANDROID_KEYSTORE is not set", when the key is lost or must be rotated, or when doing local release builds.
---

# Android signing

Release APKs are signed with **this app's own upload key**. It is deliberately
separate from other apps' keys (e.g. tally). Different package IDs install side
by side either way, but separate keys keep one app's key from affecting another.

CI reads three repository secrets (`.github/workflows/android.yml`, step "Write
signing config"):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE` | the PKCS12 keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password, also the key password |
| `ANDROID_KEY_ALIAS` | the key alias |

The step writes `src-tauri/gen/android/keystore.properties` (`keyAlias`,
`password`, `storeFile`), which `src-tauri/gen/android/app/build.gradle.kts` uses
for the release signing config. Without that file, release builds fall back to the
debug key.

## One-time setup

This is a one-off done by the owner on their own machine. Keep the script out of
the repo. It needs the JDK's `keytool` and an authenticated GitHub CLI
(`gh auth login`). Paste it at the root of a better-github checkout:

```sh
bash <<'SETUP'
set -euo pipefail
REPO=madsbuch/better-github
KEYSTORE="$HOME/.tauri/keystores/gh-commander-upload.jks"
KEY_ALIAS=gh-commander
PROPERTIES="$(git rev-parse --show-toplevel)/src-tauri/gen/android/keystore.properties"

command -v keytool >/dev/null || { echo "keytool not found (it ships with the JDK)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }
[ -e "$KEYSTORE" ] && { echo "$KEYSTORE already exists, not overwriting it"; exit 1; }

STORE_PASSWORD="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)"
export STORE_PASSWORD
mkdir -p "$(dirname "$KEYSTORE")"
keytool -genkeypair -noprompt -keystore "$KEYSTORE" -storetype PKCS12 \
  -storepass:env STORE_PASSWORD -keypass:env STORE_PASSWORD \
  -alias "$KEY_ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Better GitHub" >/dev/null
chmod 600 "$KEYSTORE"

base64 < "$KEYSTORE" | tr -d '\n' | gh secret set ANDROID_KEYSTORE -R "$REPO"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$KEY_ALIAS" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"

umask 077
printf 'keyAlias=%s\npassword=%s\nstoreFile=%s\n' "$KEY_ALIAS" "$STORE_PASSWORD" "$KEYSTORE" > "$PROPERTIES"

echo "Done. Back up the keystore and password (e.g. in your password manager):"
echo "  $KEYSTORE"
echo "  $STORE_PASSWORD"
SETUP
```

It refuses to overwrite an existing keystore. The keystore and its password must
be backed up: they can't be read back out of GitHub secrets.

## Verifying

Push to any branch (or run the Android workflow manually) and open the "Write
signing config" step:

- env shows `KEYSTORE_B64: ***`, `KEYSTORE_PASSWORD: ***`, `KEY_ALIAS: ***`
- there is no `ANDROID_KEYSTORE is not set` warning
- "Build APK" succeeds. A wrong password or alias fails Gradle's signing
  validation instead of producing an APK.

## Rotating or losing the key

Android only installs an update if it is signed with the same key as the installed
copy. A new key means everyone must uninstall once and lose the app's local data
(sign-in, pending review comments). To rotate on purpose: move the old keystore
away, run the setup again (it overwrites the secrets), and expect that one-time
reinstall.

## Local release builds

`npm run tauri android build -- --apk` signs with whatever
`src-tauri/gen/android/keystore.properties` points to (git-ignored). The setup
script writes it. On another machine, copy the keystore over and write the file
by hand with the same three values.
