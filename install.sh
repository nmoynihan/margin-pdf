#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [--build-only]

Build and install the current Margin PDF package on Omarchy / Arch Linux.
Run from any directory. sudo is used for missing packaging dependencies
and the final pacman installation.

  --build-only  Build and verify the package without installing it.
  -h, --help    Show this help.
EOF
}

build_only=false
case "${1:-}" in
  '') ;;
  --build-only) build_only=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  usage >&2
  exit 2
fi

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$project_dir"

if (( EUID == 0 )); then
  echo 'Run this script as your normal user. It requests privileges when needed.' >&2
  exit 1
fi

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This installer requires x86_64 Linux. See README.md for other platforms.' >&2
  exit 1
fi
if [[ "$build_only" == false ]] && ! command -v pacman >/dev/null 2>&1; then
  echo 'Installation requires Omarchy / Arch Linux and pacman.' >&2
  exit 1
fi
for command in node npm bsdtar zstd; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing build dependency: $command. On Arch, install nodejs npm libarchive zstd." >&2
    exit 1
  fi
done
if command -v pacman >/dev/null 2>&1 && ! pacman -Q libxcrypt-compat >/dev/null 2>&1; then
  if [[ "$build_only" == true ]]; then
    echo 'Missing build dependency: libxcrypt-compat (provides libcrypt.so.1).' >&2
    echo 'Install it once with: sudo pacman -S --needed libxcrypt-compat' >&2
    exit 1
  fi
  echo 'Installing the missing packaging dependency: libxcrypt-compat…'
  if command -v omarchy >/dev/null 2>&1; then
    omarchy pkg add libxcrypt-compat
  elif command -v sudo >/dev/null 2>&1; then
    sudo pacman -S --needed -- libxcrypt-compat
  else
    echo 'sudo is required to install libxcrypt-compat.' >&2
    exit 1
  fi
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo 'Building Margin PDF requires Node.js 24 or later.' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  npm ci
fi
echo 'Building Margin PDF…'
npm run dist:arch

package_file="$project_dir/dist/$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
  console.log(`${name}-${version}-1-x86_64.pkg.tar.zst`);
')"
if [[ ! -f "$package_file" ]]; then
  echo "The build did not produce the expected package: $package_file" >&2
  exit 1
fi
npm run test:arch-package -- "$package_file"

if [[ "$build_only" == true ]]; then
  printf 'Package ready: %s\n' "$package_file"
  exit 0
fi
if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to install the package: $package_file" >&2
  exit 1
fi
sudo pacman -U -- "$package_file"
echo 'Margin PDF is installed. Open Margin PDF from your application launcher.'
