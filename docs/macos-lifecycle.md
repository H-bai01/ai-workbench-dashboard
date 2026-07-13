# macOS 安装、升级与回退

首版生命周期工具只支持 macOS，需要 Node.js 22.13.0 或更高版本及 npm。`install.sh` 和 `upgrade.sh` 都必须接收一个明确的本地源码目录，并会在新版本目录中运行 `npm ci --ignore-scripts`。

## 安装与日常管理

默认安装目录是 `$HOME/Library/Application Support/AI Workbench Dashboard`。如需改到其他位置，可把 `AI_WORKBENCH_INSTALL_ROOT` 设置为绝对路径；它只改变 Dashboard 的安装位置，不迁移任何配置或 OpenClaw 数据。

```bash
./install.sh /path/to/ai-workbench-dashboard-source
./start.sh
./status.sh
./stop.sh
```

安装目录使用 `releases/<id>` 保存版本，`current` 指向当前版本，`previous` 在首次成功升级后指向上一个可用版本。LaunchAgent 文件位于 `$HOME/Library/LaunchAgents/com.ai-workbench.dashboard.plist`，只运行 `current` 中的 `npm run start:v2`，标签固定为 `com.ai-workbench.dashboard`。

`start.sh`、`stop.sh` 和 `status.sh` 只通过该标签管理 Dashboard。它们不会使用 `kill`、`pkill` 或按端口结束进程，也不会管理或重启 OpenClaw Gateway。当自有 LaunchAgent 未加载而 31021 或 31022 已被其他服务占用时，启动会失败，不会接管占用者。

## 升级与回退

```bash
./upgrade.sh /path/to/new-local-source
./rollback.sh
```

升级会先完整准备新版本，再切换 `current`、重启 Dashboard，并检查 `http://127.0.0.1:31021/` 与 `http://127.0.0.1:31022/api/health`。任一检查失败时，脚本会恢复升级前的 `current` 并重新启动旧版本，同时以失败状态退出。`rollback.sh` 会交换 `current` 与 `previous` 后重启并检查 Dashboard。

## 凭据与卸载边界

LaunchAgent 不写入任何 token。Dashboard 本地 token 继续由现有运行代码在本机维护，生命周期脚本不会输出它。工具不会生成、迁移或输出 Gateway token，也不会启动、停止或重启 Gateway。

```bash
./uninstall.sh
```

卸载只退出 `com.ai-workbench.dashboard`、删除自有 plist 和 Dashboard 安装目录。它不提供删除 OpenClaw 数据的选项，也绝不删除或修改 `$HOME/.openclaw`。首版 Dashboard 仍依赖 `$HOME/.openclaw` 中已有的 OpenClaw 配置与数据；这些内容不属于本生命周期工具的安装或迁移范围。
