#!/bin/sh
# Read-only compatibility check; run manually, keep its schedule disabled.
printf 'Tracker compatibility diagnostic (read only)\n'
id
for tool in python3 python curl jq synowebapi; do command -v "$tool" || true; done
for binary in /var/packages/DownloadStation/target/bin/transmission-daemon /var/packages/DownloadStation/target/bin/transmission-remote; do
  if [ -x "$binary" ]; then "$binary" --version 2>&1; fi
done
ls -ld /var/packages/DownloadStation/target /var/packages/DownloadStation/var /var/packages/DownloadStation/etc 2>/dev/null
find /run -maxdepth 4 -type s -iname '*transmission*' -print 2>/dev/null
find /var/packages/DownloadStation/var -maxdepth 3 -type s -print 2>/dev/null
printf 'Diagnostic complete\n'
