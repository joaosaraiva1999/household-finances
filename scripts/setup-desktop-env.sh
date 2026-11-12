#!/bin/bash
# Setup Tauri build deps without root: rustup + local extraction of webkit2gtk dev libs
set -x
LOG=/home/z/my-project/scripts/desktop-setup.log
exec > "$LOG" 2>&1

echo "=== [1/3] rustup install ==="
curl -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh
sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain stable
source "$HOME/.cargo/env"
rustc --version
cargo --version

echo "=== [2/3] download webkit2gtk dev closure ==="
mkdir -p /tmp/debs /home/z/tauri-prefix
cd /tmp/debs
PKGS=$(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances libwebkit2gtk-4.1-dev 2>/dev/null | grep '^\w' | sort -u)
echo "closure size: $(echo "$PKGS" | wc -l)"
MISSING=""
for p in $PKGS; do
  dpkg -s "$p" >/dev/null 2>&1 || MISSING="$MISSING $p"
done
echo "missing packages: $(echo $MISSING | wc -w)"
apt-get download $MISSING 2>&1 | tail -5

echo "=== [3/3] extract debs to local prefix ==="
for f in /tmp/debs/*.deb; do
  dpkg -x "$f" /home/z/tauri-prefix 2>/dev/null || echo "extract failed: $f"
done
echo "extracted dirs:"
ls /home/z/tauri-prefix
find /home/z/tauri-prefix -name "*.pc" -path "*pkgconfig*" | wc -l
echo "=== DONE ==="
