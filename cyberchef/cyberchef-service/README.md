# CyberChef 汉化版 线上部署包(解压即用)

**单容器一体化**:一个容器同时提供 Web 界面(:8080,nginx)与 MCP 服务
(:8090,供 AI agent 调用;`/api/*` 管理接口给 Web 面板)。面向 **Linux ARM64**
服务器离线部署:镜像在开发机(Apple Silicon Mac)构建并 `docker save` 导出,
服务器不联网、不拉取、不构建。解压后 `bash deploy.sh start` 一键启动。

部署目录为二级结构 `cyberchef/cyberchef-service/`:外层 `cyberchef/` 是部署
根,内层 `cyberchef-service/` 是服务本体;compose 工程名固定为
`cyberchef-service`,与目录名解耦,重命名目录不影响容器/网络名。

## MCP 服务

- **agent 端点**:`http://<服务器IP>:8090/mcp`(Streamable HTTP,无认证,仅限可信内网)
- **4 个内置工具(常驻不可停用)**:`list_operations`(搜目录,多语言)、
  `get_operation`(参数 schema)、`bake`(执行配方)、`magic`(自动探测编码/加密);
  支持 `lang` 参数(zh-CN/zh-TW/ja/ko/de/fr/es/en)返回对应语言的名称与描述
- **界面语言**:选项→语言 可切换 8 种语言(简中/繁中/日/韩/德/法/西/英),
  词典按需加载,未翻译词条自动回退英文;MCP 管理面板跟随界面语言
- **操作目录管理**:Web 界面工具栏「选项」左边的 **MCP** 按钮打开全屏面板,
  可按分类勾选/取消单个 CyberChef 操作(505 个,默认全部启用)。分类表头是
  树状三态复选框(全选/半选/全不选,一键切换整分类);支持搜索与
  全部启用/全部停用。**被停用的操作对 agent 全面隐藏**:`list_operations`
  不再返回、`get_operation`/`bake` 拒绝、`magic` 过滤含该操作的候选
- **调用记录**:面板查看每次调用(时间/工具/成败/耗时/参数与输出预览,
  最多保留 500 条,面板里可清空)
- **状态持久化**:操作启停与调用记录在 `mcp-data/` 卷中,容器重建不丢失
- **限制**:输入 ≤10MB、配方 ≤50 步、输出截断至 256KB(标记 truncated)、
  单次调用 30 秒超时;可用环境变量 `MCP_MAX_INPUT`/`MCP_MAX_OUTPUT`/
  `MCP_TIMEOUT_MS` 调整

开发机本地调试(stdio 模式,供本机 agent 直接配置为命令):

```bash
npm run mcp                      # stdio
npm run mcp -- --transport http  # HTTP 127.0.0.1:8090
```

## 目录内容

```
cyberchef/
└── cyberchef-service/
    ├── README.md                本文件(部署/升级/回滚/MCP/FAQ)
    ├── Dockerfile               一体化镜像定义(Web + MCP 同容器)
    ├── compose.yml              单服务编排(镜像走 tar 导入)
    ├── .env                     端口绑定 + 镜像 tag ★上线前确认端口
    ├── deploy.sh                运维脚本(start/load/stop/upgrade/rollback...)
    ├── build-arm64.sh           开发机构建并导出镜像(服务器上不需要)
    ├── mcp-data/                MCP 状态卷(首次启动自动创建)
    └── image/
        ├── cyberchef-zh-v11.5.0-<日期>-arm64.tar.gz   一体化镜像
        └── 对应 .sha256
```

`.image-history`(升级时自动生成)记录历代镜像 tag,勿手改。

## 快速路径(一条命令)

```bash
bash deploy.sh start      # 校验并导入镜像 → 启动 → 等待健康检查(一键)
```

启动后浏览器访问 `http://<服务器IP>:8080/`;agent 连
`http://<服务器IP>:8090/mcp`。改端口只动 `.env` 里的
`CYBERCHEF_BIND`/`MCP_BIND`,改完 `bash deploy.sh restart`。

## 新装步骤(ARM Linux 服务器)

服务器要求:Docker(含 `docker compose` 插件或 `docker-compose`)、ARM64 内核。
从开发机仓库根目录把 `cyberchef/` 二级目录原样传过去,服务器上即得到
`~/cyberchef/cyberchef-service/`:

```bash
rsync -av --exclude .DS_Store --exclude mcp-data cyberchef/ user@arm-server:~/cyberchef/
# 或先打包(解压后同为 cyberchef/cyberchef-service 二级结构):
# zip -r cyberchef-service-v11.5.0.zip cyberchef -x "*.DS_Store" -x "cyberchef/cyberchef-service/mcp-data/*"

ssh user@arm-server
cd ~/cyberchef/cyberchef-service
bash deploy.sh preflight    # 只读检查:docker/compose/镜像架构/端口
bash deploy.sh start        # 一键:导入镜像 → 启动 → 等待健康检查
```

日常运维全走 `deploy.sh`:

| 命令 | 作用 |
| --- | --- |
| `start` | 一键启动(镜像未导入时自动先 load) |
| `preflight` | 只读检查 Docker/Compose、镜像是否导入、架构是否 arm64 |
| `load` | 校验 SHA256 并导入 `image/` 下最新(或指定)镜像包 |
| `stop` / `restart` | 停止移除容器 / 重建重启 |
| `status` | 容器状态 + 最近日志(nginx + MCP) |
| `logs [N]` | 跟随日志(默认 100 行) |
| `upgrade [tar.gz]` | 导入新镜像 → 固定新 tag → 重建;架构不是 arm64 拒绝切换 |
| `rollback` | 回到上一个镜像 tag |

## 发布新版本(开发机)

改完源码后重新构建导出,再把 `cyberchef/` 同步到服务器执行升级:

```bash
# Mac 上(仓库根目录任意位置):构建一体化镜像并导出
bash cyberchef/cyberchef-service/build-arm64.sh
# 产物写入 cyberchef/cyberchef-service/image/(+.sha256),
# .env 的 CYBERCHEF_IMAGE 自动指向新 tag。

rsync -av --exclude .DS_Store --exclude mcp-data cyberchef/ user@arm-server:~/cyberchef/
ssh user@arm-server "cd ~/cyberchef/cyberchef-service && bash deploy.sh upgrade"
```

同一天重复构建会覆盖同名归档并复用同 tag;服务器端 `docker load` 直接覆盖
旧镜像,流程不变。回滚:`bash deploy.sh rollback`(依赖 `.image-history`)。

## 架构说明

镜像固定 `linux/arm64`,与 Apple Silicon 原生构建、ARM Linux 服务器一致。
`preflight` 和 `upgrade` 都会核验镜像架构,不匹配直接拒绝。要在 x86_64 服务器
部署,需在开发机另建 `--platform linux/amd64` 的镜像与归档(构建走 Docker 模拟,
较慢),本包不包含。

一体化容器说明:nginx 与 MCP 同容器,任一进程退出容器即退出并由
`restart: unless-stopped` 整体拉起;升级/回滚对 Web 与 MCP 同时生效。

## 能力边界

- Web 端全部运算在浏览器本地完成,断网/内网可用;无账号体系、无数据库。
- MCP 服务在服务端执行操作(Node 运行时):11 个浏览器专用操作(如
  JavaScript Beautify、Syntax Highlighter)与流程控制操作(Fork/Merge 等)
  不可用,`get_operation` 会以 `nodeSupported: false` 标注。
- 容器以非特权运行、根文件系统只读;**MCP 无认证,只应绑定可信内网,
  不要暴露公网**(需要公网请自行加反代与访问控制)。

## 对外暴露(可选)

默认 `0.0.0.0:8080`(Web)与 `0.0.0.0:8090`(MCP)内网直连。要走反代 + TLS 时
把 `.env` 改为 `127.0.0.1:8080` / `127.0.0.1:8090` 并参考:

```nginx
location /cyberchef/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    client_max_body_size 0;
}
location /mcp {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    # MCP Streamable HTTP 需要 SSE 透传
    proxy_buffering off;
    proxy_read_timeout 600s;
}
```

注意 Web 面板(:8080 页面)直连 `:8090` 的管理 API,两个端口都要能从浏览器
访问到;跨端口调用已开 CORS。

## FAQ

**`start` 报「镜像尚未导入」?**
`image/` 目录没随包带上(需要一体化镜像 tar.gz),或 `.env` 的
`CYBERCHEF_IMAGE` 与归档内 tag 不一致。先 `bash deploy.sh preflight` 看两边各是什么。

**容器起来但页面打不开?**
`bash deploy.sh logs` 看 nginx/MCP 日志;确认 `.env` 端口没被占用
(`ss -lntp`);防火墙/安全组放行对应端口。

**MCP 面板显示未连接?**
确认容器 healthy(`bash deploy.sh status`,健康检查覆盖 8080 与 8090 两个
端口);面板地址栏默认 `http://<页面主机名>:8090`,与实际部署不一致时手工改
地址并点「连接」。

**如何确认跑的是汉化版?**
页面加载后界面为中文;或 `curl -s http://127.0.0.1:8080/ | grep -o '<title>.*</title>'`
确认是 CyberChef 站点,再在页面右上角语言开关中英文验证。
