/**
 * dsh-memory client half —「记忆」会话视图标签页(放在「轨迹」旁边)。
 *
 * 数据全部来自 host 半区的同源端点 /dsh-memory(list / stats / delete / clear),
 * 无任何请求进入模型。
 *
 * UI:星际记忆地图。整幅深空场景,巨大的真实感地球占据正中并自转
 * (程序化生成等距圆柱纹理:海洋/大陆/冰冠/云层 + 大气散射 + 光照明暗);
 * 每条记忆按确定性经纬度驻留球面(提问=青色/回复=紫色光点),近大远小、
 * 随自转移动;轨道上信号光点与两艘写实风格航天器巡航点缀。
 * 点击地球上的节点即弹出记忆详情浮层(全文/复制/删除/翻页),顶部悬浮
 * HUD 提供搜索、过滤、统计与刷新;清空库走红色确认弹窗,不会误触。
 * 记忆视图激活时隐藏底部输入框,界面一路铺到底。
 */
window.__ModuleLoader__.load({
	id: "dsh-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const { jsx, jsxs, Fragment } = jsxRuntime;
		const reactDom = require("react-dom");
		const createPortal = reactDom.createPortal;

		const NS = "memory";

		/* ── 端点调用 ─────────────────────────────────────────────────── */
		async function api(action, body) {
			const res = await fetch("/dsh-memory/" + action, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {})
			});
			let data = null;
			try { data = await res.json(); } catch {}
			if (!res.ok || !data || data.ok !== true) {
				throw new Error((data && (data.reason || data.error)) || ("HTTP " + res.status));
			}
			return data;
		}

		/* ── 设置管理 ──────────────────────────────────────────────── */
		const SETTINGS_KEYS = {
			hideStars: "dsh-memory-hide-stars",
			closeOnBlur: "dsh-memory-close-on-blur"
		};
		function getSetting(key, defaultValue) {
			try {
				const val = localStorage.getItem(key);
				if (val === null) return defaultValue;
				return val === "true";
			} catch {
				return defaultValue;
			}
		}
		function setSetting(key, value) {
			try {
				localStorage.setItem(key, String(value));
			} catch {}
		}

		/* ── 工具函数 ────────────────────────────────────────────────── */
		function fmtTime(iso) {
			const d = new Date(iso);
			if (!Number.isFinite(d.getTime())) return iso;
			const p = (n) => String(n).padStart(2, "0");
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
		}
		function ellipsis(text, max) {
			return text.length > max ? text.slice(0, max) + "…" : text;
		}
		function geoFromId(id) {
			let h1 = 0x811c9dc5, h2 = 0x1000193;
			const s = String(id || "");
			for (let i = 0; i < s.length; i++) {
				const c = s.charCodeAt(i);
				h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
				h2 = Math.imul(h2 ^ (c * 31 + 7), 2246822519) >>> 0;
			}
			const lat = ((h1 % 100000) / 100000) * 150 - 75;
			const lon = ((h2 % 100000) / 100000) * 360 - 180;
			return { lat: (lat * Math.PI) / 180, lon: (lon * Math.PI) / 180 };
		}

		const { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } = react;

		/* ════════════════════════════════════════════════════════════════
		   程序化真实感地球纹理(等距圆柱投影,1024x512)
		   ════════════════════════════════════════════════════════════════ */
		let earthTextures = null;
		function buildEarthTextures() {
			if (earthTextures !== null) return earthTextures;
			const TW = 1024, TH = 512;
			const surface = document.createElement("canvas");
			surface.width = TW; surface.height = TH;
			const sx = surface.getContext("2d");

			// 海洋:纬度渐变 + 细微噪点
			const sea = sx.createLinearGradient(0, 0, 0, TH);
			sea.addColorStop(0, "#0d2a4e");
			sea.addColorStop(0.4, "#11406e");
			sea.addColorStop(0.62, "#0c3258");
			sea.addColorStop(1, "#091e38");
			sx.fillStyle = sea;
			sx.fillRect(0, 0, TW, TH);
			for (let i = 0; i < 9000; i++) {
				const px = (Math.sin(i * 127.1) * 43758.5453) % 1;
				const py = (Math.sin(i * 311.7) * 43758.5453) % 1;
				const v = Math.abs(Math.sin(i * 91.3) * 43758.5453) % 1;
				sx.fillStyle = v > 0.5 ? "rgba(20,60,105,.25)" : "rgba(6,18,38,.25)";
				sx.fillRect((i * 7) % TW, (i * 13) % TH, 2, 1);
			}

			// 大陆:确定性种子 → 不规则斑块 + 岸线噪点
			const seeds = [];
			for (let k = 0; k < 30; k++) {
				const a = (k * 0.6180339887498949) % 1;
				const py = 40 + ((k * 37 * 13) % (TH - 80));
				const px = ((a * TW * 1.618) % TW) | 0;
				seeds.push({
					px, py,
					r: 46 + ((Math.abs(Math.sin(k * 12.9898)) * 10000) % 1) * 150,
					rot: k * 0.7,
					shade: 0.55 + ((Math.abs(Math.sin(k * 78.233)) * 10000) % 1) * 0.45
				});
			}
			for (const s of seeds) {
				const g = sx.createRadialGradient(s.px, s.py, 0, s.px, s.py, s.r * 1.25);
				g.addColorStop(0, `rgba(${46 + s.shade * 18},${86 + s.shade * 22},${54 + s.shade * 10},.95)`);
				g.addColorStop(0.7, `rgba(52,88,52,.75)`);
				g.addColorStop(1, `rgba(30,52,40,0)`);
				sx.fillStyle = g;
				sx.beginPath();
				sx.ellipse(s.px, s.py, s.r, s.r * (0.55 + s.shade * 0.25), s.rot, 0, Math.PI * 2);
				sx.fill();
			}
			// 内陆沙色/棕色点缀
			for (let i = 0; i < 2600; i++) {
				const seed = seeds[i % seeds.length];
				if (!seed) continue;
				const dx = ((Math.sin(i * 71.7) * 10000) % 1) * 2 - 1;
				const dy = ((Math.sin(i * 53.3) * 10000) % 1) * 2 - 1;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d > 1) continue;
				const px = seed.px + dx * seed.r * 0.9;
				const py = seed.py + dy * seed.r * 0.7;
				if (py < 40 || py > TH - 40) continue;
				const v = (Math.sin(i * 9.1) * 10000) % 1;
				sx.fillStyle = v > 0.5 ? "rgba(122,104,64,.4)" : "rgba(46,86,54,.5)";
				sx.fillRect(px | 0, py | 0, 3, 2);
			}
			// 海岸噪点(岸线碎边)
			for (let i = 0; i < 14000; i++) {
				const a = (Math.sin(i * 12.9898) * 43758.5453) % 1;
				const b = (Math.sin(i * 78.233) * 43758.5453) % 1;
				const px = (a * TW) | 0;
				const py = (b * TH) | 0;
				const v = (Math.sin(i * 31.7) * 43758.5453) % 1;
				if (v > 0.52) {
					sx.fillStyle = "rgba(58,96,62,.35)";
					sx.fillRect(px, py, 2, 2);
				}
			}
			// 极地冰冠
			const iceTop = sx.createLinearGradient(0, 0, 0, 60);
			iceTop.addColorStop(0, "rgba(236,246,255,.95)");
			iceTop.addColorStop(1, "rgba(236,246,255,0)");
			sx.fillStyle = iceTop;
			sx.fillRect(0, 0, TW, 56);
			const iceBot = sx.createLinearGradient(0, TH, 0, TH - 60);
			iceBot.addColorStop(0, "rgba(234,244,255,.92)");
			iceBot.addColorStop(1, "rgba(234,244,255,0)");
			sx.fillStyle = iceBot;
			sx.fillRect(0, TH - 54, TW, 54);

			// 云层:独立的半透明白层(转速不同,形成流动感)
			const clouds = document.createElement("canvas");
			clouds.width = TW; clouds.height = TH;
			const cx = clouds.getContext("2d");
			cx.clearRect(0, 0, TW, TH);
			for (let i = 0; i < 420; i++) {
				const a = (Math.sin(i * 17.17) * 43758.5453) % 1;
				const b = (Math.sin(i * 61.3) * 43758.5453) % 1;
				const px = (a * TW) | 0;
				const py = 40 + ((b * (TH - 80)) | 0);
				const r = 20 + ((Math.abs(Math.sin(i * 3.7)) * 10000) % 1) * 55;
				const o = 0.06 + ((Math.abs(Math.sin(i * 5.1)) * 10000) % 1) * 0.14;
				const g = cx.createRadialGradient(px, py, 0, px, py, r);
				g.addColorStop(0, `rgba(255,255,255,${o})`);
				g.addColorStop(1, "rgba(255,255,255,0)");
				cx.fillStyle = g;
				cx.beginPath();
				cx.ellipse(px, py, r, r * 0.45, i * 0.31, 0, Math.PI * 2);
				cx.fill();
			}
			earthTextures = { surface, clouds, TW, TH };
			return earthTextures;
		}

		/* ── 真实地球纹理(懒加载:Blue Marble 昼 + Black Marble 夜)──────── */
		let realEarth = null;
		let realEarthStarted = false;
		function loadRealEarth() {
			if (realEarth !== null || realEarthStarted) return;
			realEarthStarted = true;
			const mat = { day: null, night: null, topology: null, failed: false };
			realEarth = mat;
			const load = (name, key) => {
				const img = new Image();
				img.onload = () => { mat[key] = img; };
				img.onerror = () => { mat.failed = true; };
				img.src = "/dsh-memory/asset?name=" + name;
			};
			load("earth-day", "day");
			load("earth-night", "night");
			load("earth-topology", "topology");
		}

		/* 等距圆柱贴图 → 球面正交投影(逐行卷绕纹理绘制,几何正确的自转) */
		function drawSphereTexture(c, img, R, cx, cy, offPx, alpha, composite) {
			const texW = img.naturalWidth || img.width;
			const texH = img.naturalHeight || img.height;
			if (!texW || !texH) return;
			const H = Math.ceil(2 * R);
			const off = ((offPx % texW) + texW) % texW;
			c.save();
			c.globalAlpha = alpha;
			if (composite) c.globalCompositeOperation = composite;
			// 隔行绘制(每行高 2px):blit 减半,视觉无差,兼顾性能
			const STEP = 2;
			for (let iy = 0; iy <= H; iy += STEP) {
				const dy = iy - R;
				const yy = cy - R + iy;
				if (yy < -2 || yy > c.canvas.height + 2) continue;
				const rr = R * R - dy * dy;
				if (rr <= 0) continue;
				const half = Math.sqrt(rr);
				const lat = Math.asin(Math.max(-1, Math.min(1, dy / R)));
				const sy = Math.max(0, Math.min(texH - 1, Math.round((lat / Math.PI + 0.5) * texH)));
				const x0 = cx - half;
				const span = 2 * half;
				const w1 = texW - off;
				if (w1 > 0) c.drawImage(img, off, sy, w1, 1, x0, yy, span * (w1 / texW), STEP);
				if (off > 0) c.drawImage(img, 0, sy, off, 1, x0 + span * (w1 / texW), yy, span * (off / texW), STEP);
			}
			c.restore();
		}

		/* ════════════════════════════════════════════════════════════════
		   星际记忆地图(canvas 实时渲染 + 命中检测)
		   ════════════════════════════════════════════════════════════════ */
		function EarthScene({ t, entries, selectedId, hoverId, onHover, onPick, hideStars }) {
			const wrapRef = useRef(null);
			const canvasRef = useRef(null);
			const entriesRef = useRef(entries);
			entriesRef.current = entries;
			const pickRef = useRef(onPick);
			pickRef.current = onPick;
			const hoverRef = useRef(onHover);
			hoverRef.current = onHover;
			const selRef = useRef(selectedId);
			selRef.current = selectedId;
			const hovRef = useRef(hoverId);
			hovRef.current = hoverId;
			const hideStarsRef = useRef(hideStars);
			hideStarsRef.current = hideStars;

			useEffect(() => {
				const wrap = wrapRef.current;
				const canvas = canvasRef.current;
				if (!wrap || !canvas) return;
				const ctx = canvas.getContext("2d");
				let raf = 0;
				let w = 0;
				let h = 0;

				/* 星空 */
				const stars = Array.from({ length: 110 }, () => ({
					x: Math.random(), y: Math.random(),
					r: 0.4 + Math.random() * 1.1,
					phase: Math.random() * Math.PI * 2,
					tw: 0.4 + Math.random() * 0.6,
					dir: Math.random() < 0.5 ? 1 : -1
				}));
				const nebulas = [
					{ x: 0.2, y: 0.28, r: 0.5, phase: 0, color: "157,92,255" },
					{ x: 0.78, y: 0.74, r: 0.45, phase: 2.1, color: "0,240,255" }
				];
				/* 航天器:水平椭圆轨道绕地球环绕飞行,船身保持横向水平(无轨道线,速度中等偏慢) */
				const crafts = [
					{ kind: "scout", base: "#9fb2cc", size: 1.5 },
					{ kind: "cargo", base: "#b8a688", size: 1.6 },
					{ kind: "sat", base: "#8fa3bf", size: 1.5 },
					{ kind: "sat", base: "#a9b8cf", size: 1.4 },
					{ kind: "station", base: "#c9d4e8", size: 1.7 },
					{ kind: "probe", base: "#cfc8b8", size: 1.55 }
				].map((c, i) => ({
					...c,
					angle: Math.random() * 6.283,
					rad: 1.3 + Math.random() * 0.65, // 椭圆形轨道横向半径(地球半径倍数)
					targetRad: 1.3 + Math.random() * 0.65,
					vert: 0.42 + Math.random() * 0.12, // 椭圆纵向压扁(水平环面观感)
					speed: 0.1 + Math.random() * 0.12, // 角速度 rad/s(适中:绕一圈约 30-60 秒)
					targetSpeed: 0.1 + Math.random() * 0.12,
					dir: Math.random() < 0.5 ? 1 : -1,
					phase: Math.random() * 6.283,
					nextFlicker: performance.now() + 2500 + Math.random() * 3500
				}));
				/* 自由漂移信号光点(无轨道,随机游走) */
				const pulses = Array.from({ length: 4 }, (_, i) => ({
					x: Math.random(), y: Math.random(),
					r: 1.4 + Math.random() * 1.8,
					dx: (Math.random() - 0.5) * 0.5,
					dy: (Math.random() - 0.5) * 0.5,
					color: i % 3 === 0 ? "0,240,255" : i % 3 === 1 ? "180,140,255" : "255,190,110",
					trail: []
				}));
				/* 轨道碎片带(微小金属碎屑,随机漂移) */
				const dust = Array.from({ length: 32 }, (_, i) => ({
					dx: (Math.random() - 0.5) * 0.4,
					dy: (Math.random() - 0.5) * 0.4,
					x: (Math.random() - 0.5) * 2.4,
					y: (Math.random() - 0.5) * 2.0,
					r: 0.5 + Math.random() * 1.1,
					ph: Math.random() * 6.28,
					sx: (Math.random() - 0.5) * 0.12,
					sy: (Math.random() - 0.5) * 0.12
				}));
				/* 相机:缩放 + 平移 */
				let zoom = 1, panX = 0, panY = 0;
				const MIN_ZOOM = 0.45, MAX_ZOOM = 3.2;
				let dragging = false, dragMoved = false, dragStart = null;
				let hitPoints = [];
				let mouse = { x: 0, y: 0, inside: false };
				let t0 = performance.now();
				let lastHudTick = 0;
				const coord = { x: 42.6, y: 118.3 };

				let dprScale = 1; // 性能自适应:持续高负载时降低渲染清晰度
				let perfMode = 0;
				let slowCount = 0;

				const FRAME_BUDGET = 33; // 帧预算(ms):渲染封顶约 30 FPS,防止主线程过载卡死
				let lastRenderAt = 0;
				let bgCache = null; // 静态星空/星云缓存(单次 drawImage,消除每帧重建渐变)

				function buildBg() {
					const c = document.createElement("canvas");
					c.width = w; c.height = h;
					const g = c.getContext("2d");
					for (const s of stars) {
						const x = s.x * w, y = s.y * h;
						const a = (0.3 + 0.7 * Math.abs(Math.sin(s.phase))) * s.tw;
						g.fillStyle = a < 0.55 ? `rgba(170,210,255,${a})` : `rgba(255,255,255,${a})`;
						g.beginPath(); g.arc(x, y, s.r, 0, Math.PI * 2); g.fill();
					}
					for (const n of nebulas) {
						const gr = g.createRadialGradient(n.x * w, n.y * h, 0, n.x * w, n.y * h, n.r * Math.min(w, h));
						gr.addColorStop(0, `rgba(${n.color},.14)`);
						gr.addColorStop(1, `rgba(${n.color},0)`);
						g.fillStyle = gr;
						g.fillRect(0, 0, w, h);
					}
					return c;
				}

				function resize() {
					const rect = wrap.getBoundingClientRect();
					w = Math.max(80, rect.width);
					h = Math.max(80, rect.height);
					const dpr = Math.min(1.25, dprScale * (window.devicePixelRatio || 1));
					canvas.width = Math.round(w * dpr);
					canvas.height = Math.round(h * dpr);
					canvas.style.width = w + "px";
					canvas.style.height = h + "px";
					bgCache = buildBg(); // 尺寸/清晰度变化时同步重建背景缓存
					ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				}
				resize();
				const ro = new ResizeObserver(resize);
				ro.observe(wrap);

				const onMouse = (e) => {
					const r = wrap.getBoundingClientRect();
					mouse.x = e.clientX - r.left;
					mouse.y = e.clientY - r.top;
					mouse.inside = true;
				};
				const onLeave = () => { mouse.inside = false; hoverRef.current = null; };
				const onClick = (e) => {
					if (dragMoved) return; // 拖拽平移后不触发节点选择
					const r = wrap.getBoundingClientRect();
					const mx = e.clientX - r.left;
					const my = e.clientY - r.top;
					let best = null, bestD = 18;
					for (const p of hitPoints) {
						const d = Math.hypot(p.x - mx, p.y - my);
						if (d < bestD) { bestD = d; best = p.id; }
					}
					if (best !== null) { e.stopPropagation(); pickRef.current(best); }
				};
				const onWheel = (e) => {
					// 仅 Ctrl / ⌘ + 滚轮缩放,普通滚轮放行(不劫持页面滚动)
					if (!e.ctrlKey && !e.metaKey) return;
					e.preventDefault();
					const rect = wrap.getBoundingClientRect();
					const mx = e.clientX - rect.left;
					const my = e.clientY - rect.top;
					const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
					const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
					const k = nz / zoom;
					panX = mx - (mx - panX) * k;
					panY = my - (my - panY) * k;
					zoom = nz;
				};
				const onPointerDown = (e) => {
					dragging = true;
					dragMoved = false;
					dragStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
					try { wrap.setPointerCapture(e.pointerId); } catch {}
				};
				const onPointerMove = (e) => {
					if (!dragging || !dragStart) return;
					const dx = e.clientX - dragStart.x;
					const dy = e.clientY - dragStart.y;
					if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
					panX = dragStart.px + dx;
					panY = dragStart.py + dy;
				};
				const onPointerUp = (e) => {
					dragging = false;
					dragStart = null;
					dragMoved = false; // 复位:普通点击(哪怕轻微抖动)也应命中节点
				};
				const onDblClick = () => {
					zoom = 1; panX = 0; panY = 0;
				};
				wrap.addEventListener("mousemove", onMouse);
				wrap.addEventListener("mouseleave", onLeave);
				wrap.addEventListener("click", onClick);
				wrap.addEventListener("wheel", onWheel, { passive: false });
				wrap.addEventListener("pointerdown", onPointerDown);
				wrap.addEventListener("pointermove", onPointerMove);
				wrap.addEventListener("pointerup", onPointerUp);
				wrap.addEventListener("dblclick", onDblClick);

				function project(lat, lon, R, cx, cy, rot) {
					const lr = lon + rot;
					const x = Math.cos(lat) * Math.sin(lr);
					const y = Math.sin(lat);
					const z = Math.cos(lat) * Math.cos(lr);
					return { x: cx + x * R, y: cy - y * R, z };
				}

				/* 写实航天器编队(金属反光:侦察梭/运输舰/通信卫星/环状空间站/深空探测器) */
				function drawCraft(x, y, angle, size, kind, base, pulse, now) {
					ctx.save();
					ctx.translate(x, y);
					ctx.rotate(angle);
					ctx.scale(size, size);
					ctx.lineJoin = "round";

					if (kind === "scout") {
						// 细长侦查梭:双层金属、前窗亮线、推进器细喷流
						const g = ctx.createLinearGradient(0, -10, 0, 10);
						g.addColorStop(0, "#dfe9f6");
						g.addColorStop(0.5, base);
						g.addColorStop(1, "#39455c");
						ctx.fillStyle = g;
						ctx.shadowColor = "rgba(160,200,255,.5)";
						ctx.shadowBlur = 2;
						ctx.beginPath();
						ctx.moveTo(0, -13);
						ctx.quadraticCurveTo(-2.6, -4, -1.6, 5);
						ctx.lineTo(-3.2, 9);
						ctx.lineTo(0, 10.5);
						ctx.lineTo(3.2, 9);
						ctx.lineTo(1.6, 5);
						ctx.quadraticCurveTo(2.6, -4, 0, -13);
						ctx.closePath();
						ctx.fill();
						ctx.shadowBlur = 0;
						ctx.strokeStyle = "rgba(140,225,255,.95)";
						ctx.lineWidth = 1.1;
						ctx.beginPath();
						ctx.moveTo(0, -9.5);
						ctx.lineTo(0, -1.5);
						ctx.stroke();
						const len = 5 + pulse * 4;
						const fg = ctx.createLinearGradient(0, 9, 0, 9 + len);
						fg.addColorStop(0, "rgba(190,235,255,.9)");
						fg.addColorStop(1, "rgba(190,235,255,0)");
						ctx.fillStyle = fg;
						ctx.beginPath();
						ctx.moveTo(-1.1, 9);
						ctx.lineTo(0, 9 + len);
						ctx.lineTo(1.1, 9);
						ctx.closePath();
						ctx.fill();
					} else if (kind === "cargo") {
						// 货运扁舰:圆角箱体 + 前端斜面 + 双引擎
						const g = ctx.createLinearGradient(0, -6, 0, 6);
						g.addColorStop(0, "#d8cfc0");
						g.addColorStop(0.5, base);
						g.addColorStop(1, "#4a4438");
						ctx.fillStyle = g;
						ctx.shadowColor = "rgba(255,200,150,.35)";
						ctx.shadowBlur = 2;
						ctx.beginPath();
						ctx.moveTo(-11, -5.5);
						ctx.lineTo(5, -5.5);
						ctx.quadraticCurveTo(11, -5.5, 11, 0);
						ctx.lineTo(11, 5.5);
						ctx.lineTo(-11, 5.5);
						ctx.closePath();
						ctx.fill();
						ctx.shadowBlur = 0;
						ctx.strokeStyle = "rgba(255,255,255,.5)";
						ctx.lineWidth = 0.7;
						ctx.beginPath();
						ctx.moveTo(-7, -5.5); ctx.lineTo(-7, 5.5);
						ctx.stroke();
						ctx.fillStyle = "rgba(150,230,255,.9)";
						ctx.fillRect(8.2, -1.6, 2.4, 3.2);
						const len = 4.5 + pulse * 4;
						for (const ex of [-5, 5]) {
							const fg = ctx.createLinearGradient(ex, 5.5, ex, 5.5 + len);
							fg.addColorStop(0, "rgba(255,210,160,.85)");
							fg.addColorStop(1, "rgba(255,210,160,0)");
							ctx.fillStyle = fg;
							ctx.beginPath();
							ctx.moveTo(ex - 1.1, 5.5);
							ctx.lineTo(ex, 5.5 + len);
							ctx.lineTo(ex + 1.1, 5.5);
							ctx.closePath();
							ctx.fill();
						}
					} else if (kind === "sat") {
						// 通信卫星:主体箱 + 双侧太阳能板(深蓝晶板) + 天线
						const g = ctx.createLinearGradient(0, -4, 0, 4);
						g.addColorStop(0, "#e4ecf7");
						g.addColorStop(0.5, base);
						g.addColorStop(1, "#3c465e");
						ctx.fillStyle = g;
						ctx.shadowColor = "rgba(160,200,255,.35)";
						ctx.shadowBlur = 2;
						ctx.fillRect(-4, -3, 8, 6);
						ctx.shadowBlur = 0;
						// 连接杆 + 双侧太阳能板
						ctx.fillStyle = "#5a6a86";
						ctx.fillRect(-4, -0.7, 8, 1.4);
						for (const s of [-1, 1]) {
							ctx.fillStyle = "#1c3f77";
							ctx.fillRect(s === 1 ? 4.2 : -11.2, -2.6, 7, 5.2);
							ctx.strokeStyle = "rgba(120,170,255,.55)";
							ctx.lineWidth = 0.4;
							ctx.strokeRect(s === 1 ? 4.6 : -10.8, -2.2, 6.2, 4.4);
							ctx.beginPath();
							ctx.moveTo(s === 1 ? 7.7 : -7.7, -2.6); ctx.lineTo(s === 1 ? 7.7 : -7.7, 2.6);
							ctx.stroke();
						}
						// 顶部天线
						ctx.strokeStyle = "#7d8ba8";
						ctx.lineWidth = 0.6;
						ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -6); ctx.stroke();
						ctx.fillStyle = "#cfe4ff";
						ctx.beginPath(); ctx.arc(0, -6.4, 1.2, 0, Math.PI * 2); ctx.fill();
						// 姿态微调喷流
						const len = 2 + pulse * 2;
						ctx.fillStyle = "rgba(190,235,255,.8)";
						ctx.beginPath();
						ctx.moveTo(-1, 3); ctx.lineTo(0, 3 + len); ctx.lineTo(1, 3); ctx.closePath();
						ctx.fill();
					} else if (kind === "station") {
						// 环状空间站:自旋圆环 + 径向舱段 + 太阳帆
						const spin = (now / 4200) * Math.PI * 2;
						// 太阳帆(缓慢对日)
						ctx.save();
						ctx.rotate(-Math.PI / 2.4 + Math.sin(spin * 0.5) * 0.25);
						ctx.fillStyle = "#1c3f77";
						ctx.fillRect(-7, -1.1, 11, 3);
						ctx.strokeStyle = "rgba(120,170,255,.5)";
						ctx.lineWidth = 0.4;
						ctx.strokeRect(-7, -1.1, 11, 3);
						ctx.restore();
						// 主环
						ctx.strokeStyle = base;
						ctx.lineWidth = 2.1;
						ctx.shadowColor = "rgba(180,210,255,.5)";
						ctx.shadowBlur = 2;
						ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
						ctx.shadowBlur = 0;
						// 轮缘舱段(4 点)
						for (let i = 0; i < 4; i++) {
							const a = spin + i * Math.PI / 2;
							ctx.fillStyle = "#9fb2cc";
							ctx.beginPath();
							ctx.arc(Math.cos(a) * 7, Math.sin(a) * 7, 1.6, 0, Math.PI * 2);
							ctx.fill();
						}
						// 中心对接舱
						ctx.fillStyle = "#dfe9f6";
						ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
						ctx.fillStyle = "rgba(140,225,255,.95)";
						ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
					} else {
						// 深空探测器:天线碗 + 细长体 + 单侧太阳能板 + 鞭状天线
						const g = ctx.createLinearGradient(0, -4, 0, 4);
						g.addColorStop(0, "#e8e2d2");
						g.addColorStop(0.5, base);
						g.addColorStop(1, "#4a4438");
						ctx.fillStyle = g;
						ctx.shadowColor = "rgba(255,210,150,.4)";
						ctx.shadowBlur = 2;
						ctx.fillRect(-8, -2.5, 15, 5);
						ctx.shadowBlur = 0;
						// 高增益天线碗
						ctx.strokeStyle = "#8a8370";
						ctx.lineWidth = 1;
						ctx.beginPath(); ctx.arc(8.5, 0, 4.6, -Math.PI / 2, Math.PI / 2); ctx.stroke();
						ctx.strokeStyle = "rgba(230,235,240,.85)";
						ctx.lineWidth = 0.6;
						ctx.beginPath(); ctx.arc(8.5, 0, 2.9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
						// 鞭状天线(尾)
						ctx.strokeStyle = "#6a6150";
						ctx.lineWidth = 0.5;
						ctx.beginPath();
						ctx.moveTo(-8, 0);
						ctx.quadraticCurveTo(-12, -4, -14, 1);
						ctx.stroke();
						// 太阳能板(侧)
						ctx.fillStyle = "#1c3f77";
						ctx.fillRect(-5, 2.8, 6, 4.4);
						ctx.strokeStyle = "rgba(120,170,255,.5)";
						ctx.lineWidth = 0.4;
						ctx.strokeRect(-5, 2.8, 6, 4.4);
						// 深空推进喷流
						const len = 2.5 + pulse * 3;
						ctx.fillStyle = "rgba(255,220,170,.85)";
						ctx.beginPath();
						ctx.moveTo(-1, 2.5); ctx.lineTo(0, 2.5 + len); ctx.lineTo(1, 2.5); ctx.closePath();
						ctx.fill();
					}
					ctx.restore();
				}

				/* 真实感地球:低分辨率球面缓冲(逐行投影) + 一次放大贴回窗口 → 绘制量大降 */
				const tex = buildEarthTextures();
				loadRealEarth();
				let fxCache = null; // { R, B, sphere, overlay }
				function buildFx(R) {
					const size = Math.max(8, Math.min(1200, Math.ceil(2 * R)));
					const fx = { R };
					// 球面缓冲:直径 = min(2R, 1024),投影在其中逐行完成,再整体放大
					fx.B = Math.max(8, Math.min(720, Math.ceil(2 * R)));
					fx.sphere = document.createElement("canvas");
					fx.sphere.width = fx.B;
					fx.sphere.height = fx.B;
					// 光照遮罩合并成一张(lit + shade + fresnel)
					fx.overlay = createGrad(size, R, "lit");
					const ov = fx.overlay.getContext("2d");
					ov.drawImage(createGrad(size, R, "shade"), 0, 0);
					ov.drawImage(createGrad(size, R, "fresnel"), 0, 0);
					return fx;
				}
				function createGrad(size, R, kind) {
					const c = document.createElement("canvas");
					c.width = size; c.height = size;
					const g = c.getContext("2d");
					const cxx = size / 2, cyy = size / 2;
					let grad;
					if (kind === "lit") {
						const cx0 = cxx - R * 0.42, cy0 = cyy - R * 0.5;
						grad = g.createRadialGradient(cx0, cy0, R * 0.1, cx0, cy0, R * 1.3);
						grad.addColorStop(0, "rgba(255,255,255,.30)");
						grad.addColorStop(1, "rgba(255,255,255,0)");
						g.fillStyle = grad;
						g.fillRect(0, 0, size, size);
					} else if (kind === "shade") {
						grad = g.createRadialGradient(cxx + R * 1.05, cyy, R * 0.1, cxx, cyy, R * 2.1);
						grad.addColorStop(0, "rgba(0,0,0,0)");
						grad.addColorStop(1, "rgba(2,8,18,.58)");
						g.fillStyle = grad;
						g.fillRect(0, 0, size, size);
					} else {
						grad = g.createRadialGradient(cxx, cyy, R * 0.55, cxx, cyy, R);
						grad.addColorStop(0, "rgba(0,0,0,0)");
						grad.addColorStop(1, "rgba(90,150,230,.16)");
						g.fillStyle = grad;
						g.fillRect(0, 0, size, size);
					}
					return c;
				}
				function drawEarth(time, R, cx, cy) {
					if (!fxCache || Math.abs(fxCache.R - R) > 80) fxCache = buildFx(R);
					const fx = fxCache;
					const B = fx.B;
					const rot = time * 0.15;
					const s = 2 * R;
					const dayImg = realEarth && realEarth.day ? realEarth.day : tex.surface;
					const texW = dayImg.naturalWidth || dayImg.width || tex.TW;
					const offPx = (rot / (Math.PI * 2)) * texW;

					// 1) 在低分辨率球面缓冲中逐行投影(几何正确,成本低)
					const bg = fx.sphere.getContext("2d");
					bg.clearRect(0, 0, B, B);
					drawSphereTexture(bg, dayImg, B / 2, B / 2, B / 2, offPx, 1);
					if (!(realEarth && realEarth.day)) drawSphereTexture(bg, tex.clouds, B / 2, B / 2, B / 2, offPx * 0.6, 0.5);
					if (realEarth && realEarth.night) {
						bg.save();
						bg.beginPath();
						bg.ellipse(B * 0.575, B / 2, B * 0.35, B / 2, 0, 0, Math.PI * 2);
						bg.clip();
						drawSphereTexture(bg, realEarth.night, B / 2, B / 2, B / 2, offPx, 0.55, "lighter");
						bg.restore();
					}

					// 2) 一次放大贴回窗口 + 光照遮罩
					ctx.save();
					ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
					ctx.drawImage(fx.sphere, cx - R, cy - R, s, s);
					ctx.drawImage(fx.overlay, cx - R, cy - R, s, s);
					ctx.restore();
					// 轮廓
					ctx.strokeStyle = "rgba(140,200,255,.4)";
					ctx.lineWidth = 1;
					ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
				}

				let skipNext = false; // 自适应降帧:重负载帧后隔帧渲染,防止卡死
				let lastFrameNow = 0; // 全局帧时间(跳帧也推进,飞船角度不跳步)
				function frame(now) {
					const dtFrame = lastFrameNow === 0 ? 0.016 : (now - lastFrameNow) / 1000;
					lastFrameNow = now;
					if (skipNext) {
						skipNext = false;
						raf = requestAnimationFrame(frame);
						return;
					}
					// 帧预算节流:渲染封顶 ~30FPS,大屏/弱机也不至于把主线程占满而卡死
					if (now - lastRenderAt < FRAME_BUDGET) {
						raf = requestAnimationFrame(frame);
						return;
					}
					lastRenderAt = now;
					const frameStart = performance.now();
					try {
					const time = (now - t0) / 1000;
					ctx.clearRect(0, 0, w, h);

					// 星空 + 星云(缓存的静态背景,单次 drawImage,不再每帧重建渐变)
					if (bgCache && !hideStarsRef.current) ctx.drawImage(bgCache, 0, 0);

					const cx = w / 2 + panX;
					const cy = h * 0.54 + panY;
					const R = Math.min(w, h) * 0.37 * zoom;
					const nodeScale = Math.min(2.4, Math.max(0.7, zoom));

					// 无轨道线;碎片随机漂移(俯视视角,无规律)
					for (const d of dust) {
						// 无规律游走
						d.x += d.sx * 0.006;
						d.y += d.sy * 0.006;
						if (d.x > 1.5) d.x = -1.5;
						if (d.x < -1.5) d.x = 1.5;
						if (d.y > 1.3) d.y = -1.3;
						if (d.y < -1.3) d.y = 1.3;
						const dx = cx + d.x * R;
						const dy = cy + d.y * R;
						const tw = 0.3 + 0.7 * Math.abs(Math.sin(now / 700 + d.ph));
						ctx.fillStyle = `rgba(180,195,215,${0.1 + 0.28 * tw})`;
						ctx.beginPath(); ctx.arc(dx, dy, d.r * Math.min(1.8, zoom), 0, Math.PI * 2); ctx.fill();
					}

					drawEarth(time, R, cx, cy);

					// 记忆节点(深色描边 + 亮芯:亮面/暗面都清晰可见;柔光克制,不产生连线伪影)
					const list = entriesRef.current || [];
					hitPoints = [];
					for (const e of list) {
						const g = geoFromId(e.id);
						const p = project(g.lat, g.lon, R, cx, cy, time * 0.15);
						if (p.z <= 0.05) continue;
						const isSel = selRef.current === e.id;
						const isHov = hovRef.current === e.id;
						const size = (2.6 + 2.2 * p.z) * nodeScale * (isSel ? 2.2 : isHov ? 1.7 : 1);
						const rgb = e.role === "user" ? "0,240,255" : e.role === "assistant" ? "180,140,255" : "255,205,120";
						const zA = 0.5 + 0.5 * p.z;
						hitPoints.push({ id: e.id, x: p.x, y: p.y });
						if (isSel || isHov) {
							ctx.strokeStyle = isSel ? "rgba(255,255,255,.9)" : `rgba(${rgb},.75)`;
							ctx.lineWidth = isSel ? 1.6 : 1.2;
							ctx.beginPath();
							ctx.arc(p.x, p.y, size + 5 + (isSel ? 2 * Math.sin(now / 220) : 0), 0, Math.PI * 2);
							ctx.stroke();
						}
						// 细柔光(微弱,不重叠成线)
						ctx.globalAlpha = zA * 0.07;
						ctx.fillStyle = `rgba(${rgb},1)`;
						ctx.beginPath(); ctx.arc(p.x, p.y, size * 2.2, 0, Math.PI * 2); ctx.fill();
						ctx.globalAlpha = 1;
						// 本体(带深色描边,亮面也醒目)
						ctx.strokeStyle = "rgba(3,8,18,.85)";
						ctx.lineWidth = 1;
						ctx.fillStyle = `rgba(${rgb},${zA})`;
						ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
						ctx.stroke();
						// 亮芯
						ctx.fillStyle = "rgba(255,255,255,.9)";
						ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.7, size * 0.36), 0, Math.PI * 2); ctx.fill();
					}

					// 自由漂移信号光点(无轨道,随机游走带尾迹)
					for (const p of pulses) {
						// 无规律转向
						if (Math.random() < 0.02) { p.dx = (Math.random() - 0.5) * 0.9; p.dy = (Math.random() - 0.5) * 0.9; }
						p.x += p.dx * 0.0018;
						p.y += p.dy * 0.0018;
						if (p.x > 1.4) { p.x = 1.4; p.dx = -Math.abs(p.dx); }
						if (p.x < -1.4) { p.x = -1.4; p.dx = Math.abs(p.dx); }
						if (p.y > 1.1) { p.y = 1.1; p.dy = -Math.abs(p.dy); }
						if (p.y < -1.1) { p.y = -1.1; p.dy = Math.abs(p.dy); }
						const px = cx + p.x * R;
						const py = cy + p.y * R;
						p.trail.push({ x: px, y: py });
						if (p.trail.length > 9) p.trail.shift();
						for (let i = 1; i < p.trail.length; i++) {
							const fr = i / p.trail.length;
							ctx.strokeStyle = `rgba(${p.color},${0.2 * fr})`;
							ctx.lineWidth = 1.3 * fr;
							ctx.beginPath();
							ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
							ctx.lineTo(p.trail[i].x, p.trail[i].y);
							ctx.stroke();
						}
						ctx.fillStyle = `rgba(${p.color},.9)`;
						ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
					}

					// 航天器:水平椭圆轨道绕地球环绕;背面(上方半圈)被地球遮挡不可见;参数平滑无抽搐
					for (const c of crafts) {
						// 定时微调:仅更新"目标值",实际值每帧平滑逼近 → 无位置突变
						if (now > c.nextFlicker) {
							c.nextFlicker = now + 2500 + Math.random() * 3500;
							if (Math.random() < 0.35) c.dir = Math.random() < 0.5 ? 1 : -1;
							c.targetSpeed = Math.max(0.07, Math.min(0.24, c.speed + (Math.random() - 0.5) * 0.06));
							c.targetRad = Math.max(1.25, Math.min(2.0, c.rad + (Math.random() - 0.5) * 0.2));
						}
						// 平滑逼近目标(速度/轨道半径连续变化,消除抽搐)
						c.speed += (c.targetSpeed - c.speed) * Math.min(1, dtFrame * 1.2);
						c.rad += (c.targetRad - c.rad) * Math.min(1, dtFrame * 1.2);
						// 角度连续推进(基于全局帧时间,跳帧也不跳步)
						c.angle += c.speed * c.dir * dtFrame;
						// 前后深度:sin(angle)>0 = 环面前方(下半圈,可见);<0 = 背面(被地球挡住)
						const z = Math.sin(c.angle);
						if (z < 0.12) continue; // 背面(含过渡临界)不绘制
						const alpha = Math.min(1, (z - 0.12) / 0.25); // 边缘渐显,不闪跳
						const px = cx + Math.cos(c.angle) * R * c.rad;
						const py = cy + Math.sin(c.angle) * R * c.rad * c.vert;
						// 船身始终保持横向水平(船头朝左/朝右)
						const heading = c.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
						const pulse = Math.abs(Math.sin(now / 700 + c.phase));
						ctx.globalAlpha = alpha;
						drawCraft(px, py, heading, c.size * Math.min(1.1, Math.max(0.55, zoom)), c.kind, c.base, pulse, now);
						ctx.globalAlpha = 1;
					}

					// 悬停检测
					if (mouse.inside) {
						let best = null, bestD = 18;
						for (const p of hitPoints) {
							const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
							if (d < bestD) { bestD = d; best = p.id; }
						}
						if (best !== null) {
							if (hoverRef.current !== best) hoverRef.current(best);
							wrap.style.cursor = "pointer";
						} else {
							if (hoverRef.current !== null) hoverRef.current(null);
							wrap.style.cursor = "default";
						}
					}

					// 右下角 HUD 读数(不会与左下角图例重叠)
					if (now - lastHudTick > 600) {
						lastHudTick = now;
						coord.x = (coord.x + 0.6) % 360;
						coord.y = (coord.y - 0.4 + 180) % 180;
					}
					ctx.textAlign = "right";
					ctx.fillStyle = "rgba(95,124,192,.75)";
					ctx.font = "10px ui-monospace,Consolas,monospace";
					ctx.fillText("LAT " + coord.y.toFixed(1) + "°  LON " + coord.x.toFixed(1) + "°", w - 14, h - 24);
					ctx.fillText("MEMORY NODES " + list.length + " · CRAFTS " + crafts.length, w - 14, h - 10);
					ctx.textAlign = "left";

					// 耗时监测:超过 30ms 则下一帧跳过;持续高负载则逐级降清晰度
					const fcost = performance.now() - frameStart;
					if (fcost > 30) skipNext = true;
					if (fcost > 45) {
						slowCount++;
						if (slowCount > 4 && perfMode === 0) {
							perfMode = 1;
							dprScale = 0.7;
							resize();
							slowCount = 0;
						} else if (slowCount > 8 && perfMode === 1) {
							perfMode = 2;
							dprScale = 0.5;
							resize();
							slowCount = 0;
						}
					} else {
						slowCount = 0;
					}
					} catch (err) {
						// 单帧异常不得中断动画循环,否则场景会卡死成静态画面
						try { console.error("[dsh-memory] frame:", err); } catch {}
					}
					raf = requestAnimationFrame(frame);
				}
				raf = requestAnimationFrame(frame);

				return () => {
					cancelAnimationFrame(raf);
					ro.disconnect();
					wrap.removeEventListener("mousemove", onMouse);
					wrap.removeEventListener("mouseleave", onLeave);
					wrap.removeEventListener("click", onClick);
					wrap.removeEventListener("wheel", onWheel);
					wrap.removeEventListener("pointerdown", onPointerDown);
					wrap.removeEventListener("pointermove", onPointerMove);
					wrap.removeEventListener("pointerup", onPointerUp);
					wrap.removeEventListener("dblclick", onDblClick);
				};
			}, []);

			return jsxs("div", {
				ref: wrapRef,
				className: CSS_NS + "_scene",
				children: [
					jsx("canvas", { ref: canvasRef, className: CSS_NS + "_canvas" }),
					jsx("div", { className: CSS_NS + "_bracket " + CSS_NS + "_brTL" }),
					jsx("div", { className: CSS_NS + "_bracket " + CSS_NS + "_brTR" }),
					jsx("div", { className: CSS_NS + "_bracket " + CSS_NS + "_brBL" }),
					jsx("div", { className: CSS_NS + "_bracket " + CSS_NS + "_brBR" }),
					jsx("div", { className: CSS_NS + "_hudScan" })
				]
			});
		}

		/* ── 样式 ────────────────────────────────────────────────────── */
		const CSS_NS = "mem";
		const css = `
/* 记忆库按钮 + 全屏浮层 */
.${CSS_NS}_memBtn{box-sizing:border-box;min-height:34px;height:auto;flex:none;cursor:pointer;pointer-events:auto!important;position:relative;z-index:2147482000;color:#ffd27c;background:rgba(255,205,120,.12);border:1px solid rgba(255,205,120,.5);border-radius:17px;padding:7px 16px;font:13px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:1px;transition:all .15s;white-space:nowrap;outline:none}
.${CSS_NS}_memBtn:hover{background:rgba(255,205,120,.26);box-shadow:0 0 14px rgba(255,205,120,.4);color:#ffe3a8}
.${CSS_NS}_heroBtn{margin-left:auto;flex:none}
.${CSS_NS}_sessBtn{margin-left:8px;flex:none;transform:translateY(20px)}
.${CSS_NS}_overlay{position:fixed;inset:0;z-index:2147482900;display:flex;flex-direction:column;background:rgba(2,4,10,.78);backdrop-filter:blur(7px);animation:${CSS_NS}_fade .18s ease-out}
.${CSS_NS}_overlay.noStars{background:rgba(2,4,10,0)!important;backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important}
.${CSS_NS}_overlay.passthrough{pointer-events:none!important}
.${CSS_NS}_overlay.passthrough .${CSS_NS}_float{pointer-events:auto!important}
.${CSS_NS}_overlay.passthrough .${CSS_NS}_bubble{pointer-events:auto!important}
.${CSS_NS}_overlay.passthrough .${CSS_NS}_state{pointer-events:auto!important}
@keyframes ${CSS_NS}_fade{from{opacity:0}to{opacity:1}}
.${CSS_NS}_overlay .${CSS_NS}_root{flex:1 1 0;min-height:0}
.${CSS_NS}_root{position:relative;box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;color:#cfe3ff;background:radial-gradient(1200px 700px at 60% -10%,rgba(77,107,254,.10),transparent 60%),#04060d;overflow:hidden;font:13px/1.6 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.${CSS_NS}_root.noStars{background:rgba(4,6,13,0)!important;backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important}
/* 已移除:原先强改输入框宽度/居中的 hack,恢复官方 composer 布局 */
/* 浮层右上角透明控制(仅搜索 + 关闭) */
.${CSS_NS}_float{position:absolute;z-index:9;top:16%;right:36px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.${CSS_NS}_fbtn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;color:#cfe3ff;background:transparent;border:1px solid rgba(0,240,255,.4);border-radius:50%;cursor:pointer;font:14px/1 ui-monospace,Consolas,monospace;transition:all .15s;box-shadow:0 0 10px rgba(0,240,255,.14)}
.${CSS_NS}_fbtn:hover{color:#00f0ff;border-color:#00f0ff;box-shadow:0 0 16px rgba(0,240,255,.45);background:rgba(0,240,255,.08)}
.${CSS_NS}_fbtn[data-kind="close"]{color:#ffb4c2;border-color:rgba(255,92,122,.45)}
.${CSS_NS}_fbtn[data-kind="close"]:hover{color:#ff5c7a;border-color:#ff5c7a;box-shadow:0 0 16px rgba(255,92,122,.4);background:rgba(255,92,122,.08)}
.${CSS_NS}_fbtn[data-kind="blur"]{color:#7d8bb0;border-color:rgba(125,139,176,.4)}
.${CSS_NS}_fbtn[data-kind="blur"]:hover{color:#00f0ff;border-color:#00f0ff;box-shadow:0 0 16px rgba(0,240,255,.45);background:rgba(0,240,255,.08)}
.${CSS_NS}_fbtn[data-kind="blur"].active{color:#00f0ff;border-color:#00f0ff;box-shadow:0 0 16px rgba(0,240,255,.45);background:rgba(0,240,255,.15)}
.${CSS_NS}_fsearchWrap{display:flex;align-items:center;gap:6px}
.${CSS_NS}_fsearch{box-sizing:border-box;width:190px;height:34px;color:#e6f0ff;background:rgba(4,8,16,.35);border:1px solid rgba(0,240,255,.5);border-radius:8px;padding:0 10px;font:12px/1.6 ui-monospace,Consolas,monospace;outline:none;box-shadow:0 0 12px rgba(0,240,255,.22)}
.${CSS_NS}_fsearch:focus{border-color:#00f0ff;box-shadow:0 0 0 1px rgba(0,240,255,.3),0 0 16px rgba(0,240,255,.28)}
.${CSS_NS}_fsearchX{width:30px;height:30px;font-size:12px}
/* 记忆消息气泡(透明背景:会话总结 + 时间 + 打开会话) */
.${CSS_NS}_bubble{position:absolute;z-index:10;top:36%;right:38px;width:min(340px,78%);max-height:60%;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;background:transparent;border:1px solid rgba(0,240,255,.3);border-radius:16px;color:#dfe9ff;overflow-y:auto;box-shadow:0 12px 46px rgba(0,0,0,.4),inset 0 0 34px rgba(0,240,255,.05);animation:${CSS_NS}_pop .18s ease-out;scrollbar-width:thin;scrollbar-color:#2b3654 transparent}
.${CSS_NS}_bubble::-webkit-scrollbar{width:6px}
.${CSS_NS}_bubble::-webkit-scrollbar-thumb{background:#2b3654;border-radius:4px}
.${CSS_NS}_bubble::after{content:"";position:absolute;top:22px;right:-6px;border-width:6px 0 6px 8px;border-style:solid;border-color:transparent;border-left-color:rgba(0,240,255,.38)}
.${CSS_NS}_bubbleHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
.${CSS_NS}_bubbleHead:active{cursor:grabbing}
.${CSS_NS}_bubbleRole{flex:none;font:600 9px/1.5 ui-monospace,Consolas,monospace;letter-spacing:1.5px;color:#00f0ff;text-shadow:0 0 8px rgba(0,240,255,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.${CSS_NS}_bubbleWhen{flex:none;color:#7d8bb0;font:10px/1.5 ui-monospace,Consolas,monospace}
.${CSS_NS}_bubbleBody{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#e8f0ff;text-shadow:0 1px 2px rgba(0,0,0,.85)}
.${CSS_NS}_bubbleFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none}
.${CSS_NS}_bubbleSrc{font:10px/1.6 ui-monospace,Consolas,monospace;color:#8fa9dd;text-shadow:0 1px 2px rgba(0,0,0,.9)}
.${CSS_NS}_openBtn{flex:none;cursor:pointer;color:#00f0ff;background:transparent;border:1px solid rgba(0,240,255,.5);border-radius:8px;padding:6px 14px;font:12px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:1px;transition:all .15s}
.${CSS_NS}_openBtn:hover{border-color:#00f0ff;box-shadow:0 0 14px rgba(0,240,255,.4);background:rgba(0,240,255,.1)}
.${CSS_NS}_bubbleBtns{flex:none;display:flex;align-items:center;gap:8px}
.${CSS_NS}_closeBtn{flex:none;cursor:pointer;color:#ffb4c2;background:transparent;border:1px solid rgba(255,92,122,.5);border-radius:8px;padding:6px 12px;font:12px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:1px;transition:all .15s}
.${CSS_NS}_closeBtn:hover{border-color:#ff5c7a;box-shadow:0 0 14px rgba(255,92,122,.4);background:rgba(255,92,122,.1)}
@keyframes ${CSS_NS}_pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
/* 场景 */
.${CSS_NS}_scene{position:relative;flex:1 1 0;min-height:0;overflow:hidden}
.${CSS_NS}_canvas{position:absolute;inset:0;display:block;cursor:default}
.${CSS_NS}_bracket{position:absolute;width:22px;height:22px;z-index:2;pointer-events:none;opacity:.7}
.${CSS_NS}_brTL{top:12px;left:12px;border-top:2px solid rgba(0,240,255,.65);border-left:2px solid rgba(0,240,255,.65)}
.${CSS_NS}_brTR{top:12px;right:12px;border-top:2px solid rgba(180,140,255,.65);border-right:2px solid rgba(180,140,255,.65)}
.${CSS_NS}_brBL{bottom:12px;left:12px;border-bottom:2px solid rgba(0,240,255,.6);border-left:2px solid rgba(0,240,255,.6)}
.${CSS_NS}_brBR{bottom:12px;right:12px;border-bottom:2px solid rgba(180,140,255,.6);border-right:2px solid rgba(180,140,255,.6)}
.${CSS_NS}_hudScan{position:absolute;z-index:1;top:0;left:0;right:0;bottom:0;pointer-events:none;overflow:hidden;opacity:.4}
.${CSS_NS}_hudScan::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(180deg,transparent 0 40px,rgba(0,240,255,.04) 40px 41px)}
.${CSS_NS}_hudScan::after{content:"";position:absolute;left:0;right:0;height:64px;background:linear-gradient(180deg,transparent,rgba(0,240,255,.045),transparent);animation:${CSS_NS}_sweep 8s linear infinite}
@keyframes ${CSS_NS}_sweep{0%{top:-12%}100%{top:112%}}
.${CSS_NS}_state{position:absolute;z-index:4;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#5f7cc0;font:12px/1.8 ui-monospace,Consolas,monospace;pointer-events:none;background:rgba(4,6,13,.6)}
.${CSS_NS}_stateIcon{font-size:34px;opacity:.5;animation:${CSS_NS}_blink 2.4s ease-in-out infinite}
@keyframes ${CSS_NS}_blink{0%,100%{opacity:.28;text-shadow:0 0 18px rgba(0,240,255,.4)}50%{opacity:.9;text-shadow:0 0 34px rgba(0,240,255,.8)}}
.${CSS_NS}_err{color:#ff5c7a;font-size:12px;max-width:80%;text-align:center}
@media (max-width: 760px){.${CSS_NS}_bubble{right:12px;left:12px;width:auto}}
`;
		const tagId = "dsh-memory/memory.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-memory";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/* ── 字典 ────────────────────────────────────────────────────── */
		const zh = {
			"view.memory": "记忆",
			"head.title": "记忆核心",
			"head.sub": "星际记忆地图 · DEEP MEMORY NETWORK",
			"status.live": "链路正常",
			"status.down": "端点离线",
			"stat.total": "记忆总量",
			"stat.sessions": "来源会话",
			"stat.today": "今日新增",
			"search.ph": "搜索记忆,定位节点…",
			"filter.all": "全部",
			"filter.user": "提问",
			"filter.assistant": "回复",
			"role.user": "QUEST",
			"role.assistant": "REPLY",
			"role.summary": "SESSION",
			"openSession": "打开会话 ↗",
			"bubble.close": "关闭",
			"panel.close": "关闭 ✕",
			"copy": "复制",
			"copied": "已复制",
			"delete": "删除",
			"close": "✕",
			"prev": "◀ 上一段",
			"next": "下一段 ▶",
			"clear": "清空库",
			"refresh": "刷新",
			"loading": "SYNCING MEMORY GRID…",
			"empty": "◈ MEMORY VOID ◈",
			"emptyHint": "记忆库为空。在任意会话中对话后,记忆会自动落到这颗星球上。",
			"noMatch": "◈ 无匹配记忆 ◈",
			"hint": "点击地球表面的光点查看记忆",
			"error": "记忆服务不可用:",
			"session.unknown": "未知会话",
			"nav.hint": "共 {n} 段 · {i}/{m}",
			"confirm.title": "⚠ 确认清空记忆库?",
			"confirm.body1": "这将永久删除全部",
			"confirm.body2": "条记忆,包括其中的会话来源信息,且无法恢复。",
			"confirm.cancel": "取消",
			"confirm.ok": "确认清空"
		};
		const en = {
			"view.memory": "Memory",
			"head.title": "记忆核心",
			"head.sub": "INTERSTELLAR MEMORY MAP",
			"status.live": "LINK OK",
			"status.down": "ENDPOINT OFFLINE",
			"stat.total": "TOTAL",
			"stat.sessions": "SESSIONS",
			"stat.today": "TODAY",
			"search.ph": "Search memory…",
			"filter.all": "All",
			"filter.user": "Questions",
			"filter.assistant": "Replies",
			"role.user": "QUEST",
			"role.assistant": "REPLY",
			"role.summary": "SESSION",
			"openSession": "Open session ↗",
			"bubble.close": "Close",
			"panel.close": "Close ✕",
			"copy": "Copy",
			"copied": "Copied",
			"delete": "Delete",
			"close": "✕",
			"prev": "◀ Prev",
			"next": "Next ▶",
			"clear": "Clear",
			"refresh": "Refresh",
			"loading": "SYNCING MEMORY GRID…",
			"empty": "◈ MEMORY VOID ◈",
			"emptyHint": "The memory bank is empty. Memories land on this planet as you chat.",
			"noMatch": "◈ NO MATCH ◈",
			"hint": "Click a glowing node to read the memory",
			"error": "Memory service unavailable:",
			"session.unknown": "unknown session",
			"nav.hint": "{n} segments · {i}/{m}",
			"confirm.title": "⚠ Clear the memory bank?",
			"confirm.body1": "This permanently deletes all",
			"confirm.body2": "memories including session sources. Not recoverable.",
			"confirm.cancel": "Cancel",
			"confirm.ok": "Clear"
		};

		/* ── 记忆消息气泡(透明背景:会话总结 + 时间 + 打开会话,可拖动)── */
		function DetailOverlay({ t, entry, onClose, onOpen }) {
			if (!entry) return null;
			const [drag, setDrag] = useState({ dx: 0, dy: 0 });
			const dragStartRef = useRef(null); // { px, py, dx, dy } 拖动起点快照
			const onHeadDown = (e) => {
				e.stopPropagation(); // 不触发地球的拖拽平移
				dragStartRef.current = { px: e.clientX, py: e.clientY, dx: drag.dx, dy: drag.dy };
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
			};
			const onHeadMove = (e) => {
				const d = dragStartRef.current;
				if (!d) return;
				e.stopPropagation();
				setDrag({ dx: d.dx + (e.clientX - d.px), dy: d.dy + (e.clientY - d.py) });
			};
			const onHeadUp = (e) => {
				if (!dragStartRef.current) return;
				e.stopPropagation();
				dragStartRef.current = null;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
			};
			const src = entry.sessionTitle || t("session.unknown");
			return jsxs("div", {
				className: CSS_NS + "_bubble",
				style: { transform: "translate(" + drag.dx + "px," + drag.dy + "px)" },
				children: [
					jsxs("div", {
						className: CSS_NS + "_bubbleHead",
						onPointerDown: onHeadDown,
						onPointerMove: onHeadMove,
						onPointerUp: onHeadUp,
						onPointerCancel: onHeadUp,
						children: [
							jsx("span", { className: CSS_NS + "_bubbleRole", children: "◈ " + ellipsis(src, 20) }),
							jsx("span", { className: CSS_NS + "_bubbleWhen", children: fmtTime(entry.time) })
						]
					}),
					jsx("div", { className: CSS_NS + "_bubbleBody", children: entry.text }),
					jsxs("div", {
						className: CSS_NS + "_bubbleFoot",
						children: [
							jsx("span", { className: CSS_NS + "_bubbleSrc", children: String(entry.sessionId).slice(0, 10) + " · " + (entry.role === "summary" ? t("role.summary") : entry.role === "user" ? t("role.user") : t("role.assistant")) }),
							jsxs("div", {
								className: CSS_NS + "_bubbleBtns",
								children: [
									jsx("button", { type: "button", className: CSS_NS + "_openBtn", onClick: onOpen, children: t("openSession") }),
									jsx("button", { type: "button", className: CSS_NS + "_closeBtn", onClick: onClose, children: t("bubble.close") })
								]
							})
						]
					})
				]
			});
		}

		/* ── 记忆浮层面板 ───────────────────────────────────────────── */
		function MemoryPanel({ t, sessions, onClose }) {
			const [entries, setEntries] = useState(null);
			const [error, setError] = useState("");
			const [query, setQuery] = useState("");
			const [busy, setBusy] = useState(false);
			const [searchOpen, setSearchOpen] = useState(false);
			const [selectedId, setSelectedId] = useState(null);
			const [hideStars, setHideStars] = useState(() => getSetting(SETTINGS_KEYS.hideStars, true));
			const [closeOnBlur, setCloseOnBlur] = useState(() => getSetting(SETTINGS_KEYS.closeOnBlur, false));
			const [hoverId, setHoverId] = useState(null);
			const refreshTok = useRef(0);

			/* 浮层打开:锁定页面滚动,关闭时恢复 */
			useEffect(() => {
				const prev = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				return () => { document.body.style.overflow = prev; };
			}, []);

			const refresh = useCallback(async () => {
				const tok = ++refreshTok.current;
				try {
					setBusy(true);
					const listData = await api("list", { limit: 300 });
					if (tok !== refreshTok.current) return;
					setEntries(listData.entries || []);
					setError("");
				} catch (err) {
					if (tok !== refreshTok.current) return;
					setError(err && err.message ? err.message : String(err));
				} finally {
					if (tok === refreshTok.current) setBusy(false);
				}
			}, []);

			useEffect(() => { refresh(); }, [refresh]);
			useEffect(() => {
				const handle = setInterval(() => refresh(), 15000);
				return () => clearInterval(handle);
			}, [refresh]);

			// 即时本地过滤(仅搜索)
			const all = entries || [];
			const list = useMemo(() => {
				const q = query.trim().toLowerCase();
				if (q === "") return all;
				return all.filter((e) => e.text.toLowerCase().includes(q) || String(e.sessionTitle || "").toLowerCase().includes(q));
			}, [all, query]);
			const segIndex = list.findIndex((e) => e.id === selectedId);
			const selected = segIndex >= 0 ? list[segIndex] : null;

			useEffect(() => {
				const onKey = (e) => {
					if (e.key === "Escape") {
						if (searchOpen) { setSearchOpen(false); setQuery(""); }
						else if (selectedId) setSelectedId(null);
						else onClose();
					}
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [searchOpen, selectedId]);

			return createPortal(jsxs("div", {
				className: CSS_NS + "_overlay" + (hideStars ? " noStars" : "") + (closeOnBlur ? " passthrough" : ""),
				children: [
					jsxs("div", {
						className: CSS_NS + "_root" + (hideStars ? " noStars" : ""),
						children: [
							error !== "" && jsxs("div", {
								className: CSS_NS + "_state",
								children: [
									jsx("div", { className: CSS_NS + "_stateIcon", children: "⚠" }),
									jsxs("div", { className: CSS_NS + "_err", children: [t("error"), " ", error] })
								]
							}),
							error === "" && list.length === 0 && jsxs("div", {
								className: CSS_NS + "_state",
								children: [
									jsx("div", { className: CSS_NS + "_stateIcon", children: "◈" }),
									jsx("div", { children: entries === null ? t("loading") : (all.length === 0 ? t("empty") : t("noMatch")) }),
									jsx("div", { children: entries === null ? "" : (all.length === 0 ? t("emptyHint") : "") })
								]
							}),
							jsx(EarthScene, {
								t,
								entries: list,
								selectedId,
								hoverId,
								onHover: setHoverId,
								onPick: (id) => setSelectedId((cur) => (cur === id ? null : id)),
								hideStars
							}),
							jsxs("div", {
								className: CSS_NS + "_float",
								children: [
									searchOpen
										? jsxs("div", {
											className: CSS_NS + "_fsearchWrap",
											children: [
												jsx("input", {
													className: CSS_NS + "_fsearch",
													value: query,
													autoFocus: true,
													placeholder: t("search.ph"),
													onChange: (e) => { setQuery(e.target.value); if (selectedId) setSelectedId(null); },
													onKeyDown: (e) => { if (e.key === "Enter") e.preventDefault(); }
												}),
												jsx("button", { type: "button", className: CSS_NS + "_fbtn " + CSS_NS + "_fsearchX", title: "关闭搜索", onClick: () => { setSearchOpen(false); setQuery(""); }, children: "✕" })
											]
										})
										: jsx("button", { type: "button", className: CSS_NS + "_fbtn", title: t("search.ph"), onClick: () => setSearchOpen(true), children: "🔍" }),
									jsx("button", { type: "button", className: CSS_NS + "_fbtn", "data-kind": "close", title: t("panel.close"), onClick: onClose, children: "✕" }),
									jsx("button", { type: "button", className: CSS_NS + "_fbtn" + (closeOnBlur ? " active" : ""), "data-kind": "blur", title: closeOnBlur ? "外部可操作: 已开启 (点击记忆库以外区域可正常操作,记忆库保持打开)" : "外部可操作: 已关闭 (点击开启)", onClick: () => { const next = !closeOnBlur; setCloseOnBlur(next); setSetting(SETTINGS_KEYS.closeOnBlur, next); }, children: "🖱" }),
									jsx("button", { type: "button", className: CSS_NS + "_fbtn" + (!hideStars ? " active" : ""), "data-kind": "blur", title: hideStars ? "星空背景: 已隐藏 (点击显示)" : "星空背景: 已显示 (点击隐藏)", onClick: () => { const next = !hideStars; setHideStars(next); setSetting(SETTINGS_KEYS.hideStars, next); }, children: "✦" })
								]
							}),
							jsx(DetailOverlay, {
								t,
								entry: selected,
								onClose: () => setSelectedId(null),
								onOpen: () => {
									// 安全跳转:仅当该会话确实存在于会话列表时才 open,绝不误建新会话;
									// 跳转前先关闭记忆浮层,避免残留盖住新界面。
									if (!selected || !sessions) return;
									let known = false;
									try {
										const snap = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot() : null;
										if (snap && snap.byId && snap.byId[selected.sessionId]) known = true;
									} catch {}
									if (!known) {
										setError("该会话不在当前会话列表中,无法直接跳转;可切换到对应工作区后从左侧会话列表打开。");
										return;
									}
									setSelectedId(null);
									onClose();
									try { sessions.open(selected.sessionId); } catch {}
								}
							})
						]
					})
				]
			}), document.body);
		}


	
		/* ── 浮层宿主:常驻 document.body 的 React 根,监听全局打开事件 ── */
		/* 同时用 DOM observer 往 hero 行注入「记忆库」按钮(不碰 single slot) */
		function MemoryHost({ t, sessions }) {
			const [open, setOpen] = useState(false);
			useEffect(() => {
				const fn = () => setOpen(true);
				window.addEventListener("dsh-memory-open", fn);
				return () => window.removeEventListener("dsh-memory-open", fn);
			}, []);

			/* DOM 注入:hero 行 + 会话 header 行同时注入「记忆库」按钮 */
			useEffect(() => {
				const HERO_ID = "dsh-memory-hero-btn";
				const SESS_ID = "dsh-memory-session-btn";
				function makeBtn(id, extraCls) {
					const b = document.createElement("button");
					b.type = "button";
					b.id = id;
					b.className = CSS_NS + "_memBtn" + (extraCls ? " " + extraCls : "");
					b.textContent = "◈ 记忆库";
					b.addEventListener("click", () => {
						try { window.dispatchEvent(new Event("dsh-memory-open")); } catch {}
					});
					return b;
				}
				function injectBtns() {
					/* hero 行 */
					if (!document.getElementById(HERO_ID)) {
						const row = document.querySelector(".wSkVaW_heroWorkspaceRow");
						if (row) row.appendChild(makeBtn(HERO_ID, CSS_NS + "_heroBtn"));
					}
					/* 会话 header actions 行 */
					if (!document.getElementById(SESS_ID)) {
						const box = document.querySelector(".wSkVaW_headerActions");
						if (box) box.appendChild(makeBtn(SESS_ID, CSS_NS + "_sessBtn"));
					}
				}
				injectBtns();
				const mo = new MutationObserver(injectBtns);
				mo.observe(document.body, { childList: true, subtree: true });
				return () => mo.disconnect();
			}, []);

			return open ? jsx(MemoryPanel, { t, sessions, onClose: () => setOpen(false) }) : null;
		}

		/* ── 错误边界:崩溃时显示错误信息而非白屏 ───────────────────── */
		const ErrorBoundary = (() => {
			class EB extends react.Component {
				constructor(props) {
					super(props);
					this.state = { error: null };
				}
				static getDerivedStateFromError(error) {
					return { error };
				}
				componentDidCatch(error, info) {
					try {
						console.error("[dsh-memory] render crashed:", error, info);
					} catch {}
				}
				render() {
					if (this.state.error != null) {
						return jsxs("div", {
							style: { position: "absolute", inset: 0, zIndex: 9999, background: "#05070f", color: "#ff8a9a", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, boxSizing: "border-box", font: "12px/1.7 monospace", whiteSpace: "pre-wrap" },
							children: ["[dsh-memory] 渲染出错:\n" + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)]
						});
					}
					return this.props.children;
				}
			}
			return EB;
		})();

		/* ── 插件体 ─────────────────────────────────────────────────── */
		const inject = ["locale", "sessions"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-memory: dict");
			const t = ctx.locale.bind(NS);

			// 常驻浮层宿主 + hero 按钮:独立挂载于 document.body,完全不碰输入框/composer 布局
			ctx.effect(() => {
				const hostDiv = document.createElement("div");
				hostDiv.setAttribute("data-dsh-memory-host", "1");
				hostDiv.style.display = "contents";
				document.body.appendChild(hostDiv);
				let root;
				try {
					const rdc = require("react-dom/client");
					const createRootF = rdc.createRoot || (rdc.default && rdc.default.createRoot);
					root = createRootF(hostDiv);
					root.render(jsx(ErrorBoundary, { children: jsx(MemoryHost, { t, sessions: ctx.sessions }) }));
				} catch (err) {
					try { console.error("[dsh-memory] host mount failed:", err); } catch {}
				}
				const uninstall = () => {};
				return () => {
					try { uninstall(); } catch {}
					if (root) { try { root.unmount(); } catch {} }
					try { hostDiv.remove(); } catch {}
				};
			}, "dsh-memory: host");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});