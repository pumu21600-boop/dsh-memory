# dsh-memory

DSH 记忆插件 — 自动索引全部会话历史到记忆库。

## 功能

- 自动扫描 `~/.dsh/sessions/` 下所有历史会话，生成摘要记忆
- 新会话实时增量采集
- 输入框上方常驻「◈ 记忆库」按钮，点开是全屏星际记忆地图：每个光点对应一轮对话，支持搜索、查看、删除
- 会话有内容后，会话头部（`conversation.session.header.actions` 插槽）也会出现同名按钮
- 界面开关（星空背景 / 点击穿透）由宿主持久化在 profile 条目配置（`lib/index.js` 导出的 `Config` schema 驱动，不再用 settings.register），**不使用 localStorage**
- **原文全文搜索**：输入 ≥2 个字符即对全部会话归档做全文检索（user/assistant 消息原文，大小写不敏感），返回带高亮的命中片段与来源会话，可跳转到对应会话

## 安装（DSH ≥ 0.2.0：插件即 bundle）

1. 把本目录 junction 到桌面端 profile 的插件目录：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-memory" `
     -Target "C:\path\to\dsh-memory"
   ```

2. 在 `~/.dsh/profiles/desktop/package.json` 里把插件加入 `dependencies` 与
   `dsh.profile.bundles`（0.2.0 起 profile 的 cordis.patch.yml 不再负责装载插件；
   本包自带 `dsh.bundle.patch`，无需再写用户层 insert）：

   ```json
   "dependencies": { "dsh-memory": "0.4.1" }
   ```

   ```json
   "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-memory"] } }
   ```

3. 重启桌面端即生效。

## 使用

装好后用输入框上方的「◈ 记忆库」按钮打开星际记忆地图。

## 卸载

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-memory"
```

再从 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与
`dsh.profile.bundles` 里删掉对应条目；如需连记忆数据一起清除，另外删除 `~/.dsh/storages/memory.jsonl`。

## License

MIT
