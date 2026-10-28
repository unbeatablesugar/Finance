# Windows 安装与软件内更新

青禾账本使用 Tauri 2 的 Windows NSIS 安装器（`*-setup.exe`）。安装后可从开始菜单启动；首次安装带更新功能的版本后，后续直接在软件里升级。

## 已配置的更新源

- 仓库：<https://github.com/unbeatablesugar/Finance>
- 更新清单：<https://github.com/unbeatablesugar/Finance/releases/latest/download/latest.json>
- 启动时自动检查，以后每 6 小时检查一次；设置与备份 → 软件更新也可手动检查。
- 按语义版本比较，只提示高于当前版本的正式版本；预发布版本不进入 `latest`。
- 显示新版本与更新说明，点击“下载并安装”后展示下载进度。下载完成并通过签名校验后，备份已存在的个人与演示账本，再运行安装器并重启。
- 备份位于 `%LOCALAPPDATA%\PersonalFinance\personal\backups\before-update-v*.qinghe` 与相邻 `demo\backups`。不上传账本；更新只访问 GitHub 获取版本清单和程序安装包。
- 下载、校验、备份或安装启动失败会保留当前程序，界面提示重试。未完成备份不会启动安装。

**旧的便携 exe 没有更新功能，无法自行获得本次功能。需安装一次新版安装器。** 安装路径与账本路径分开，现有本地账本继续使用原位置。

## GitHub 一次性设置

1. 将项目源码（包括 `.github/workflows/release.yml`、`package-lock.json` 和 `src-tauri/Cargo.lock`）提交到上述仓库。不要上传 `.tools`、`.keys`、`release` 或个人账单。
2. 在仓库 **Settings → Secrets and variables → Actions → New repository secret** 中添加 `TAURI_SIGNING_PRIVATE_KEY`，内容取本机项目 `.keys/qinghe-updater.key` 的**完整文件内容**。已生成与 `src-tauri/tauri.conf.json` 公钥配对的私钥；它没有密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可不设置。
3. 私钥是持续发布更新的凭据，请在安全位置另存一份。`.keys/` 已加入忽略规则，不可提交到源码或打包给软件用户。不要重新生成覆盖它，已安装客户端信任的是现有公钥。
4. 确保仓库启用 Actions，工作流可写入 Releases。软件用户必须能匿名下载 Releases；私有仓库需另建公开发布仓库或带鉴权的服务，不能把 GitHub Token 放进安装包。
5. 在 Actions 中手动运行 **Windows desktop release**，或推送版本号变化。工作流先生成草稿并上传全部文件，通过清单检查后自动发布，避免软件读到未上传完成的更新。

本地目录目前没有 Git 元数据。以上是已准备好的代码与工作流；是否已上传、仓库是否公开、Secrets 是否配置，须以 GitHub 的实际状态为准。未发布 `latest.json` 时，检查更新会提示失败，不影响记账。

## 以后如何更新

在项目根目录运行（替换为比当前版本更高的版本号）：

```powershell
npm.cmd run release:version -- 0.3.0
```

该命令同步前端、Tauri、两个 Rust 包与锁文件的版本号。提交代码并推送到 `main` 或 `master`，GitHub Actions 便会自动：

1. 校验版本一致，跳过已发布的同版本。
2. 运行前端测试、Rust 账本测试。
3. 用标准 MSVC 工具链构建正式 Windows x64 安装器，签名并生成 `latest.json`。
4. 上传 `.exe`、`.sig` 和 `latest.json`，检查完成后发布到 Releases。

也支持推送与软件版本一致的 `v0.3.0` 标签或手动运行工作流。仅修改代码而未提高版本号，不会让已安装的软件提示升级。**新版仍须构建发布一次；用户侧不再需要接收独立压缩包或手工替换 exe。**

## 本机正式打包

标准 MSVC 工具链环境下：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path .keys/qinghe-updater.key).Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm.cmd run desktop:build
```

本机已有便携 GNU 工具链，也可执行 `./scripts/desktop-portable.ps1 -Task Package` 生成正式优化构建与签名安装包。GitHub Actions 仍使用标准 MSVC 工具链。

输出目录为 `src-tauri/target/release/bundle/nsis/`。生成的 exe 安装器必须与同次构建的签名一起发布；通常直接使用 GitHub Actions，自动生成配套清单。微软代码签名证书与更新签名是两回事；当前配置包含更新签名，不包含 Windows Authenticode 证书。

参考：[Tauri Updater](https://v2.tauri.app/plugin/updater/)、[Tauri GitHub 发布流程](https://v2.tauri.app/distribute/pipelines/github/)。
