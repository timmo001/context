#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
output_dir="${1:?output directory required}"

cd "$repo_root"
prefix_version="$(bun -e 'const pkg = await Bun.file("package.json").json(); process.stdout.write(pkg.version)')"
pkgver="${prefix_version}.r$(git rev-list --count HEAD).g$(git rev-parse --short=7 HEAD)"

mkdir -p "$output_dir"
install -m 0644 "$script_dir/PKGBUILD" "$output_dir/PKGBUILD"
sed -i "s/^pkgver=.*/pkgver=${pkgver}/" "$output_dir/PKGBUILD"
grep -Fxq "pkgver=${pkgver}" "$output_dir/PKGBUILD"

echo "Prepared context-git ${pkgver} in ${output_dir}"
