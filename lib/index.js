/**
 * dsh-memory — 记忆系统 host 半区(0.1.0)。
 *
 * 职责:
 * 1. 记忆采集:在 agent/pre-step 瀑布里增量扫描活动会话的 events,
 *    把 user/message 与 assistant/message 的文本内容抽取为记忆条目,
 *    幂等追加写入 DSH_HOME/storages/memory.jsonl(JSON Lines)。
 *    条目 id = "sessionId:seq",重启重扫不重复。
 * 2. 数据服务:webServer 注册 /dsh-memory 端点,提供 list / stats /
 *    delete / clear,前端(conversation.view 的「记忆」标签页)同源调用。
 * 3. 会话标题:从 storages/session_projcache.json 的 rows.title.val 读取
 *    (带 mtime 缓存),让记忆卡片显示来源会话标题。
 *
 * 依赖:无外部 npm 包;node:fs 直读写 DSH_HOME(与 dsh-mini-vision 相同)。
 */
const PLUGIN_NAME = 'dsh-memory'

export const name = PLUGIN_NAME
export const inject = ['webServer']

import os from 'node:os'
import { join } from 'node:path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  renameSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

const MEMORY_FILE = () => join(dshHome(), 'storages', 'memory.jsonl')
const TITLES_FILE = () => join(dshHome(), 'storages', 'session_projcache.json')

/* ── 真实地球纹理资源(懒下载缓存,供前端渲染)────────────────────────── */
const ASSETS_DIR = () => join(dshHome(), 'storages', 'memory-assets')
/** 纹理清单:本地名 → 源 URL(unpkg three-globe 的 NASA 公开示例图)。 */
const ASSET_SOURCES = {
  'earth-day': {
    url: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    type: 'image/jpeg',
  },
  'earth-night': {
    url: 'https://unpkg.com/three-globe/example/img/earth-night.jpg',
    type: 'image/jpeg',
  },
  'earth-topology': {
    url: 'https://unpkg.com/three-globe/example/img/earth-topology.png',
    type: 'image/png',
  },
}
const assetPromises = new Map()

async function ensureAsset(name) {
  const spec = ASSET_SOURCES[name]
  if (!spec) return null
  const dir = ASSETS_DIR()
  const file = join(dir, name + (spec.type === 'image/png' ? '.png' : '.jpg'))
  try {
    if (existsSync(file) && statSync(file).size > 0) return file
  } catch {
    /* 继续下载 */
  }
  if (assetPromises.has(name)) return assetPromises.get(name)
  const task = (async () => {
    mkdirSync(dir, { recursive: true })
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`asset fetch failed HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const tmp = file + '.tmp'
    writeFileSync(tmp, buffer)
    renameSync(tmp, file)
    return file
  })().catch((err) => {
    assetPromises.delete(name)
    ctx_logger_warn(`dsh-memory: asset ${name} download failed: ${err && err.message ? err.message : String(err)}`)
    return null
  })
  assetPromises.set(name, task)
  return task
}

let ctx_logger_warn = () => {}
function setLogger(logger) {
  ctx_logger_warn = (msg) => logger?.warn?.(msg)
}

const MAX_TEXT = 2000 // 单条记忆正文上限(字符),超出截断,避免记忆库膨胀
const MAX_ENTRIES = 20000 // 记忆库条数上限(防无限增长,超出时裁剪最旧)

/* ── 记忆库:内存索引 + 串行落盘 ────────────────────────────────────── */

const store = {
  entries: [], // { id, sessionId, role, turn, time, text } 按 time 升序
  ids: new Set(),
  dirty: false,
  writeChain: Promise.resolve(),
}

function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function loadStoreIfNeeded() {
  if (store.entries.length > 0 || store.dirty) return
  const raw = readTextSafe(MEMORY_FILE())
  if (raw === null || raw === '') return
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry.id === 'string' && entry.id !== '' && !store.ids.has(entry.id)) {
        store.entries.push(entry)
        store.ids.add(entry.id)
      }
    } catch {
      /* 跳过损坏行 */
    }
  }
  store.entries.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

/** 将内存条目整库落盘(换名写,避免半截文件)。串行,防并发交错。 */
function persistStore() {
  store.writeChain = store.writeChain.then(() => {
    if (!store.dirty) return
    store.dirty = false
    try {
      const file = MEMORY_FILE()
      const dir = file.slice(0, file.lastIndexOf('\\') === -1 ? file.lastIndexOf('/') : Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')))
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const tmp = file + '.tmp'
      const lines = store.entries.map((e) => JSON.stringify(e))
      writeFileSync(tmp, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8')
      renameSync(tmp, file)
    } catch (err) {
      store.dirty = true // 保留待重写
    }
  })
  return store.writeChain
}

function appendEntry(entry) {
  if (store.entries.length >= MAX_ENTRIES) {
    // 挤出最旧的若干条
    const drop = store.entries.length - MAX_ENTRIES + 1
    const removed = store.entries.splice(0, drop)
    for (const r of removed) store.ids.delete(r.id)
  }
  store.entries.push(entry)
  store.ids.add(entry.id)
  store.dirty = true
  try {
    appendFileSync(MEMORY_FILE(), JSON.stringify(entry) + '\n', 'utf8')
    store.dirty = false
  } catch {
    /* 追加失败则整体落盘时会兜底 */
  }
}

function removeEntries(ids) {
  const wanted = new Set(ids)
  if (wanted.size === 0) return 0
  const before = store.entries.length
  store.entries = store.entries.filter((e) => !wanted.has(e.id))
  for (const id of wanted) store.ids.delete(id)
  const removed = before - store.entries.length
  if (removed > 0) {
    store.dirty = true
    persistStore()
  }
  return removed
}

/* ── 会话标题缓存(session_projcache.json)────────────────────────────── */

const titleCache = { mtime: -1, bySession: new Map() }

function loadTitles() {
  const file = TITLES_FILE()
  try {
    const st = statSync(file)
    if (st.mtimeMs === titleCache.mtime) return titleCache.bySession
    const raw = readTextSafe(file)
    const bySession = new Map()
    if (raw !== null) {
      const obj = JSON.parse(raw)
      const sessions = obj && obj.tables && obj.tables.sessions
        ? obj.tables.sessions
        : obj && obj.sessions
          ? obj.sessions
          : null
      if (sessions && typeof sessions === 'object') {
        for (const [sid, info] of Object.entries(sessions)) {
          const val = info && info.rows && info.rows.title && info.rows.title.val
          if (typeof val === 'string' && val !== '') bySession.set(sid, val)
        }
      }
    }
    titleCache.mtime = st.mtimeMs
    titleCache.bySession = bySession
  } catch {
    /* 索引文件缺失/损坏:返回现有缓存 */
  }
  return titleCache.bySession
}

function sessionTitle(sessionId) {
  return loadTitles().get(sessionId) || null
}

/* ── 会话总结生成(每个会话一条记忆,取代逐条消息)────────────────────── */

/** 把一条消息的 content(文本块数组)拼成纯文本。 */
function contentText(content) {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out.trim()
}

const clampText = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t)

/** 从事件流按轮次聚合问答对(一条 user 消息 + 紧随的首条 assistant 回复)。 */
function turnsFromEvents(events) {
  const byTurn = new Map()
  for (const event of events) {
    if (!event || !event.data) continue
    if (event.type === 'user/message') {
      const text = contentText(event.data.content)
      if (text === '') continue
      const turn = typeof event.data.turn === 'number' ? event.data.turn : 0
      let rec = byTurn.get(turn)
      if (!rec) { rec = { user: '', assistant: '', time: event.time }; byTurn.set(turn, rec) }
      rec.user = (rec.user ? rec.user + ' / ' : '') + clampText(text, 80)
      rec.time = event.time
    } else if (event.type === 'assistant/message') {
      const text = contentText(event.data.message && event.data.message.content)
      if (text === '') continue
      const turn = typeof event.data.turn === 'number' ? event.data.turn : 0
      let rec = byTurn.get(turn)
      if (!rec) { rec = { user: '', assistant: '', time: event.time }; byTurn.set(turn, rec) }
      if (rec.assistant === '') rec.assistant = clampText(text, 150)
      rec.time = event.time
    }
  }
  const turns = [...byTurn.values()]
  turns.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  return turns
}

/** 生成会话总结文本(标题 + 最多 8 轮问答要点)。 */
function buildSummaryText(sessionId, events, title) {
  const turns = turnsFromEvents(events)
  if (turns.length === 0) return ''
  const lines = []
  lines.push(`📌 ${clampText(title || sessionId, 60)}`)
  const MAX_ROUNDS = 8
  for (let i = 0; i < Math.min(turns.length, MAX_ROUNDS); i++) {
    const t = turns[i]
    if (t.user) lines.push(`问 ${t.user}`)
    if (t.assistant) lines.push(`答 ${t.assistant}`)
  }
  if (turns.length > MAX_ROUNDS) lines.push(`… 共 ${turns.length} 轮问答`)
  return lines.join('\n')
}

/** 会话最后事件时间。 */
function lastEventTime(events) {
  let t = ''
  for (const event of events) {
    if (event && typeof event.time === 'string') t = event.time
  }
  return t
}

/** 生成/更新某会话的总结条目(upsert,内容未变则不写)。 */
function upsertSummary(sessionId, events) {
  if (!Array.isArray(events) || events.length === 0) return false
  const text = buildSummaryText(sessionId, events, sessionTitle(sessionId))
  if (text === '') return false
  const id = `sum:${sessionId}`
  const entry = {
    id,
    sessionId,
    role: 'summary',
    turn: 0,
    time: lastEventTime(events) || new Date().toISOString(),
    text,
  }
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx >= 0) {
    const prev = store.entries[idx]
    if (prev.text === entry.text && prev.time === entry.time) return false
    store.entries[idx] = entry
  } else {
    store.entries.push(entry)
    store.ids.add(id)
  }
  store.dirty = true
  persistStore()
  return true
}

/** 清理旧版逐条消息记忆,只保留会话总结。 */
function pruneLegacyEntries() {
  loadStoreIfNeeded()
  const before = store.entries.length
  store.entries = store.entries.filter((e) => e && String(e.id).startsWith('sum:'))
  store.ids = new Set(store.entries.map((e) => e.id))
  if (store.entries.length !== before) {
    store.dirty = true
    persistStore()
  }
}

/* ── 全量历史会话导入(解压所有 session.jsonl.zstd 归档记忆)────────── */

const scannedFiles = new Map() // path → { mtimeMs, size }
const activeSessionSeen = new Map() // sessionId → lastActiveMs(最近被实时维护)
let lastScanDoneMs = 0 // 历史扫描完成时刻(限频用,避免频繁重解压大文件)
let scanChain = Promise.resolve()

/* DSH 会话日志:多帧 zstd(每批 append 一帧,带 checksum)。仿官方 scanZstdFrames
   定位帧边界,再逐帧用 Node 单帧 API 解压。 */
const ZSTD_MAGIC = 4247762216 // 0xFD2FB528

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return frames
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解压一个会话文件为 JSONL 文本(多帧逐个解)。 */
function decodeSessionFile(file) {
  const buffer = readFileSync(file)
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) throw new Error('no zstd frames')
  const chunks = []
  for (const frame of frames) {
    chunks.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 解压文本缓存(按 mtime+size 失效),搜索时避免每条查询重复解压全部归档。 */
const textCache = new Map() // path → { mtimeMs, size, text }
function decodeSessionText(file) {
  const st = statSync(file)
  const hit = textCache.get(file)
  if (hit !== undefined && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text
  const text = decodeSessionFile(file)
  textCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, text })
  return text
}

/** 遍历 sessions 目录,把(新增/变更的)历史会话解压并解析入记忆库。 */
async function scanHistorySessions() {
  // 限频:距上次扫描完成 < 6s 直接跳过,避免每次 list/轮询都重扫大文件导致卡死
  const nowMs = Date.now()
  if (lastScanDoneMs !== 0 && nowMs - lastScanDoneMs < 6000) return 0
  const root = join(dshHome(), 'sessions')
  let files = []
  try {
    const workspaceDirs = readdirSync(root, { withFileTypes: true })
    for (const ws of workspaceDirs) {
      if (!ws.isDirectory()) continue
      const wsPath = join(root, ws.name)
      let sessionDirs = []
      try {
        sessionDirs = readdirSync(wsPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const sd of sessionDirs) {
        if (!sd.isDirectory() || !sd.name.startsWith('session-')) continue
        const file = join(wsPath, sd.name, 'session.jsonl.zstd')
        if (!existsSync(file)) continue
        files.push({ sessionId: sd.name, file })
      }
    }
  } catch {
    return 0
  }
  let added = 0
  for (const { sessionId, file } of files) {
    // 最近 20s 活跃的会话:其总结由 agent/pre-step 实时维护,跳过重解压
    const lastActive = activeSessionSeen.get(sessionId)
    if (lastActive !== undefined && nowMs - lastActive < 20000) continue
    let st
    try {
      st = statSync(file)
    } catch {
      continue
    }
    const prev = scannedFiles.get(file)
    if (prev !== undefined && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
    try {
      const text = decodeSessionText(file)
      const events = []
      for (const line of text.split('\n')) {
        if (line === '') continue
        try {
          const event = JSON.parse(line)
          if (event && typeof event === 'object' && (event.type === 'user/message' || event.type === 'assistant/message')) {
            events.push(event)
          }
        } catch {
          /* 跳过损坏行 */
        }
      }
      if (upsertSummary(sessionId, events)) added++
      scannedFiles.set(file, { mtimeMs: st.mtimeMs, size: st.size })
    } catch (err) {
      ctx_logger_warn(`dsh-memory: history scan failed for ${sessionId}: ${err && err.message ? err.message : String(err)}`)
    }
  }
  lastScanDoneMs = Date.now()
  return added
}

/** 惰性触发历史扫描(首次查询时清理旧数据并全量,之后只扫变更),串行防并发。 */
let legacyPruned = false
function ensureHistoryScanned() {
  scanChain = scanChain.then(async () => {
    if (!legacyPruned) {
      legacyPruned = true
      pruneLegacyEntries()
    }
    return scanHistorySessions()
  }).catch(() => 0)
  return scanChain
}

/* ── webServer 端点 ──────────────────────────────────────────────────── */

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

async function handleList(input) {
  await ensureHistoryScanned()
  loadStoreIfNeeded()
  loadTitles()
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
  const role = typeof input.role === 'string' && input.role !== '' ? input.role : ''
  const limit = Math.max(1, Math.min(500, Number.isFinite(Number(input.limit)) ? Number(input.limit) : 200))
  let list = store.entries
  if (role === 'user' || role === 'assistant') list = list.filter((e) => e.role === role)
  if (query !== '') list = list.filter((e) => e.text.toLowerCase().includes(query))
  // 倒序:最近在前
  const tail = list.slice(-limit).reverse()
  const sessions = new Set()
  let today = 0
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const e of store.entries) {
    sessions.add(e.sessionId)
    const t = new Date(e.time).getTime()
    if (Number.isFinite(t) && t >= startOfToday) today++
  }
  return {
    ok: true,
    total: store.entries.length,
    sessions: sessions.size,
    today,
    entries: tail.map((e) => ({
      ...e,
      sessionTitle: sessionTitle(e.sessionId),
    })),
  }
}

async function handleStats() {
  await ensureHistoryScanned()
  loadStoreIfNeeded()
  loadTitles()
  const sessions = new Set()
  let today = 0
  let oldest = null
  let newest = null
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const e of store.entries) {
    sessions.add(e.sessionId)
    const t = new Date(e.time).getTime()
    if (Number.isFinite(t)) {
      if (t >= startOfToday) today++
      if (oldest === null || t < oldest) oldest = t
      if (newest === null || t > newest) newest = t
    }
  }
  return {
    ok: true,
    total: store.entries.length,
    sessions: sessions.size,
    today,
    oldest,
    newest,
  }
}

function handleDelete(input) {
  loadStoreIfNeeded()
  const ids = Array.isArray(input.ids)
    ? input.ids.filter((id) => typeof id === 'string' && id !== '')
    : []
  const removed = removeEntries(ids)
  return { ok: true, removed }
}

function handleClear() {
  store.entries = []
  store.ids.clear()
  store.dirty = true
  persistStore()
  return { ok: true, removed: 0 }
}

/* ── 原文全文搜索(遍历会话归档,匹配具体出现的对话内容)────────────── */

const SNIPPET_HALF = 80 // 命中片段前后各保留的字符数
const MAX_HITS_PER_MSG = 3 // 单条消息最多返回的命中次数(避免长消息刷屏)

/** 以第 idx 处命中为中心截取片段(两端加省略号标记)。 */
function makeSnippet(text, idx, qlen) {
  const start = Math.max(0, idx - SNIPPET_HALF)
  const end = Math.min(text.length, idx + qlen + SNIPPET_HALF)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** 收集一条消息正文里 query 的全部出现位置(单条消息封顶)。 */
function collectMatches(body, q) {
  const lower = body.toLowerCase()
  const ats = []
  let idx = lower.indexOf(q)
  while (idx !== -1 && ats.length < MAX_HITS_PER_MSG) {
    ats.push(idx)
    idx = lower.indexOf(q, idx + q.length)
  }
  return ats
}

/**
 * 深搜:遍历 ~/.dsh/sessions 下所有会话归档,解压(带 mtime/size 缓存)
 * 后在 user/assistant 消息原文中做大小写不敏感的子串匹配,按时间倒序返回命中。
 */
async function handleSearch(input) {
  loadTitles()
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
  if (query === '') return { ok: true, total: 0, sessions: 0, entries: [] }
  const limit = Math.max(1, Math.min(500, Number.isFinite(Number(input.limit)) ? Number(input.limit) : 200))
  const onlySession = typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : ''
  const root = join(dshHome(), 'sessions')
  const hits = []
  try {
    const workspaceDirs = readdirSync(root, { withFileTypes: true })
    for (const ws of workspaceDirs) {
      if (!ws.isDirectory()) continue
      const wsPath = join(root, ws.name)
      let sessionDirs = []
      try {
        sessionDirs = readdirSync(wsPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const sd of sessionDirs) {
        if (!sd.isDirectory() || !sd.name.startsWith('session-')) continue
        if (onlySession !== '' && sd.name !== onlySession) continue
        const file = join(wsPath, sd.name, 'session.jsonl.zstd')
        if (!existsSync(file)) continue
        let text
        try {
          text = decodeSessionText(file)
        } catch {
          continue
        }
        for (const line of text.split('\n')) {
          if (line === '') continue
          let event
          try {
            event = JSON.parse(line)
          } catch {
            continue
          }
          if (!event || typeof event !== 'object') continue
          const isUser = event.type === 'user/message'
          const isAsst = event.type === 'assistant/message'
          if (!isUser && !isAsst) continue
          const body = contentText(isUser ? event.data.content : event.data.message && event.data.message.content)
          if (body === '') continue
          const ats = collectMatches(body, query)
          if (ats.length === 0) continue
          const turn = typeof (event.data && event.data.turn) === 'number' ? event.data.turn : 0
          for (const at of ats) {
            hits.push({
              id: `hit:${sd.name}:${event.time || ''}:${hits.length}`,
              sessionId: sd.name,
              sessionTitle: sessionTitle(sd.name),
              role: isUser ? 'user' : 'assistant',
              turn,
              time: typeof event.time === 'string' ? event.time : '',
              text: body,
              snippet: makeSnippet(body, at, query.length),
            })
          }
        }
      }
    }
  } catch {
    /* 搜索过程任何 I/O 异常都返回已收集的命中 */
  }
  hits.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  const total = hits.length
  const entries = hits.slice(-limit).reverse()
  return {
    ok: true,
    total,
    sessions: new Set(entries.map((e) => e.sessionId)).size,
    entries,
  }
}

/* ── 插件主体 ───────────────────────────────────────────────────────── */

export function apply(ctx) {
  setLogger(ctx.logger)
  const lastUpsertAt = new Map() // sessionId → ms(实时总结节流)
  // 记忆采集:活动会话标记为已维护,并节流更新其总结(幂等,内容未变不落盘)。
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision || decision.kind === 'reject') return decision
    try {
      const session = payload && payload.agent && payload.agent.session
      const sessionId = session && typeof session.id === 'string' ? session.id : null
      if (sessionId !== null) {
        const nowMs = Date.now()
        activeSessionSeen.set(sessionId, nowMs)
        const lastU = lastUpsertAt.get(sessionId) || 0
        if (nowMs - lastU > 2000) {
          let events
          try {
            events = session.events
          } catch {
            events = undefined
          }
          if (Array.isArray(events)) {
            upsertSummary(sessionId, events)
            lastUpsertAt.set(sessionId, nowMs)
          }
        }
      }
    } catch (err) {
      ctx.logger?.warn?.('dsh-memory: scan failed: %s', err && err.message ? err.message : String(err))
    }
    return decision
  })

  ctx.inject(['webServer'], (injected) => {
    injected.webServer.register({
      kind: 'prefix',
      path: '/dsh-memory',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const action = url.pathname.split('/').filter(Boolean).pop() || 'list'

        // GET /dsh-memory/asset?name=earth-day → 返回本地缓存的真实纹理
        if (req.method === 'GET' && action === 'asset') {
          const name = url.searchParams.get('name') || ''
          const spec = ASSET_SOURCES[name]
          if (!spec) {
            sendJson(res, 404, { ok: false, reason: 'unknown-asset' })
            return
          }
          try {
            const file = await ensureAsset(name)
            if (!file) throw new Error('asset unavailable')
            const data = readFileSync(file)
            res.writeHead(200, {
              'content-type': spec.type,
              'content-length': data.length,
              'cache-control': 'max-age=86400',
            })
            res.end(data)
          } catch (err) {
            sendJson(res, 502, { ok: false, reason: 'asset-fetch-failed', error: err && err.message ? err.message : String(err) })
          }
          return
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, reason: 'method' })
          return
        }
        let input
        try {
          input = await readBody(req)
        } catch (err) {
          sendJson(res, 400, { ok: false, reason: 'bad-json' })
          return
        }
        try {
          let result
          switch (action) {
            case 'list': result = await handleList(input); break
            case 'search': result = await handleSearch(input); break
            case 'stats': result = await handleStats(); break
            case 'delete': result = handleDelete(input); break
            case 'clear': result = handleClear(); break
            default: result = { ok: false, reason: 'unknown' }
          }
          sendJson(res, result.ok === false && result.reason ? 400 : 200, result)
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            reason: 'internal',
            error: err && err.message ? err.message : String(err),
          })
        }
      },
    })
  })
}