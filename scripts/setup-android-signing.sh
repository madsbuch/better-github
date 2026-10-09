#!/usr/bin/env bash
# One-time setup of GitHub Commander's own Android signing key.
#
# Creates a new upload keystore (separate from your other apps' keys), stores
# it in the repository's GitHub Actions secrets for CI, and writes the git-ignored
# keystore.properties for local release builds. Run it on your own machine;
# the key never leaves it except as an encrypted GitHub secret.
#
#   ./scripts/setup-android-signing.sh
#
# Requires the JDK's keytool and an authenticated GitHub CLI (gh auth login).
# Overrides: REPO=owner/name, KEYSTORE=/path/to/new.jks, KEY_ALIAS=name.

set -euo pipefail

REPO="${REPO:-madsbuch/gh-commander}"
KEYSTORE="${KEYSTORE:-$HOME/.tauri/keystores/gh-commander-upload.jks}"
KEY_ALIAS="${KEY_ALIAS:-gh-commander}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROPERTIES="$ROOT/src-tauri/gen/android/keystore.properties"

fail() {
  echo "error: $*" >&2
  exit 1
}

command -v keytool >/dev/null || fail "keytool not found. It ships with the JDK."
command -v gh >/dev/null || fail "GitHub CLI (gh) not found."
gh auth status >/dev/null 2>&1 || fail "gh is not signed in. Run: gh auth login"
# Never replace an existing key: Android only installs updates signed with it.
[ -e "$KEYSTORE" ] && fail "$KEYSTORE already exists. Refusing to overwrite it."

# 32 random alphanumeric characters. PKCS12 keystores use one password for the
# store and the key.
STORE_PASSWORD="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)"
[ "${#STORE_PASSWORD}" -eq 32 ] || fail "could not generate a password"
export STORE_PASSWORD

mkdir -p "$(dirname "$KEYSTORE")"
keytool -genkeypair -noprompt \
  -keystore "$KEYSTORE" -storetype PKCS12 \
  -storepass:env STORE_PASSWORD -keypass:env STORE_PASSWORD \
  -alias "$KEY_ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=GitHub Commander" >/dev/null
chmod 600 "$KEYSTORE"
echo "Created $KEYSTORE (alias $KEY_ALIAS)"

base64 < "$KEYSTORE" | tr -d '\n' | gh secret set ANDROID_KEYSTORE -R "$REPO"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$KEY_ALIAS" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
echo "Set ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_ALIAS on $REPO"

if [ -d "$(dirname "$PROPERTIES")" ]; then
  umask 077
  printf 'keyAlias=%s\npassword=%s\nstoreFile=%s\n' "$KEY_ALIAS" "$STORE_PASSWORD" "$KEYSTORE" > "$PROPERTIES"
  echo "Wrote $PROPERTIES for local release builds (git-ignored)"
fi

cat <<EOF

Back up the keystore and its password now, for example in your password manager:
  keystore: $KEYSTORE
  password: $STORE_PASSWORD
Without them, future builds can't update installed copies of the app.
EOF
