#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=24.19.0
archive="node-v${version}-win-x64.zip"
mkdir -p windows/build dist
bash tools/fetch-restic.sh
build_tmp=$(mktemp -d)
trap 'rm -rf "$build_tmp"' EXIT
curl --fail --location "https://nodejs.org/dist/v${version}/${archive}" -o "$build_tmp/$archive"
curl --fail --location "https://nodejs.org/dist/v${version}/SHASUMS256.txt" -o "$build_tmp/SHASUMS256.txt"
(cd "$build_tmp"; rg "  ${archive}$" SHASUMS256.txt | sha256sum --check -)
unzip -p "$build_tmp/$archive" "node-v${version}-win-x64/node.exe" > windows/build/node.exe
unzip -p "$build_tmp/$archive" "node-v${version}-win-x64/LICENSE" > windows/build/LICENSE
"${MAKENSIS:-makensis}" -DCLIENT windows/launcher.nsi
"${MAKENSIS:-makensis}" -DCLIENT windows/vss-component.nsi
"${MAKENSIS:-makensis}" -DCLIENT -DUPDATE_ONLY windows/installer.nsi
"${MAKENSIS:-makensis}" -DCLIENT windows/installer.nsi
cp windows/build/BackupDesk-Client-0.32.0-x64.exe dist/
"${MAKENSIS:-makensis}" windows/launcher.nsi
"${MAKENSIS:-makensis}" windows/vss-component.nsi
"${MAKENSIS:-makensis}" -DUPDATE_ONLY windows/installer.nsi
"${MAKENSIS:-makensis}" windows/installer.nsi
(cd dist; sha256sum BackupDesk-Master-0.32.0-x64.exe BackupDesk-Atualizacao-Client-0.32.0-x64.exe BackupDesk-Atualizacao-Master-0.32.0-x64.exe > SHA256SUMS.txt)
