#!/bin/sh
# 把 yt-dlp 下到 resources/，下载功能靠它。
set -e
cd "$(dirname "$0")/.."
mkdir -p resources
if [ -f resources/yt-dlp ]; then
  echo "已经存在：$(./resources/yt-dlp --version)"
  exit 0
fi
curl -L -o resources/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
chmod +x resources/yt-dlp
echo "装好了：$(./resources/yt-dlp --version)"
