#!/bin/bash
# Resolve webkit2gtk-4.1-dev deps iteratively (BFS) and extract locally.
LOG=/home/z/my-project/scripts/webkit-deps.log
exec > "$LOG" 2>&1
set -x
mkdir -p /tmp/debs /home/z/tauri-prefix
cd /tmp/debs

todo="libwebkit2gtk-4.1-dev"
round=0
while [ -n "$todo" ] && [ $round -lt 30 ]; do
  round=$((round+1))
  echo "--- round $round: $(echo $todo | wc -w) packages"
  next=""
  for p in $todo; do
    dpkg -s "$p" >/dev/null 2>&1 && continue
    if ! ls "${p}"_*.deb >/dev/null 2>&1; then
      apt-get download "$p" >/dev/null 2>&1 || { echo "download failed: $p"; continue; }
    fi
    # direct dependencies (ignore pre-depends + virtual <names>)
    deps=$(apt-cache depends "$p" 2>/dev/null | awk '/^[[:space:]]*(Depends|Recommends):[[:space:]]/ {print $2}')
    for d in $deps; do
      case "$d" in
        "<"*|"" ) continue ;;
      esac
      dpkg -s "$d" >/dev/null 2>&1 && continue
      case " $next " in
        *" $d "*) ;;
        *) next="$next $d" ;;
      esac
    done
  done
  todo="$next"
done

echo "=== downloaded $(ls /tmp/debs/*.deb 2>/dev/null | wc -l) debs ==="
for f in /tmp/debs/*.deb; do
  [ -e "$f" ] || continue
  dpkg -x "$f" /home/z/tauri-prefix 2>/dev/null || echo "extract failed: $f"
done
echo "pkgconfig files:"
find /home/z/tauri-prefix -name '*.pc' -path '*pkgconfig*' | grep -cE 'webkit|gtk|soup|javascript' || true
echo "=== WEBKIT DEPS DONE ==="
