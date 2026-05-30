#!/usr/bin/env bash
# 为 Tauri 生成的 iOS 项目注入 NSLocalNetworkUsageDescription 到 Info.plist。
# 用法：在 `cargo tauri ios init` 之后运行一次。
#   bash scripts/patch-ios-plist.sh
set -euo pipefail

PLIST=$(find src-tauri/gen/apple -name "Info.plist" -not -path "*/Pods/*" 2>/dev/null | head -1)

if [ -z "$PLIST" ]; then
  echo "❌ 未找到 Info.plist，请先运行: cargo tauri ios init"
  exit 1
fi

if grep -q "NSLocalNetworkUsageDescription" "$PLIST"; then
  echo "✅ Info.plist 已包含 NSLocalNetworkUsageDescription，无需修改"
  exit 0
fi

# 在 </dict> 前插入键值对
sed -i.bak '/<\/dict>/i\
\t<key>NSLocalNetworkUsageDescription</key>\
\t<string>SynoLink 需要访问本地网络以连接你的群晖 NAS</string>' "$PLIST"
rm -f "${PLIST}.bak"

echo "✅ 已注入 NSLocalNetworkUsageDescription → $PLIST"
