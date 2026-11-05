#!/bin/bash
# ─── CyberChef 汉化版 线上部署运维脚本 ─────────────────────────────────────
#
# 与套件的关系:cyberchef/cyberchef-service/ 目录自带一体化镜像(Web + MCP
# 同容器)、compose.yml 与 .env,本脚本把部署文档里的手工步骤(load / up /
# 升级改 tag / 回滚)收成子命令。目标平台:Linux ARM64(镜像在开发机用
# build-arm64.sh 构建导出)。
#
# 常用:
#   bash deploy.sh start              一键启动:导入镜像 → 启动 → 健康检查
#   bash deploy.sh preflight          只读检查 Docker/Compose 与镜像架构
#   bash deploy.sh load               校验并导入 image/ 下的镜像 tar.gz
#   bash deploy.sh status             容器状态 + 最近日志尾部
#   bash deploy.sh logs [N]           跟随日志(默认 100 行,N=行数)
#   bash deploy.sh restart            重建并重启容器
#   bash deploy.sh stop               停止并移除容器(随时可 start)
#   bash deploy.sh upgrade [tar.gz]   升级:load 新镜像 → 固定新 tag → up
#                                     (不带参数自动选 image/ 里最新的 tar.gz)
#   bash deploy.sh rollback           回到上一个镜像 tag(升级时自动记录)
#
# 状态文件(自动维护,勿手改):
#   .image-history   历代已部署镜像 tag,最新在最后,rollback 用倒数第二条
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
IMAGE_DIR="$SCRIPT_DIR/image"
HISTORY="$SCRIPT_DIR/.image-history"
SERVICE="cyberchef"
PROJECT="cyberchef-service"

cd "$SCRIPT_DIR"

# ─── 小工具 ─────────────────────────────────────────────────────────────────

COMPOSE_BIN=()
compose_cmd() {
    if docker compose version >/dev/null 2>&1; then
        COMPOSE_BIN=(docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_BIN=(docker-compose)
    else
        echo "❌ 未找到 Docker Compose(需要 docker compose 插件或 docker-compose)" >&2
        return 1
    fi
}

compose() {
    compose_cmd
    # -p 固定工程名;up/down 附带 --remove-orphans 清理旧版双容器布局遗留服务
    case "$1" in
        up|down)
            "${COMPOSE_BIN[@]}" -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@" --remove-orphans
            ;;
        *)
            "${COMPOSE_BIN[@]}" -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
            ;;
    esac
}

current_tag() {
    grep -E "^CYBERCHEF_IMAGE=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

# BSD/GNU sed -i 行为不同,统一走临时文件
set_tag() {
    local new="$1"
    sed "s|^CYBERCHEF_IMAGE=.*|CYBERCHEF_IMAGE=$new|" \
        "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
}

host_port() {
    # 绑定形如 0.0.0.0:8080 / 127.0.0.1:8080 / 8080
    local bind port
    bind="$(grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    port="${bind##*:}"
    echo "${port}"
}

sha_cmd() {
    if command -v sha256sum >/dev/null 2>&1; then
        echo "sha256sum"
    else
        echo "shasum -a 256"
    fi
}

verify_archive() {
    local archive="$1" sum_file="${1}.sha256"
    [ -f "$archive" ] || { echo "❌ 镜像包不存在: $archive" >&2; return 1; }
    if [ -f "$sum_file" ]; then
        (cd "$(dirname "$archive")" && \
         $(sha_cmd) -c "$(basename "$sum_file")" >/dev/null) || {
            echo "❌ SHA256 校验失败: $(basename "$archive")" >&2
            return 1
        }
    else
        echo "⚠ 未找到 $(basename "$sum_file"),跳过校验" >&2
    fi
}

# 导入单个归档,成功时向 stdout 输出解析出的镜像 tag(进度信息走 stderr)
load_archive() {
    local archive="$1" loaded
    verify_archive "$archive"
    loaded="$(docker load -i "$archive" 2>&1 | sed -n 's/^Loaded image: //p' | head -1)"
    if [ -z "$loaded" ]; then
        echo "❌ docker load 未返回镜像 tag: $archive" >&2
        return 1
    fi
    echo "✔ 已导入镜像: $loaded" >&2
    echo "$loaded"
}

newest_archive() {
    local newest
    newest="$(ls -t "$IMAGE_DIR"/*.tar.gz 2>/dev/null | head -1 || true)"
    [ -n "$newest" ] || { echo "❌ $IMAGE_DIR 下没有 *.tar.gz 镜像包" >&2; return 1; }
    echo "$newest"
}

# 确保 .env 所选 tag 已在本机;缺失时按新→旧逐个导入 image/ 下的归档
ensure_image() {
    local tag="$1" archive
    if docker image inspect "$tag" >/dev/null 2>&1; then
        return 0
    fi
    echo "镜像 $tag 不在本机,尝试从 image/ 导入..."
    for archive in $(ls -t "$IMAGE_DIR"/*.tar.gz 2>/dev/null || true); do
        load_archive "$archive" >/dev/null || true
        docker image inspect "$tag" >/dev/null 2>&1 && return 0
    done
    echo "❌ 导入后仍找不到镜像 $tag,请确认 image/ 内容与 .env 的 CYBERCHEF_IMAGE" >&2
    return 1
}

wait_healthy() {
    local i
    for i in $(seq 1 30); do
        if [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$SERVICE" 2>/dev/null)" = "healthy" ]; then
            return 0
        fi
        sleep 2
    done
    return 1
}

# ─── 子命令 ─────────────────────────────────────────────────────────────────

cmd_preflight() {
    echo "── Docker / Compose"
    docker version --format 'Docker {{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})' || return 1
    compose_cmd || return 1
    echo "Compose 命令: ${COMPOSE_BIN[*]}"
    echo
    echo "── 配置"
    echo "镜像:  $(current_tag)"
    echo "Web:   $(get_bind CYBERCHEF_BIND) → 容器 8080"
    echo "MCP:   $(get_bind MCP_BIND) → 容器 8090 (/mcp 与 /api/*,无认证仅限内网)"
    echo
    echo "── 镜像"
    local tag arch
    tag="$(current_tag)"
    if docker image inspect "$tag" >/dev/null 2>&1; then
        arch="$(docker image inspect "$tag" --format '{{.Os}}/{{.Architecture}}')"
        echo "已导入: $tag ($arch)"
        if [ "$arch" != "linux/arm64" ]; then
            echo "⚠ 架构不是 linux/arm64,在 ARM64 主机上可能无法运行或需模拟" >&2
        fi
    else
        echo "⚠ 镜像尚未导入,请先执行: bash deploy.sh load" >&2
    fi
    echo
    echo "── 离线包"
    ls -lh "$IMAGE_DIR"/*.tar.gz 2>/dev/null || echo "⚠ image/ 下没有镜像 tar.gz" >&2
}

get_bind() {
    grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

cmd_load() {
    local archive="${1:-}"
    if [ -z "$archive" ]; then
        archive="$(newest_archive)"
    fi
    # 相对路径以 cyberchef-service/ 为基准
    [ "${archive#/}" != "$archive" ] || archive="$SCRIPT_DIR/$archive"
    load_archive "$archive" >/dev/null
}

cmd_start() {
    ensure_image "$(current_tag)"
    compose up -d
    echo "等待服务就绪..."
    if wait_healthy; then
        echo "✅ CyberChef 已启动: http://127.0.0.1:$(host_port CYBERCHEF_BIND)/ (按实际绑定 IP 访问)"
        echo "✅ MCP 端点:        http://127.0.0.1:$(host_port MCP_BIND)/mcp"
    else
        echo "⚠ 服务未就绪,查看日志: bash deploy.sh logs" >&2
        compose ps
        return 1
    fi
}

cmd_status() {
    compose ps
    echo
    echo "── 最近日志(nginx + MCP)"
    docker logs --tail 20 "$SERVICE" 2>&1 || true
}

cmd_logs() {
    local n="${1:-100}"
    docker logs --tail "$n" -f "$SERVICE"
}

cmd_restart() {
    ensure_image "$(current_tag)"
    compose up -d --force-recreate
    wait_healthy || { echo "⚠ 未就绪,查看日志: bash deploy.sh logs" >&2; return 1; }
}

cmd_stop() {
    compose down
}

cmd_upgrade() {
    local archive="${1:-}" loaded old
    if [ -z "$archive" ]; then
        archive="$(newest_archive)"
    fi
    [ "${archive#/}" != "$archive" ] || archive="$SCRIPT_DIR/$archive"

    loaded="$(load_archive "$archive")" || return 1
    loaded="$(echo "$loaded" | tail -1)"

    local arch
    arch="$(docker image inspect "$loaded" --format '{{.Os}}/{{.Architecture}}')"
    if [ "$arch" != "linux/arm64" ]; then
        echo "❌ 新镜像架构为 $arch,不是 linux/arm64,已拒绝发布(镜像已导入但未切换 tag)" >&2
        return 1
    fi

    old="$(current_tag)"
    if [ "$loaded" != "$old" ]; then
        echo "$loaded" >> "$HISTORY"
        set_tag "$loaded"
        echo "镜像 tag: $old → $loaded"
    fi
    compose up -d
    echo "等待服务就绪..."
    wait_healthy || { echo "⚠ 未就绪,可回滚: bash deploy.sh rollback" >&2; return 1; }
    echo "✅ 升级完成: $loaded"
}

cmd_rollback() {
    [ -s "$HISTORY" ] || { echo "❌ 没有升级历史($HISTORY 为空),无法回滚" >&2; return 1; }
    local hist
    hist=($(cat "$HISTORY"))
    local count=${#hist[@]}
    [ "$count" -ge 2 ] || { echo "❌ 历史里只有 1 个 tag,没有可回滚的目标" >&2; return 1; }

    local prev="${hist[$((count - 2))]}"
    sed '$d' "$HISTORY" > "$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY"
    echo "回滚镜像 tag: $(current_tag) → $prev"
    set_tag "$prev"
    ensure_image "$prev"
    compose up -d
    echo "等待服务就绪..."
    wait_healthy || { echo "⚠ 未就绪,查看日志: bash deploy.sh logs" >&2; return 1; }
    echo "✅ 已回滚到: $prev"
}

# ─── 入口 ───────────────────────────────────────────────────────────────────

case "${1:-}" in
    preflight) cmd_preflight ;;
    load)      shift; cmd_load "$@" ;;
    start)     cmd_start ;;
    status)    cmd_status ;;
    logs)      shift; cmd_logs "$@" ;;
    restart)   cmd_restart ;;
    stop)      cmd_stop ;;
    upgrade)   shift; cmd_upgrade "$@" ;;
    rollback)  cmd_rollback ;;
    *)
        sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
