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
5. 只有明确要求发布安装包时，才在 Actions 中手动运行 **Windows desktop release**。普通代码推送、版本号变化和版本标签均不触发打包或发布。

源码仓库已关联 GitHub，并包含自动发布工作流。个人数据隔离规则见 [公开源码与个人账本隔离](public-data-isolation.md)。首次发布完成前，检查更新可能提示暂不可用，不影响记账。

## 日常修改：只上传源码

日常修改完成后，执行必要的测试与个人数据隔离检查，再提交并推送源码。这个过程不会生成安装包，也不会创建 Releases。

只有明确要求打包时才生成本地安装包；只有明确要求发布安装包时才手动运行 GitHub 发布工作流。提高版本号也不会自动触发打包。

## 明确要求发布安装包时

在项目根目录运行（替换为比当前版本更高的版本号）：

```powershell
npm.cmd run release:version -- 0.3.1
```

该命令只同步前端、Tauri、两个 Rust 包与锁文件的版本号。提交并推送代码后，仍须在明确要求发布时手动运行 Actions 中的 **Windows desktop release**，工作流才会：

1. 校验版本一致，跳过已发布的同版本。
2. 运行前端测试、Rust 账本测试。
3. 用标准 MSVC 工具链构建正式 Windows x64 安装器，签名并生成 `latest.json`。
4. 上传 `.exe`、`.sig` 和 `latest.json`，检查完成后发布到 Releases。

仅上传源码不会让已安装的软件提示升级。安装包在明确要求后单独构建、发布；发布更高版本后，客户端才能在软件内下载更新。

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
