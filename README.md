# dsh-memory

DSH 记忆插件 — 自动索引全部会话历史到记忆库。

## 功能

- 自动扫描 `~/.dsh/sessions/` 下所有历史会话，生成摘要记忆
- 新会话实时增量采集
- 对话界面出现「记忆」标签页，支持搜索、查看、删除
- **原文全文搜索**：输入 ≥2 个字符即对全部会话归档做全文检索（user/assistant 消息原文，大小写不敏感），返回带高亮的命中片段与来源会话，可跳转到对应会话

## 安装

```bash
git clone https://github.com/pumu21600-boop/dsh-memory.git ~/.dsh/profiles/node_modules/dsh-memory
```

## 使用

安装后重启 DSH，对话界面自动出现「记忆」标签页。

## 卸载

```bash
rm -rf ~/.dsh/profiles/node_modules/dsh-memory
rm -f ~/.dsh/storages/memory.jsonl
```

## License

MIT
