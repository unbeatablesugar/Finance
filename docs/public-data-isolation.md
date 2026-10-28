# 公开源码与个人账本隔离

GitHub 只发布审核清单内的源码、说明文档、应用图标和两个虚构账单示例。个人账本不作为应用资源打包，不在 GitHub Actions 中读取。

## 本地数据的位置

Windows 账本存放在 `%LOCALAPPDATA%\PersonalFinance\personal\ledger.db`，原始账单保存在数据库中；备份在该目录下的 `backups`。这些位置独立于源码仓库与程序安装目录。

`.keys/` 中的签名私钥保留在开发电脑，另由开发者配置到 GitHub Actions 的 Secret；它不进入 Git 历史、源码或安装包。

## 发布限制

- `.gitignore` 排除账本、备份、账单输入、环境文件、密钥、本地工具、截图和编译输出。
- `scripts/public-files.json` 是审核过的可公开文件清单，新增文件默认禁止发布。
- `npm run release:audit` 检查 Git 跟踪文件、禁用路径和常见凭据或个人信息格式；只报告文件路径与问题类型，不打印敏感内容。
- 本地 pre-commit hook 检查暂存内容；GitHub 发布工作流也执行同一检查，失败就不构建、不发布。
- 仅 `examples/通用流水示例.csv` 与 `examples/支付宝格式演示.csv` 可作为数据格式演示提交，必须保持完全虚构。不能用真实账单替换它们。
- 用户使用软件时，导入与保存均由本地 SQLite 完成。更新请求只获取版本清单与程序安装器；应用没有上传账本的接口。

格式扫描不能证明任意文字都不含个人信息；改动审核清单或替换示例内容时仍须检查内容。不要使用 `git add -f` 绕过忽略规则，不要将真实数据写进源码或文档。

本地启用提交检查：`git config core.hooksPath .githooks`。推送前执行 `npm run release:audit`。
