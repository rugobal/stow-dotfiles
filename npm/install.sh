#!/usr/bin/env bash
# Install the global npm packages listed in global-packages.txt into the active node (nvm).
set -euo pipefail
cd "$(dirname "$0")"
mapfile -t pkgs < <(grep -v -E '^\s*(#|$)' global-packages.txt)
npm install -g "${pkgs[@]}"
