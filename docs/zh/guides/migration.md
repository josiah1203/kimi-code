# 迁移到 SpiderByte Open Core

SpiderByte Open Core 是一个本地 Node.js 发行版，使用 `spyderbyte` 可执行文件和无版本后缀的 SpiderByte Agent Core 运行时。受支持的配置和数据目录是 `.spiderbyte`。

## 使用新的本地配置

评估迁移时，可以先使用独立的数据根目录：

```sh
SPIDERBYTE_HOME="$PWD/.spiderbyte-migration" spyderbyte doctor
```

只把自己理解的供应商、模型、权限和运行循环设置复制到新的 `config.toml`。将托管账号字段改为明确的本地端点或 BYOK 供应商记录。模板中使用 `YOUR_API_KEY`，真实凭据只放在被 Git 忽略的本地文件或进程环境中。

## 会话和制品

会话导入/导出使用带版本的本地协议。从源安装导出会话后先检查归档，只有目标版本报告支持对应 schema 时才导入。不要在安装之间复制活动凭据文件、令牌存储、日志或 Plugin 缓存。

```sh
spyderbyte export <session-id> -o ./session-export.zip
```

如果旧归档无法读取，应将其保留为外部记录并创建新本地会话。Open Core 运行时不得静默通过旧引擎处理不支持的归档。

## 兼容材料

临时兼容代码位于 `compat/` 下，并从 workspace 构建和发行包依赖图中排除。它不是受支持的运行时依赖。兼容性清单和移除计划记录在 [`PACKAGE_RENAME_MAP.md`](../../release/PACKAGE_RENAME_MAP.md) 中。

## 不属于本次迁移的内容

Open Core checkout 不迁移托管身份、订阅、计费、托管 Worker、托管审批或托管供应商额度。这些能力属于商业范围；如果未来提供，需要单独维护发行版。
