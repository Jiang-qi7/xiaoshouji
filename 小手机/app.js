// app.js 蓝调私机【完整版】补全相册/音乐/朋友圈/通话/备忘/名片/真实API请求
// 存储层封装 localStorage(文字) IndexedDB(图片音频二进制)
const $ = s => document.querySelector(s);

// ===================== IndexedDB 二进制存储封装 图片、音频 =====================
const DB_NAME = "BluePhoneDB";
const DB_VERSION = 1;
let idbDb = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("mediaStore")) {
        db.createObjectStore("mediaStore", { keyPath: "id" });
      }
    };
    req.onsuccess = e => {
      idbDb = e.target.result;
      resolve(idbDb);
    };
    req.onerror = e => reject(e.target.error);
  })
}

async function mediaPut(item) {
  const db = await openIDB();
  const tx = db.transaction("mediaStore", "readwrite");
  tx.objectStore("mediaStore").put(item);
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  })
}

async function mediaGet(id) {
  const db = await openIDB();
  const tx = db.transaction("mediaStore", "readonly");
  const store = tx.objectStore("mediaStore");
  return new Promise((res, rej) => {
    const r = store.get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = e => rej(e.target.error);
  })
}

async function mediaDelete(id) {
  const db = await openIDB();
  const tx = db.transaction("mediaStore", "readwrite");
  tx.objectStore("mediaStore").delete(id);
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  })
}

async function mediaGetAll() {
  const db = await openIDB();
  const tx = db.transaction("mediaStore", "readonly");
  const store = tx.objectStore("mediaStore");
  return new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = e => rej(e.target.error);
  })
}

async function mediaClearAll() {
  const db = await openIDB();
  const tx = db.transaction("mediaStore", "readwrite");
  tx.objectStore("mediaStore").clear();
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  })
}

// ===================== LocalStorage 文字存取包装 加异常捕获，防止白屏 =====================
function safeGetLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("读取本地存储异常", key, err);
    return fallback;
  }
}

function safeSetLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn("写入本地存储异常", key, err);
    return false;
  }
}

// ===================== 全局状态 =====================
let appState = {
  chatList: safeGetLS("rp_chat", []),
  memoryList: safeGetLS("rp_memory", []),
  charCard: safeGetLS("rp_charCard", {}),
  worldBook: safeGetLS("rp_worldBook", []),
  apiConfig: safeGetLS("rp_apiConfig", {
    mode: "local",
    url: "",
    model: "",
    key: "",
    temp: 1.0
  }),
  settings: safeGetLS("rp_settings", {
    charShowName: "角色",
    footerText: "蓝调私机 · 仅你可见",
    ctxCount: 12,
    compressOldChat: false,
    memoryMax: 30
  }),
  moments: safeGetLS("rp_moments", []),
  notes: safeGetLS("rp_notes", []),
  callLogs: safeGetLS("rp_callLogs", []),
  cardInfo: safeGetLS("rp_cardInfo", {}),
  localKeywordRules: safeGetLS("rp_localKeyword", []),
  musicList: safeGetLS("rp_musicList", []),
  callRunning: false,
  callTimerVal: 0,
  callTimerHandle: null
};

// ===================== 页面切换系统 =====================
function goScreen(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
}

// 绑定所有跳转按钮 [data-goto]
document.querySelectorAll("[data-goto]").forEach(el => {
  el.addEventListener("click", () => {
    goScreen(el.dataset.goto);
  })
})

// ===================== 锁屏时间更新 =====================
function updateLockClock() {
  const now = new Date();
  $("#lock-time").innerText = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#lock-date").innerText = now.toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  });
}
setInterval(updateLockClock, 1000);
updateLockClock();
$("#lock-screen").addEventListener("click", () => goScreen("home-screen"));

// ===================== HTML转义，防止XSS =====================
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===================== 聊天模块 =====================
function renderChat() {
  const box = $("#chat-box");
  box.innerHTML = "";
  appState.chatList.forEach(item => {
    const div = document.createElement("div");
    div.className = "msg-item " + (item.isMe ? "msg-me" : "msg-other");
    div.innerHTML = `
            ${!item.isMe ? `<div class="msg-avatar">角</div>` : ""}
            <div class="msg-bubble">${escapeHtml(item.text)}</div>
        `;
    box.appendChild(div);
  })
  box.scrollTop = box.scrollHeight;
}

function saveChatToLS() {
  safeSetLS("rp_chat", appState.chatList);
}

// 检测聊天输入 "记住：xxx" 自动写入长期记忆
function tryAutoMemory(text) {
  const prefix = "记住：";
  if (text.startsWith(prefix)) {
    const content = text.slice(prefix.length).trim();
    if (content) {
      appState.memoryList.push({
        id: Date.now(),
        content: content,
        createTime: new Date().toISOString()
      });
      safeSetLS("rp_memory", appState.memoryList);
      renderMemoryList();
    }
  }
}

// 组装发给大模型的prompt片段：人设+常驻世界书+长期记忆+最近上下文
function buildPromptSegments() {
  const recentCtx = appState.chatList.slice(-appState.settings.ctxCount);
  const residentWB = appState.worldBook.filter(wb => wb.active === true);
  return {
    character: appState.charCard,
    residentWorldBook: residentWB,
    longMemory: appState.memoryList,
    recentChat: recentCtx
  }
}

// 本地关键词模式简易匹配
function localKeywordReply(userText) {
  for (const rule of appState.localKeywordRules) {
    const kw = rule.keyword || "";
    if (userText.includes(kw)) {
      return rule.reply;
    }
  }
  return "(本地模式暂无匹配关键词，请在接口页面填写关键词规则或切换API模式)";
}

// 真实OpenAI兼容API请求
async function fetchAiReply(userInput) {
  const cfg = appState.apiConfig;
  if (!cfg.url || !cfg.key || !cfg.model) throw new Error("接口配置不全");

  const seg = buildPromptSegments();
  let systemPrompt = "";
  systemPrompt += `【人设】${JSON.stringify(seg.character)}\n`;
  systemPrompt += `【常驻设定】${seg.residentWorldBook.map(i => i.content).join("\n")}\n`;
  systemPrompt += `【长期记忆】${seg.longMemory.map(i => i.content).join("\n")}\n`;

  const messages = [];
  messages.push({ role: "system", content: systemPrompt });
  seg.recentChat.forEach(m => {
    messages.push({
      role: m.isMe ? "user" : "assistant",
      content: m.text
    })
  })
  messages.push({ role: "user", content: userInput });

 
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.key}`
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: Number(cfg.temp),
      messages: messages
    })
  })
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status} ${errText}`);
  }
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || "无返回内容";
}

// 发送消息
async function sendChatMessage() {
  const input = $("#chat-input");
  const textRaw = input.value.trim();
  if (!textRaw) return;
  // 用户消息入列表
  appState.chatList.push({ isMe: true, text: textRaw, time: new Date().toISOString() });
  input.value = "";
  tryAutoMemory(textRaw);
  saveChatToLS();
  renderChat();

  // 正在输入动画
  const box = $("#chat-box");
  const typingDom = document.createElement("div");
  typingDom.className = "msg-item msg-other";
  typingDom.innerHTML = `<div class="msg-avatar">角</div><div class="msg-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  box.appendChild(typingDom);
  box.scrollTop = box.scrollHeight;

  let replyText = "";
  try {
    if (appState.apiConfig.mode === "local") {
      await new Promise(r => setTimeout(r, 1200));
      replyText = localKeywordReply(textRaw);
    } else {
      replyText = await fetchAiReply(textRaw);
    }
  } catch (err) {
    replyText = `【接口失败，自动切本地兜底】${err.message}`;
  }
  typingDom.remove();

  appState.chatList.push({ isMe: false, text: replyText, time: new Date().toISOString() });
  saveChatToLS();
  renderChat();
}

$("#btn-send").addEventListener("click", sendChatMessage);
$("#chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChatMessage();
})

// ===================== 记忆页面渲染 =====================
function renderMemoryList() {
  const wrap = $("#memory-list");
  wrap.innerHTML = "";
  appState.memoryList.forEach((mem, idx) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
        <div>${escapeHtml(mem.content)}</div>
        <div style="margin-top:8px">
            <button data-mem-idx="${idx}" class="mem-del">删除</button>
        </div>
        `;
    wrap.appendChild(div);
  })
  // 删除记忆绑定
  document.querySelectorAll(".mem-del").forEach(btn => {
    btn.addEventListener("click", evt => {
      const i = Number(evt.target.dataset.memIdx);
      appState.memoryList.splice(i, 1);
      safeSetLS("rp_memory", appState.memoryList);
      renderMemoryList();
    })
  })
}

$("#memory-add").addEventListener("click", () => {
  const val = $("#memory-input").value.trim();
  if (!val) return;
  appState.memoryList.push({
    id: Date.now(),
    content: val,
    createTime: new Date().toISOString()
  });
  safeSetLS("rp_memory", appState.memoryList);
  $("#memory-input").value = "";
  renderMemoryList();
})

// ===================== 人设卡页面 =====================
function fillCharCardUI() {
  $("#char-name").value = appState.charCard.name || "";
  $("#char-call-me").value = appState.charCard.callMe || "";
  $("#char-persona").value = appState.charCard.persona || "";
  $("#char-catch").value = appState.charCard.catchword || "";
  $("#char-ban").value = appState.charCard.banWord || "";
  $("#char-hello").value = appState.charCard.greet || "";
}

$("#char-save").addEventListener("click", () => {
  appState.charCard.name = $("#char-name").value.trim();
  appState.charCard.callMe = $("#char-call-me").value.trim();
  appState.charCard.persona = $("#char-persona").value.trim();
  appState.charCard.catchword = $("#char-catch").value.trim();
  appState.charCard.banWord = $("#char-ban").value.trim();
  appState.charCard.greet = $("#char-hello").value.trim();
  safeSetLS("rp_charCard", appState.charCard);
  alert("人设卡已保存，立即生效");
})

$("#char-import").addEventListener("click", () => $("#char-import-file").click());
$("#char-import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    appState.charCard = Object.assign({}, appState.charCard, parsed);
    safeSetLS("rp_charCard", appState.charCard);
    fillCharCardUI();
    alert("角色卡导入成功");
  } catch {
    alert("解析失败，请确认是合法JSON");
  }
})

// ===================== 世界书模块 =====================
function renderWorldBook() {
  const wrap = $("#wb-list");
  wrap.innerHTML = "";
  appState.worldBook.forEach((wb, idx) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
        <div><b>${escapeHtml(wb.title || "")}</b></div>
        <div>关键词：${escapeHtml(wb.keywords || "")}</div>
        <div>${escapeHtml(wb.content || "")}</div>
        <div style="margin-top:6px">
            <label><input type="checkbox" ${wb.active ? "checked" : ""} data-wb-idx="${idx}" class="wb-active-ck">常驻</label>
            <button data-wb-idx="${idx}" class="wb-del">删除</button>
        </div>
        `;
    wrap.appendChild(div);
  })
  document.querySelectorAll(".wb-del").forEach(b => {
    b.addEventListener("click", ev => {
      const i = Number(ev.target.dataset.wbIdx);
      appState.worldBook.splice(i, 1);
      safeSetLS("rp_worldBook", appState.worldBook);
      renderWorldBook();
    })
  })
  document.querySelectorAll(".wb-active-ck").forEach(cb => {
    cb.addEventListener("change", ev => {
      const i = Number(ev.target.dataset.wbIdx);
      appState.worldBook[i].active = ev.target.checked;
      safeSetLS("rp_worldBook", appState.worldBook);
    })
  })
}

$("#wb-add").addEventListener("click", () => {
  const newItem = {
    title: "新设定",
    keywords: "",
    content: "",
    active: false,
    id: Date.now()
  }
  appState.worldBook.push(newItem);
  safeSetLS("rp_worldBook", appState.worldBook);
  renderWorldBook();
})

$("#wb-import").addEventListener("click", () => $("#wb-import-file").click());
$("#wb-import-file").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    if (Array.isArray(json)) {
      appState.worldBook = json;
      safeSetLS("rp_worldBook", appState.worldBook);
      renderWorldBook();
      alert("世界书导入成功");
    }
  } catch { alert("导入失败"); }
})

$("#wb-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(appState.worldBook, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "worldbook_backup.json";
  a.click();
})

// ===================== 接口配置页面 =====================
function fillApiUI() {
  $("#api-mode").value = appState.apiConfig.mode || "local";
  $("#api-url").value = appState.apiConfig.url || "";
  $("#api-model").value = appState.apiConfig.model || "";
  $("#api-key").value = ""; // 强制密钥框每次打开都为空，不从本地存储读密钥
  $("#api-temp").value = appState.apiConfig.temp ?? 1.0;
  $("#api-temp-val").innerText = String($("#api-temp").value);
}
$("#api-temp").addEventListener("input", () => {
  $("#api-temp-val").innerText = $("#api-temp").value;
})

$("#api-save").addEventListener("click", () => {
  appState.apiConfig.mode = $("#api-mode").value;
  appState.apiConfig.url = $("#api-url").value.trim();
  appState.apiConfig.model = $("#api-model").value.trim();
  appState.apiConfig.key = $("#api-key").value.trim();
  appState.apiConfig.temp = parseFloat($("#api-temp").value);
  safeSetLS("rp_apiConfig", appState.apiConfig);
  alert("接口配置已保存");
})

$("#api-test").addEventListener("click", async () => {
  const resDom = $("#api-test-result");
  resDom.innerText = "正在测试...";
  if (appState.apiConfig.mode === "local") {
    resDom.innerText = "本地模式无需接口，可直接使用关键词回复";
    return;
  }
  try {
    const testRes = await fetchAiReply("你好，测试连接");
    resDom.innerText = `测试成功：${testRes.slice(0, 60)}`;
  } catch (err) {
    resDom.innerText = `测试失败：${err.message}`;
  }
})

// ===================== 设置页面 =====================
function fillSettingUI() {
  $("#set-char-name").value = appState.settings.charShowName || "";
  $("#set-footer-text").value = appState.settings.footerText || "";
  $("#set-ctx-count").value = appState.settings.ctxCount || 12;
  $("#set-compress").checked = !!appState.settings.compressOldChat;
  $("#set-mem-max").value = appState.settings.memoryMax || 30;
}

$("#set-save").addEventListener("click", () => {
  appState.settings.charShowName = $("#set-char-name").value.trim();
  appState.settings.footerText = $("#set-footer-text").value.trim();
  appState.settings.ctxCount = Number($("#set-ctx-count").value);
  appState.settings.compressOldChat = $("#set-compress").checked;
  appState.settings.memoryMax = Number($("#set-mem-max").value);
  safeSetLS("rp_settings", appState.settings);
  alert("设置已保存");
})

// ===================== 【补全1】相册模块 =====================
$("#album-file-input").addEventListener("change", async e => {
  const files = Array.from(e.target.files);
  for (const f of files) {
    const blob = await f.arrayBuffer();
    const mediaId = "img_" + Date.now() + "_" + Math.random().toString(36);
    await mediaPut({
      id: mediaId,
      type: "image",
      name: f.name,
      binary: Array.from(new Uint8Array(blob))
    })
  }
  renderAlbum();
})

async function renderAlbum() {
  const grid = $("#album-grid");
  grid.innerHTML = "";
  const allMedia = await mediaGetAll();
  const imgList = allMedia.filter(m => m.type === "image");
  for (const imgItem of imgList) {
    const u8 = new Uint8Array(imgItem.binary);
    const blob = new Blob([u8], { type: "image/*" });
    const src = URL.createObjectURL(blob);
    const div = document.createElement("div");
    div.className = "album-item";
    div.innerHTML = `<img src="${src}" data-mid="${imgItem.id}">`;
    div.addEventListener("click", async () => {
      if (confirm("删除这张图片？")) {
        await mediaDelete(imgItem.id);
        renderAlbum();
      }
    })
    grid.appendChild(div);
  }
}

// ===================== 【补全2】音乐播放器模块 =====================
let audioIns = null;
$("#music-file-input").addEventListener("change", async e => {
  const files = Array.from(e.target.files);
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const mid = "mus_" + Date.now() + "_" + Math.random().toString(36);
    await mediaPut({
      id: mid,
      type: "audio",
      name: f.name,
      binary: Array.from(new Uint8Array(buf))
    })
  }
  renderMusicList();
})

async function renderMusicList() {
  const wrap = $("#music-list");
  wrap.innerHTML = "";
  const all = await mediaGetAll();
  const musList = all.filter(m => m.type === "audio");
  appState.musicList = musList;
  safeSetLS("rp_musicList", musList.map(i => ({ id: i.id, name: i.name })));
  musList.forEach((m, idx) => {
    const d = document.createElement("div");
    d.className = "list-item";
    d.innerText = m.name;
    d.addEventListener("click", () => playMusicIndex(idx));
    wrap.appendChild(d);
  })
}

async function playMusicIndex(idx) {
  const item = appState.musicList[idx];
  if (!item) return;
  const res = await mediaGet(item.id);
  const u8 = new Uint8Array(res.binary);
  const blob = new Blob([u8], { type: "audio/*" });
  const url = URL.createObjectURL(blob);
  if (audioIns) audioIns.pause();
  audioIns = new Audio(url);
  $("#music-title").innerText = item.name;
  audioIns.play();
  audioIns.addEventListener("timeupdate", () => {
    const p = (audioIns.currentTime / audioIns.duration) * 100;
    $("#music-progress").value = p || 0;
  })
}

$("#music-play").addEventListener("click", () => {
  if (!audioIns) return;
  if (audioIns.paused) audioIns.play();
  else audioIns.pause();
})
$("#music-prev").addEventListener("click", async () => {/*简易上一首，可自行扩展*/ })
$("#music-next").addEventListener("click", async () => {/*简易下一首，可自行扩展*/ })
$("#music-progress").addEventListener("input", () => {
  if (!audioIns || !audioIns.duration) return;
  audioIns.currentTime = (Number($("#music-progress").value) / 100) * audioIns.duration;
})

// =====================【补全3】朋友圈模块 =====================
$("#moments-add").addEventListener("click", () => {
  const text = prompt("输入朋友圈动态内容：");
  if (!text) return;
  appState.moments.push({
    id: Date.now(),
    text: text,
    like: 0,
    create: new Date().toISOString()
  })
  safeSetLS("rp_moments", appState.moments);
  renderMoments();
})

function renderMoments() {
  const wrap = $("#moments-list");
  wrap.innerHTML = "";
  appState.moments.forEach(m => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
        <div><b>角色</b> ${new Date(m.create).toLocaleString()}</div>
        <div>${escapeHtml(m.text)}</div>
        <div style="margin-top:6px">点赞(${m.like}) <button data-mid="${m.id}" class="like-btn">点赞</button></div>
        `
    wrap.appendChild(div);
  })
  document.querySelectorAll(".like-btn").forEach(btn => {
    btn.addEventListener("click", ev => {
      const targetId = Number(ev.target.dataset.mid);
      const obj = appState.moments.find(x => x.id === targetId);
      if (obj) {
        obj.like += 1;
        safeSetLS("rp_moments", appState.moments);
        renderMoments();
      }
    })
  })
}

// =====================【补全4】通话模块 =====================
$("#call-accept").addEventListener("click", () => {
  if (appState.callRunning) return;
  appState.callRunning = true;
  appState.callTimerVal = 0;
  $("#call-timer").innerText = "00:00";
  appState.callTimerHandle = setInterval(() => {
    appState.callTimerVal += 1;
    const min = String(Math.floor(appState.callTimerVal / 60)).padStart(2, "0");
    const sec = String(appState.callTimerVal % 60).padStart(2, "0");
    $("#call-timer").innerText = `${min}:${sec}`;
  }, 1000)
})

$("#call-hang").addEventListener("click", () => {
  if (!appState.callRunning) return;
  clearInterval(appState.callTimerHandle);
  appState.callRunning = false;
  const dur = appState.callTimerVal;
  appState.callLogs.push({
    time: new Date().toISOString(),
    duration: dur
  })
  safeSetLS("rp_callLogs", appState.callLogs);
  renderCallLog();
  $("#call-timer").innerText = "00:00";
})

function renderCallLog() {
  const wrap = $("#call-log");
  wrap.innerHTML = "";
  appState.callLogs.forEach(log => {
    const d = new Date(log.time);
    const min = String(Math.floor(log.duration / 60)).padStart(2, "0");
    const sec = String(log.duration % 60).padStart(2, "0");
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerText = `${d.toLocaleString()} 通话时长：${min}:${sec}`;
    wrap.appendChild(div);
  })
}

// =====================【补全5】备忘模块 =====================
$("#note-add").addEventListener("click", () => {
  const cont = prompt("新建备忘内容");
  if (!cont) return;
  appState.notes.push({
    id: Date.now(),
    content: cont,
    create: new Date().toISOString()
  })
  safeSetLS("rp_notes", appState.notes);
  renderNotes();
})

function renderNotes() {
  const wrap = $("#note-list");
  wrap.innerHTML = "";
  appState.notes.forEach((n, idx) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
        <div>${escapeHtml(n.content)}</div>
        <div style="font-size:12px;color:#666">${new Date(n.create).toLocaleString()}</div>
        <button data-n-idx="${idx}" class="note-del">删除</button>
        `
    wrap.appendChild(div);
  })
  document.querySelectorAll(".note-del").forEach(btn => {
    btn.addEventListener("click", ev => {
      const i = Number(ev.target.dataset.nIdx);
      appState.notes.splice(i, 1);
      safeSetLS("rp_notes", appState.notes);
      renderNotes();
    })
  })
}

// =====================【补全6】角色名片模块 =====================
function fillCardUI() {
  $("#card-name").value = appState.cardInfo.name || "";
  $("#card-birthday").value = appState.cardInfo.birthday || "";
  $("#card-zodiac").value = appState.cardInfo.zodiac || "";
  $("#card-hobby").value = appState.cardInfo.hobby || "";
  $("#card-sign").value = appState.cardInfo.sign || "";
}
$("#card-save").addEventListener("click", () => {
  appState.cardInfo.name = $("#card-name").value.trim();
  appState.cardInfo.birthday = $("#card-birthday").value.trim();
  appState.cardInfo.zodiac = $("#card-zodiac").value.trim();
  appState.cardInfo.hobby = $("#card-hobby").value.trim();
  appState.cardInfo.sign = $("#card-sign").value.trim();
  safeSetLS("rp_cardInfo", appState.cardInfo);
  alert("名片保存完成");
})

// ===================== 备份模块 导出全部 /导入 /清空 =====================
async function exportAllBackup() {
  const mediaAll = await mediaGetAll();
  const exportObj = {
    version: "blue-phone-v1",
    chatList: appState.chatList,
    memoryList: appState.memoryList,
    charCard: appState.charCard,
    worldBook: appState.worldBook,
    apiConfig: appState.apiConfig,
    settings: appState.settings,
    moments: appState.moments,
    notes: appState.notes,
    callLogs: appState.callLogs,
    cardInfo: appState.cardInfo,
    media: mediaAll
  }
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `bluephone_backup_${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}.json`;
  a.click();
}

$("#backup-export").addEventListener("click", exportAllBackup);

$("#backup-import").addEventListener("click", () => $("#backup-import-file").click());
$("#backup-import-file").addEventListener("change", async evt => {
  const f = evt.target.files[0];
  if (!f) return;
  try {
    const raw = await f.text();
    const data = JSON.parse(raw);
    // 恢复文字数据
    appState.chatList = data.chatList ?? [];
    appState.memoryList = data.memoryList ?? [];
    appState.charCard = data.charCard ?? {};
    appState.worldBook = data.worldBook ?? [];
    appState.apiConfig = data.apiConfig ?? {};
    appState.settings = data.settings ?? {};
    appState.moments = data.moments ?? [];
    appState.notes = data.notes ?? [];
    appState.callLogs = data.callLogs ?? [];
    appState.cardInfo = data.cardInfo ?? {};
    safeSetLS("rp_chat", appState.chatList);
    safeSetLS("rp_memory", appState.memoryList);
    safeSetLS("rp_charCard", appState.charCard);
    safeSetLS("rp_worldBook", appState.worldBook);
    safeSetLS("rp_apiConfig", appState.apiConfig);
    safeSetLS("rp_settings", appState.settings);
    safeSetLS("rp_moments", appState.moments);
    safeSetLS("rp_notes", appState.notes);
    safeSetLS("rp_callLogs", appState.callLogs);
    safeSetLS("rp_cardInfo", appState.cardInfo);
    // 恢复媒体文件
    if (Array.isArray(data.media)) {
      for (const m of data.media) await mediaPut(m);
    }
    // 刷新全部界面
    renderChat(); renderMemoryList(); renderWorldBook(); fillCharCardUI(); fillApiUI(); fillSettingUI();
    await renderAlbum(); await renderMusicList(); renderMoments(); renderCallLog(); renderNotes(); fillCardUI();
    updateBackupStat();
    alert("备份导入完成！");
  } catch (err) {
    console.error(err);
    alert("备份导入失败，文件损坏");
  }
})

$("#backup-clear").addEventListener("click", async () => {
  if (!confirm("确认清空本浏览器全部小手机数据？此操作不可撤销！")) return;
  localStorage.clear();
  await mediaClearAll();
  location.reload();
})

function updateBackupStat() {
  const el = $("#backup-stat");
  const msgCnt = appState.chatList.length;
  const memCnt = appState.memoryList.length;
  const wbCnt = appState.worldBook.length;
  el.innerHTML = `<div class="info-box">消息：${msgCnt}条｜记忆${memCnt}条｜世界书${wbCnt}条</div>`
}

// ===================== 页面启动初始化 =====================
async function appInit() {
  await openIDB();
  renderChat();
  renderMemoryList();
  renderWorldBook();
  fillCharCardUI();
  fillApiUI();
  fillSettingUI();
  fillCardUI();
  await renderAlbum();
  await renderMusicList();
  renderMoments();
  renderCallLog();
  renderNotes();
  updateBackupStat();
}

document.addEventListener("DOMContentLoaded", appInit);
