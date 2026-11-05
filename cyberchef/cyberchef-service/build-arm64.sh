#!/bin/bash
# ─── 在开发机(Apple Silicon Mac)构建 linux/arm64 一体化镜像并导出 ──────────
#
# 产物(写入 image/):
#   cyberchef-zh-v<版本>-<日期>-arm64.tar.gz   Web + MCP 单容器镜像(docker save)
#   对应 .sha256                               SHA256 校验文件
# 同时把 cyberchef/cyberchef-service/.env 的 CYBERCHEF_IMAGE 更新为新 tag。
#
# 构建上下文是仓库根目录,包含工作区未提交的汉化改动;.dockerignore 已排除
# node_modules/build/cyberchef,不用担心镜像包被卷进构建上下文。
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
# 本脚本位于 <仓库根>/cyberchef/cyberchef-service/,仓库根在两级之上
ROOT="$(cd "$DEPLOY_DIR/../.." && pwd)"
IMAGE_DIR="$DEPLOY_DIR/image"
ENV_FILE="$DEPLOY_DIR/.env"

VERSION="$(node -p "require('$ROOT/package.json').version")"
STAMP="$(date +%Y%m%d)"
TAG="cyberchef:zh-v${VERSION}-${STAMP}"
ARCHIVE="$IMAGE_DIR/cyberchef-zh-v${VERSION}-${STAMP}-arm64.tar.gz"

mkdir -p "$IMAGE_DIR"

echo "▶ 构建 $TAG (linux/arm64, Web + MCP 一体化)"
docker buildx build \
    --platform linux/arm64 \
    --load \
    --tag "$TAG" \
    --file "$DEPLOY_DIR/Dockerfile" \
    "$ROOT"

arch="$(docker image inspect "$TAG" --format '{{.Os}}/{{.Architecture}}')"
[ "$arch" = "linux/arm64" ] || { echo "❌ 镜像架构异常: $arch" >&2; exit 1; }

echo "▶ 导出离线镜像包(gzip,可能需要几分钟)"
docker save "$TAG" | gzip > "$ARCHIVE"
( cd "$IMAGE_DIR" && shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256" )

if grep -q "^CYBERCHEF_IMAGE=" "$ENV_FILE"; then
    sed "s|^CYBERCHEF_IMAGE=.*|CYBERCHEF_IMAGE=$TAG|" \
        "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
else
    echo "CYBERCHEF_IMAGE=$TAG" >> "$ENV_FILE"
fi

echo "✅ 完成"
ls -lh "$ARCHIVE" "$ARCHIVE.sha256"
echo "  .env 已指向: $TAG"
echo "下一步: cyberchef/ 整目录传到 ARM Linux 服务器后执行 bash deploy.sh start"
