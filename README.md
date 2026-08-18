# IPTV Router

自托管的 IPTV 订阅归一化、频道分流与出口服务。它把“频道”与“上游源”分开建模：同一频道可以挂接多个源，定时探测可用性、延迟与吞吐量并尽力生成一帧预览图，在访问出口时按策略稳定选择最合适的源。

## 技术栈

- Turborepo + pnpm workspace，全仓 TypeScript，启用严格 TypeScript 与 ESLint 校验。
- `apps/api`：Ts.ED 8、Kysely、Croner；SQLite（`better-sqlite3`）和 PostgreSQL（`pg`）共用迁移与查询模型。
- `apps/cli`：基于 oclif 的用户操作 CLI，通过受保护的 HTTP API 完成导入、EPG 映射、出口与健康检测。
- `apps/web`：React Router v7 Framework Mode（SSR）、React 19、Tailwind CSS 4、shadcn/Radix UI。
- `packages/contracts`：共享 DTO、枚举与 Zod 输入校验。
- `packages/db`：数据库结构、迁移及 SQLite/PostgreSQL 适配。
- `.agents/skills/configure-iptv-router`：供部署 Agent 使用的存储、迁移与安全校验工作流。
- `.agents/skills/operate-iptv-router`：供用户 Agent 使用的 CLI 操作工作流。

当前导入器覆盖 M3U/M3U8、JSON、CSV、TXT、Xtream，以及已用测试固定的 zFuse 常见 JSON 数组/对象映射和 TXT `名称#地址` 方言；M3U 中声明的 `x-tvg-url`/`url-tvg` 会自动进入 EPG 库，`tvg-id` 或唯一频道名会自动绑定频道。XMLTV 也可以作为独立 EPG 数据导入。不要把未加测试的新 zFuse 变体视为已兼容。

## 本地启动

需要 Node.js `>=22.19` 与 pnpm `10.33.4`。

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
node .agents/skills/configure-iptv-router/scripts/validate-config.mjs --env-file .env
pnpm --filter @iptv-router/db db:migrate
pnpm dev
```

默认地址：

- 管理界面：<http://localhost:5173>
- EPG 管理：<http://localhost:5173/epg>
- 源监控检测：<http://localhost:5173/monitoring>
- 频道检测与预览：<http://localhost:5173/channels>
- 虚拟源聚合：<http://localhost:5173/virtual-sources>
- 出口频道配置：<http://localhost:5173/outputs>
- API：<http://localhost:8080/api>
- Swagger：<http://localhost:8080/docs>
- 就绪检查：<http://localhost:8080/api/health>（管理鉴权开启时需要会话）
- 容器存活：<http://localhost:8080/healthz>

开发默认使用 `sqlite:./data/iptv-router.sqlite`。`IPTV_AUTO_MIGRATE` 默认关闭；升级代码后请先备份，再显式运行迁移。

## 存储选择

单实例、单写入者部署优先使用 SQLite，并把 `data/` 放在持久化本地磁盘：

```dotenv
DATABASE_URL=sqlite:./data/iptv-router.sqlite
```

多实例、并发导入/探测或高可用部署使用 PostgreSQL：

```dotenv
DATABASE_URL=postgresql://iptv_router:<url-encoded-password>@db.example.com:5432/iptv_router
```

切换已有数据库不能只改连接串；应走经过验证的导出/导入流程，并核对频道、源、EPG、出口和探测记录。

## 容器部署

根目录 `Dockerfile` 会把 API、React Router SSR 管理端和单端口网关打进同一个镜像。网关对外提供 `3000`，自动把 `/api`、`/docs`、`/out` 和 `/stream` 转发给 API，其余请求交给前端；API 的 `8080` 端口仅作为可选的诊断/直连端口暴露。

默认 Compose 使用持久化 SQLite。首次启动或版本升级时先执行迁移：

```sh
cp docker/.env.example .env
# 先在 .env 中填写至少 8 个字符的 IPTV_ADMIN_PASSWORD；CLI/自动化可额外配置 IPTV_ADMIN_TOKEN
mkdir -p ./data/imports
docker compose build app
docker compose --profile tools run --rm migrate
docker compose up -d app
```

管理界面访问 <http://localhost:3000>。单容器构建默认使用同源 API（`VITE_API_URL=/api`）；打开页面后输入 `IPTV_ADMIN_PASSWORD`，服务端会签发 HttpOnly Cookie。设置密码后网关不会注入管理令牌；未设置密码的旧 token-only 镜像仍保留运行时 Bearer 兼容行为。若使用自定义域名，应在镜像构建时覆盖 `VITE_API_URL`/`VITE_PUBLIC_API_ORIGIN`，并在运行时设置 `IPTV_PUBLIC_BASE_URL`、`IPTV_CORS_ORIGINS`；HTTPS 部署同时设置 `IPTV_AUTH_COOKIE_SECURE=true`。

`docker/.env.example` 默认把 `IPTV_DATA_HOST_PATH=./data` 映射到容器的 `/app/data`，因此 SQLite 数据库、频道截帧和运行时持久化数据都保存在宿主机目录。把它改成绝对路径即可迁移到指定磁盘，例如 `IPTV_DATA_HOST_PATH=/srv/iptv-router/data`；同时把 `IPTV_IMPORT_HOST_PATH` 改成同一宿主机目录下的 `imports` 子目录（该目录在容器内只读）。如果删除 `IPTV_DATA_HOST_PATH`，Compose 会恢复使用 Docker 管理的 `iptv-data` volume。Linux 主机需确保该目录允许容器内 UID 1000 写入。

也可以直接构建并运行镜像：

```sh
docker build -t iptv-router:local .
docker run -d --name iptv-router \
  -p 3000:3000 -p 8080:8080 \
  --cpus=2 --memory=1g --pids-limit=128 \
  --ulimit nofile=4096:8192 \
  -e IPTV_ADMIN_PASSWORD='<strong-management-password>' \
  -e IPTV_ADMIN_TOKEN='<optional-cli-token>' \
  -v "$PWD/data:/app/data" \
  -v "$PWD/data/imports:/app/data/imports:ro" \
  iptv-router:local
```

直接 `docker run` 时，把 `/app/data` 换成所需的宿主机目录即可；宿主机 `data/imports` 以只读方式挂载到受限导入目录。需要局域网 IPTV 源时才把 `IPTV_ALLOW_PRIVATE_NETWORKS` 设为 `true`，并明确接受由此扩大的 SSRF 风险。

Compose 和上面的单容器示例默认给应用设置 2 vCPU、1 GiB 内存和 128 个进程上限，避免公开出口流量、异常上游或视频解码器拖垮宿主机。可在 `.env` 中通过 `IPTV_APP_*` 覆盖，但应先观察健康检查峰值。

PostgreSQL 示例要求在 `.env` 中额外设置强随机密码与完整连接串（连接串中的密码需 URL 编码）：

```dotenv
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DATABASE_URL=postgresql://iptv_router:<url-encoded-password>@postgres:5432/iptv_router
# 可选：将 PostgreSQL 数据也绑定到宿主机目录
POSTGRES_DATA_HOST_PATH=/srv/iptv-router/postgres
```

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml --profile tools run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d postgres app
```

PostgreSQL 版本仍然是一个应用容器，数据库由 Compose 单独提供；设置 `POSTGRES_DATA_HOST_PATH` 可把 PostgreSQL 数据目录绑定到宿主机，否则使用 Docker 管理的 `postgres-data` volume。多副本或托管 PostgreSQL 部署应保持 `IPTV_AUTO_MIGRATE=false`，在滚动发布前单独执行迁移。

GitHub Actions 已配置：`CI` 会执行全仓检查并构建三种镜像路径；`Docker image` 在 Pull Request 上构建验证，在 `main` 和 `v*.*.*` 标签推送同源镜像到 `ghcr.io/<owner>/<repo>`，同时使用 GitHub Actions 缓存加速构建。

CNB 构建配置见 [.cnb.yml](./.cnb.yml)。推送到 CNB 的 `main` 分支时，会构建并发布以下制品：

```text
docker.cnb.cool/gtbl2012/iptv-router:latest
docker.cnb.cool/gtbl2012/iptv-router:<commit-short>
```

推送 `v*` 标签时还会发布同名版本标签。CNB 流水线使用平台内置的 Docker 制品库凭据，不把 token 写入仓库；拉取示例：

```sh
docker pull docker.cnb.cool/gtbl2012/iptv-router:latest
```

生产环境应保持 `IPTV_AUTO_MIGRATE=false`，在部署步骤中单独迁移并先做快照/备份。不要把 `.env`、数据库连接串、Xtream 凭据或带签名参数的播放地址提交到仓库或日志。

对外部署时还应把 `IPTV_PUBLIC_BASE_URL` 设置为最终 HTTPS 地址，并将 `IPTV_CORS_ORIGINS` 收窄到真实管理端来源。

## 出口与鉴权

管理 API 在设置 `IPTV_ADMIN_PASSWORD` 或 `IPTV_ADMIN_TOKEN` 后需要鉴权。浏览器在 `/api/auth/login` 提交密码，换取有效期由 `IPTV_AUTH_SESSION_TTL_MS` 控制的 HttpOnly `iptv_session` Cookie；CLI/自动化继续使用 `Authorization: Bearer <IPTV_ADMIN_TOKEN>`。`/out/:token.*` 和 `/stream/:token/:channelId` 是唯一面向播放器的公开交付接口；容器健康检查使用只在 API 端口提供的 `/healthz`，不经过公开网关。管理页面/API 不应暴露在不可信网络边界。`VITE_ADMIN_TOKEN` 会进入浏览器构建产物，仅适合可信内部部署。

创建出口后，公开交付路径为：

- `GET /out/:token.m3u`：扩展 M3U；频道项指向分流地址。
- `GET /out/:token.xml`：该出口启用 EPG 时返回 XMLTV。
- `GET /stream/:token/:channelId`：运行时选择源；无自定义请求头或非 HTTP(S) 源走高效 `307`，带请求头的 HTTP(S) 源由后端安全流式代理。

流式代理不会整段缓冲媒体：它复用导入/探测的 DNS 固定和逐跳重定向校验，应用数据库中保存的安全请求头，透传合法的 `Range`/`If-Range` 及必要的媒体响应元数据，并在播放器断开时中止上游。上游 URL、`Location`、`Set-Cookie` 和任意提供商响应头不会返回给客户端。

出口 token 等同访问凭据，应使用 HTTPS，避免出现在日志、工单或公开页面中。管理端的具体请求体以 `/docs` 和 `@iptv-router/contracts` 为准。

## Agent 配置助手

普通用户操作调用 `$operate-iptv-router`：它通过 oclif CLI 导入 IPTV/XMLTV、映射 EPG ID、配置出口并运行健康检测，不接触数据库。仓库或部署维护调用 `$configure-iptv-router`，用于 SQLite/PostgreSQL 选择、迁移、调度和 SSRF 边界检查。

同一频道的多条上游流可通过“虚拟源”聚合为一个出口频道；虚拟源保留原始来源和健康记录，并始终在候选池内统一选择最优后端。

本地 CLI 从仓库根目录运行；管理令牌优先放在环境变量中，不要直接写进命令行或日志：

```sh
export IPTV_ROUTER_API_URL=http://localhost:8080/api
export IPTV_ROUTER_PUBLIC_URL=http://localhost:8080
export IPTV_ROUTER_TOKEN=<management-token>
pnpm -s iptv -- status --json
pnpm -s iptv -- --help
```

Xtream 凭据可通过 `IPTV_ROUTER_XTREAM_USERNAME` 与 `IPTV_ROUTER_XTREAM_PASSWORD` 注入，避免进入命令历史。仓库内调用保留 pnpm 的 `-s`，使 `--json` 的 stdout 不混入生命周期横幅。CLI 的写操作要求显式范围：创建出口必须选择当前全部频道或提供频道 ID；全量健康检测必须显式确认全部活跃源。详细命令以 `pnpm -s iptv -- --help` 及对应子命令帮助为准。

## 质量检查

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# 或一次执行全部检查
pnpm check
```

贡献约定见 [AGENTS.md](./AGENTS.md)，架构、配置与 API 状态分别见 [docs/architecture.md](./docs/architecture.md)、[docs/configuration.md](./docs/configuration.md) 和 [docs/api.md](./docs/api.md)。
