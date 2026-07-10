#!/usr/bin/env bash
# Update the AUR package for context-git
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUR_PACKAGE_NAME="context-git"
AUR_REPO_URL="ssh://aur@aur.archlinux.org/${AUR_PACKAGE_NAME}.git"
IS_CI="${CI:-false}"
TEMP_DIR=""

cleanup() {
  if [ "$IS_CI" = "true" ]; then
    [ -z "$TEMP_DIR" ] || rm -rf "$TEMP_DIR"
    [ -z "${BUILDDIR:-}" ] || rm -rf "$BUILDDIR"
    rm -f ~/.ssh/aur_rsa ~/.ssh/config
  fi
}

trap cleanup EXIT

echo "Updating $AUR_PACKAGE_NAME AUR package..."
echo "Running in CI: $IS_CI"

if [ "$IS_CI" = "true" ]; then
  if [ -z "${AUR_SSH_PRIVATE_KEY:-}" ]; then
    echo "Error: AUR_SSH_PRIVATE_KEY environment variable not set"
    exit 1
  fi

  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  printf '%s\n' "$AUR_SSH_PRIVATE_KEY" >~/.ssh/aur_rsa
  chmod 600 ~/.ssh/aur_rsa

  if ! grep -q "BEGIN.*PRIVATE KEY" ~/.ssh/aur_rsa; then
    echo "Error: SSH key format appears invalid"
    exit 1
  fi

  ssh-keyscan -H aur.archlinux.org >>~/.ssh/known_hosts 2>/dev/null
  cat <<'EOF' >~/.ssh/config
Host aur.archlinux.org
  IdentityFile ~/.ssh/aur_rsa
  User aur
  StrictHostKeyChecking accept-new
EOF
  chmod 600 ~/.ssh/config

  TEMP_DIR=$(mktemp -d)
  cd "$TEMP_DIR"
  git clone "$AUR_REPO_URL" aur-repo
  cd aur-repo
  git config --global --add safe.directory "$(pwd)"
  git config user.name "Context Bot"
  git config user.email "github-actions@timmo001.com"
  chmod 755 "$TEMP_DIR"
  AUR_REPO_PATH="$(pwd)"
else
  AUR_REPO_PATH="$HOME/repos/aur/$AUR_PACKAGE_NAME"
  if [ ! -d "$AUR_REPO_PATH" ]; then
    echo "Error: AUR repository not found at $AUR_REPO_PATH"
    echo "Clone it first with: git clone $AUR_REPO_URL"
    exit 1
  fi
  cd "$AUR_REPO_PATH"
fi

cd "$REPO_ROOT"
PREFIX_VERSION=$(bun -e 'const pkg = await Bun.file("package.json").json(); process.stdout.write(pkg.version)')
REV_COUNT=$(git rev-list --count HEAD)
SHORT_HASH=$(git rev-parse --short=7 HEAD)
PKGVER="${PREFIX_VERSION}.r${REV_COUNT}.g${SHORT_HASH}"

echo "Generated version: $PKGVER"

cd "$AUR_REPO_PATH"
cp "$SCRIPT_DIR/PKGBUILD" PKGBUILD
sed -i "s/^pkgver=.*/pkgver=${PKGVER}/" PKGBUILD

export BUILDDIR="/tmp/makepkg-build"
mkdir -p "$BUILDDIR"

if [ "$IS_CI" = "true" ]; then
  env -i HOME="$HOME" BUILDDIR="$BUILDDIR" bash --noprofile --norc -c 'makepkg --printsrcinfo > .SRCINFO'
else
  makepkg --printsrcinfo >.SRCINFO
fi

echo ""
echo "Changes:"
git diff

if ! git status --porcelain | grep -q .; then
  echo ""
  echo "No changes detected. AUR package is already up to date."
  exit 0
fi

if [ "$IS_CI" = "true" ]; then
  git add -f PKGBUILD .SRCINFO
  git commit -m "Update to version $PKGVER

Automated update from GitHub Actions
Commit: ${GITHUB_SHA}
"
  git push origin master
  echo "Successfully updated AUR package to version $PKGVER"
else
  echo ""
  echo "Ready to commit and push to AUR"
  echo ""
  echo "To commit and push, run:"
  echo "  cd $AUR_REPO_PATH"
  echo "  git add PKGBUILD .SRCINFO"
  echo "  git commit -m 'Update to version $PKGVER'"
  echo "  git push"
fi
