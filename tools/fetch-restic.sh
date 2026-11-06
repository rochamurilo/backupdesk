#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p windows/build bin
restic_tmp=$(mktemp -d)
trap 'rm -rf "$restic_tmp"' EXIT
curl --fail --location 'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_windows_amd64.zip' -o "$restic_tmp/windows.zip"
printf '%s  %s\n' 'da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d' "$restic_tmp/windows.zip" | sha256sum --check -
unzip -p "$restic_tmp/windows.zip" restic_0.19.1_windows_amd64.exe > windows/build/restic.exe
printf '%s  %s\n' 'b0dd1fd21eea5d8fe1325f55f7118213c21f36de8a261e04c0624a5ab9fd7830' windows/build/restic.exe | sha256sum --check -
printf '%s  %s\n' 'f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c' vendor/restic/restic_0.19.1_linux_amd64.bz2 | sha256sum --check -
bzip2 -dc vendor/restic/restic_0.19.1_linux_amd64.bz2 > bin/restic
chmod +x bin/restic
