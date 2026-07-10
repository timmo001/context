#!/bin/bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ] && id -u builduser >/dev/null 2>&1; then
  echo "Switching to builduser for packaging..."
  chown -R builduser:builduser "$(pwd)"
  exec sudo --preserve-env=VERSION -u builduser -H bash "$0" "$@"
fi

if ! command -v makepkg >/dev/null 2>&1; then
  echo "makepkg not found, attempting installation..."
  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -Syu --noconfirm --needed base-devel
  else
    echo "makepkg is Arch-specific. Please run this script on Arch or use the CI containerized build." >&2
    exit 1
  fi
fi

if [ ! -f "dist/context" ]; then
  echo "dist/context not found, please build the application first"
  exit 1
fi

PACKAGE_VERSION=$(bun -e 'const pkg = await Bun.file("package.json").json(); process.stdout.write(pkg.version)')

mkdir -p build/arch
cd build/arch

cp ../../dist/context context
cp ../../LICENSE LICENSE
cp ../../.scripts/linux/PKGBUILD.binary PKGBUILD

./context completions zsh >context.zsh
./context completions bash >context.bash
./context completions fish >context.fish

ARCH_PKGVER="${VERSION:-${PACKAGE_VERSION}.r0.local}"
ARCH_PKGVER="${ARCH_PKGVER//-/.}"
ARCH_PKGVER="${ARCH_PKGVER//+/.}"
export ARCH_PKGVER

echo "ARCH_PKGVER: $ARCH_PKGVER"
makepkg -g >new_sums.txt
sed -i '/^sha256sums=(/,/^)/d' PKGBUILD
awk '
  /source=/ { print; while ((getline line < "new_sums.txt") > 0) print line; next }
  { print }
' PKGBUILD >PKGBUILD.new && mv PKGBUILD.new PKGBUILD
rm new_sums.txt

makepkg -f --noconfirm
mkdir -p ../../dist
mv ./*.pkg.tar.zst ../../dist/

cd ../..
rm -rf build/arch

echo "Package created successfully!"
echo "Install with: yay -U dist/context-${ARCH_PKGVER}-1-x86_64.pkg.tar.zst"
