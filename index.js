/* InstaChar v0.8.0 — Modal Fix + Lorebook NPC Scan + Role Editor */

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "Instachar";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const VERSION = "0.8.0";

// ✅ Role detection mapping
const ROLE_KEYWORDS = {
    "พี่": ["พี่", "older brother", "big brother", "兄", "兄貴"],
    "น้อง": ["น้อง", "younger sibling", "little brother", "妹", "弟"],
    "แม่": ["แม่", "mother", "mom", "mum", "mama", "母"],
    "พ่อ": ["พ่อ", "father", "dad", "papa", "父"],
    "เพื่อน": ["เพื่อน", "friend", "buddy", "mate", "친구"],
    "คู่รัก": ["แฟน", "หนึ่ง", "lover", "girlfriend", "boyfriend", "spouse", "妻", "夫"],
    "ลูก": ["ลูก", "son", "daughter", "child", "kid", "子"],
    "เจ้านาย": ["เจ้านาย", "boss", "master", "sir", "ma'am", "employer"],
    "ผู้ใหญ่": ["ผู้ใหญ่", "elder", "senior", "teacher", "professor"],
};

const DEFAULT_GLOBAL = {
    iconVisible: true,
    autoPost: true,
    ambientEnabled: false,
    postChance: 0.35,
    iconPos: null,
    currentTab: "feed",
    characters: {},
};

function newCharData() {
    return {
        name: "",
        npcs: [],
        posts: [],
        dms: {},
        userProfile: { username: "", displayName: "", bio: "", avatar: "" },
        unreadCount: 0,
        selectedProfile: null,
    };
}

// ---------- Logging ----------
const debugLog = [];
function log(msg, isError) {
    const ts = new Date().toLocaleTimeString();
    const line = "[" + ts + "] " + (isError ? "ERR " : "OK  ") + msg;
    debugLog.push(line);
    if (debugLog.length > 80) debugLog.shift();
    if (isError) console.error("[InstaChar] " + msg);
    else console.log("[InstaChar] " + msg);
    const $dbg = $("#instachar-debug-log");
    if ($dbg.length) $dbg.text(debugLog.slice(-14).join("\n"));
}

// ---------- Settings ----------
function getGlobal() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_GLOBAL));
        }
        const g = extension_settings[extensionName];
        for (const k of Object.keys(DEFAULT_GLOBAL)) {
            if (g[k] === undefined) g[k] = JSON.parse(JSON.stringify(DEFAULT_GLOBAL[k]));
        }
        return g;
    } catch (e) {
        log("getGlobal err: " + e.message, true);
        return JSON.parse(JSON.stringify(DEFAULT_GLOBAL));
    }
}

let saveTimer = null;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try { saveSettingsDebounced(); } catch (e) { log("save err: " + e.message, true); }
    }, 300);
}

// ---------- Character Context ----------
function getCharKey() {
    try {
        const ctx = getContext();
        if (ctx.groupId) return "group_" + ctx.groupId;
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            const ch = ctx.characters[ctx.characterId];
            if (ch && ch.avatar) return "char_" + ctx.characterId + "_" + (ctx.chat_id || "nochat");
        }
    } catch (e) {}
    return null;
}

function getCurrentCharacterName() {
    try {
        const ctx = getContext();
        if (ctx.groupId) {
            const g = ctx.groups && ctx.groups.find(x => x.id === ctx.groupId);
            return g ? g.name : "Group";
        }
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            return (ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].name) || null;
        }
    } catch (e) {}
    return null;
}

function getCharacterCard() {
    try {
        const ctx = getContext();
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            const c = ctx.characters[ctx.characterId];
            if (c) return { name: c.name, description: c.description || "", personality: c.personality || "", scenario: c.scenario || "" };
        }
    } catch (e) {}
    return null;
}

function getUserName() {
    try {
        const ctx = getContext();
        return (ctx && ctx.name1) || "You";
    } catch (e) { return "You"; }
}

function getRecentChat(n) {
    try {
        const ctx = getContext();
        const chat = ctx.chat || [];
        return chat.slice(-n).map(m => (m.is_user ? getUserName() : (m.name || "AI")) + ": " + (m.mes || "")).join("\n");
    } catch (e) { return ""; }
}

function getLoreBookContext() {
    try {
        const ctx = getContext();
        if (ctx.lorebook && Array.isArray(ctx.lorebook)) {
            return ctx.lorebook.map(entry => entry.content || "").filter(x => x).join("\n");
        }
    } catch (e) {}
    return "";
}

function getCharData() {
    const key = getCharKey();
    if (!key) return null;
    const g = getGlobal();
    if (!g.characters[key]) {
        g.characters[key] = newCharData();
        g.characters[key].name = getCurrentCharacterName() || "Unknown";
        save();
    }
    const d = g.characters[key];
    if (!d.npcs) d.npcs = [];
    if (!d.posts) d.posts = [];
    if (!d.dms) d.dms = {};
    if (!d.userProfile) d.userProfile = { username: "", displayName: "", bio: "", avatar: "" };
    if (d.unreadCount === undefined) d.unreadCount = 0;
    return d;
}

// ---------- Utility ----------
function uid(prefix) { return (prefix || "id") + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7); }

function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return diff + " วิ";
    if (diff < 3600) return Math.floor(diff / 60) + " น.";
    if (diff < 86400) return Math.floor(diff / 3600) + " ชม.";
    return Math.floor(diff / 86400) + " วัน";
}

function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}

function defaultAvatar(name) {
    const initial = (name || "?").charAt(0).toUpperCase();
    const colors = ["#e91e63","#9c27b0","#3f51b5","#00bcd4","#4caf50","#ff9800","#f44336","#795548","#607d8b"];
    const color = colors[(name || "").length % colors.length];
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect fill='" + color + "' width='80' height='80'/><text x='40' y='52' font-size='36' text-anchor='middle' fill='white' font-weight='bold'>" + initial + "</text></svg>";
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function sanitizeUsername(name) {
    if (!name) return "user_" + Math.floor(Math.random() * 9999);
    return name.toLowerCase().replace(/[^a-z0-9_\u0e00-\u0e7f]/g, "").slice(0, 20) || "user";
}

const imageCache = new Map();
function makeImageUrl(prompt, seed) {
    const cacheKey = (prompt || "default") + "_" + seed;
    if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
    const p = encodeURIComponent(prompt || "aesthetic photo cinematic");
    const url = "https://image.pollinations.ai/prompt/" + p + "?width=512&height=512&nologo=true&model=flux-schnell&seed=" + (seed || Math.floor(Math.random() * 99999));
    if (imageCache.size > 50) { const firstKey = imageCache.keys().next().value; imageCache.delete(firstKey); }
    imageCache.set(cacheKey, url);
    return url;
}

function parseJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const first = t.indexOf("{");
    const firstArr = t.indexOf("[");
    let start = -1;
    if (first >= 0 && (firstArr < 0 || first < firstArr)) start = first;
    else if (firstArr >= 0) start = firstArr;
    if (start < 0) return null;
    t = t.slice(start);
    try { return JSON.parse(t); }
    catch {
        for (let i = t.length - 1; i > 0; i--) {
            if (t[i] === "}" || t[i] === "]") {
                try { return JSON.parse(t.slice(0, i + 1)); } catch {}
            }
        }
        return null;
    }
}

// ✅ Auto-detect role/relationship
function detectRole(npc, description, chatHistory, loreContext) {
    const fullText = ((description || "") + " " + (chatHistory || "") + " " + (loreContext || "")).toLowerCase();
    for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
        for (const kw of keywords) {
            if (fullText.includes(kw.toLowerCase())) return role;
        }
    }
    return null;
}

// ✅ Get pronoun & speech style based on role
function getRoleContext(role) {
    const roleMap = {
        "พี่": { pronoun: "พี่", description: "ผู้ใหญ่ที่เป็นพี่ชาย", styleHint: "พูดปกติ เป็นผู้ใหญ่ บ้างครั้งอาจหาบ้าง" },
        "น้อง": { pronoun: "น้อง", description: "คนที่เล็กกว่า", styleHint: "พูดเหมือนน้องชาย น้อยใจ บ้างครั้งเอ้อ" },
        "แม่": { pronoun: "แม่", description: "แม่", styleHint: "พูดเป็นแม่ เมตตา บางครั้งโวย" },
        "พ่อ": { pronoun: "ป๊า", description: "พ่อ", styleHint: "พูดเป็นพ่อ เรียบร้อย บ้างครั้งเรียบหรือเสียดสี" },
        "เพื่อน": { pronoun: "ฉัน/กู", description: "เพื่อน", styleHint: "พูดกู-มึง สนิท ขี้ขลาด บ้างครั้งหยาบ" },
        "คู่รัก": { pronoun: "ฉัน", description: "คู่รัก", styleHint: "พูดปกติ โรแมนติก เคารพ บ้างครั้งเจ้าเล่น" },
        "ลูก": { pronoun: "ลูก", description: "ลูก", styleHint: "พูดเป็นลูก บ้างครั้งเอ้อ เรียกพ่อแม่" },
        "เจ้านาย": { pronoun: "ฉัน", description: "เจ้านาย", styleHint: "พูดสุภาพ เรียบร้อย ยกย่องผู้ใหญ่" },
    };
    return roleMap[role] || { pronoun: "ฉัน", description: role || "คนปกติ", styleHint: "พูดปกติ" };
}

// ---------- NPC Management ----------
function ensureNpcFromCharacterCard() {
    const card = getCharacterCard();
    if (!card) return null;
    if (card.name?.toLowerCase().includes("narrator") ||
        card.name?.toLowerCase().includes("gm") ||
        card.name?.toLowerCase().includes("system")) {
        log("Skipped narrator character: " + card.name, false);
        return null;
    }
    const data = getCharData();
    if (!data) return null;
    let npc = data.npcs.find(n => n.name === card.name);
    if (!npc) npc = createNpc(card.name, card.description, card.personality);
    return npc;
}

function createNpc(name, description, personality) {
    const data = getCharData();
    if (!data) return null;
    const existing = data.npcs.find(n => n.name === name);
    if (existing) return existing;
    const chatHistory = getRecentChat(20);
    const loreContext = getLoreBookContext();
    const detectedRole = detectRole(null, description, chatHistory, loreContext);
    const npc = {
        id: uid("npc"),
        name: name,
        username: sanitizeUsername(name) + "_" + Math.floor(Math.random() * 99),
        displayName: name,
        bio: (description || "").slice(0, 150),
        description: description || "",
        personality: personality || "",
        avatar: defaultAvatar(name),
        followers: Math.floor(Math.random() * 5000) + 100,
        following: Math.floor(Math.random() * 500) + 50,
        userFollowing: false,
        role: detectedRole,
    };
    try {
        const ctx = getContext();
        if (ctx.characterId !== undefined) {
            const c = ctx.characters[ctx.characterId];
            if (c && c.name === name && c.avatar && c.avatar !== "none") {
                npc.avatar = "/characters/" + c.avatar;
            }
        }
    } catch (e) {}
    data.npcs.push(npc);
    save();
    log(`NPC created: ${name} (Role: ${detectedRole || "unknown"})`);
    return npc;
}

function findNpc(id) {
    const data = getCharData();
    if (!data) return null;
    return data.npcs.find(n => n.id === id);
}

function findNpcByName(name) {
    const data = getCharData();
    if (!data) return null;
    return data.npcs.find(n => n.name === name);
}

function deleteNpc(id) {
    const data = getCharData();
    if (!data) return;
    data.npcs = data.npcs.filter(n => n.id !== id);
    data.posts = data.posts.filter(p => p.authorId !== id);
    delete data.dms[id];
    save();
}

// ✅ NEW: Auto-scan & extract NPCs from Lorebook
async function extractNpcsFromLorebook(statusCb) {
    const lore = getLoreBookContext();
    const card = getCharacterCard();
    const recentChat = getRecentChat(30);

    if (!lore && !card && !recentChat) {
        toast("ไม่พบข้อมูล Lorebook หรือ Character Card");
        return [];
    }

    const data = getCharData();
    if (!data) return [];
    const existingNames = data.npcs.map(n => n.name).join(", ");

    if (statusCb) statusCb("🔍 กำลังวิเคราะห์ตัวละคร...");

    const prompt = `[Extract Supporting Characters/NPCs]

Main character card:
${card ? `Name: ${card.name}\nDesc: ${(card.description || "").slice(0, 400)}` : "(none)"}

Lorebook/World entries:
${(lore || "").slice(0, 2000)}

Recent story/chat excerpt:
${recentChat.slice(0, 1000)}

Task: Find ALL named supporting characters (NOT the main character, NOT the user/player).
For each character found:
- Extract their name, personality traits, description, and their relationship/role to main character
- Determine their speech style (formal? slang? cute? rough? etc.)
- Infer their role type from: พี่/น้อง/เพื่อน/แม่/พ่อ/คู่รัก/ลูก/เจ้านาย/ผู้ใหญ่/อื่นๆ

Already registered (SKIP THESE): ${existingNames || "none"}
Main character (SKIP): ${card ? card.name : "unknown"}

Respond ONLY with minified JSON array (empty array [] if none found):
[{"name":"ชื่อ","description":"บุคลิก ลักษณะ นิสัย","personality":"สไตล์การพูด","role":"ประเภทความสัมพันธ์","bio":"IG bio สั้นๆ 1 ประโยค"}]`;

    try {
        const response = await callLLM(prompt, "Extract characters. Return JSON array only. No markdown. No explanation.");
        const npcs = parseJson(response);
        if (!Array.isArray(npcs) || npcs.length === 0) {
            toast("ไม่พบ NPC ใหม่ใน Lorebook");
            return [];
        }
        const added = [];
        for (const nd of npcs) {
            if (!nd.name || nd.name.trim() === "") continue;
            if (card && nd.name.toLowerCase() === card.name.toLowerCase()) continue;
            if (findNpcByName(nd.name)) continue;
            if (statusCb) statusCb(`➕ เพิ่ม: ${nd.name}...`);
            const npc = createNpc(nd.name, nd.description || "", nd.personality || "");
            if (nd.role) npc.role = nd.role;
            if (nd.bio) npc.bio = nd.bio;
            added.push(npc);
        }
        save();
        return added;
    } catch (e) {
        log("extractNpcsFromLorebook: " + e.message, true);
        return [];
    }
}

// ---------- LLM ----------
async function callLLM(prompt, systemPrompt) {
    let ctx = null;
    try {
        if (typeof window !== "undefined" && window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
            ctx = window.SillyTavern.getContext();
        }
    } catch (e) {}
    if (!ctx) { try { ctx = getContext(); } catch (e) {} }
    if (!ctx) throw new Error("Could not get context");
    const sysPrompt = systemPrompt || "You are a data assistant. Respond with valid JSON only. No markdown. No explanations.";
    if (typeof ctx.generateRaw === "function") {
        try {
            const r = await ctx.generateRaw({ systemPrompt: sysPrompt, prompt: prompt });
            if (r && String(r).trim() !== "") return r;
        } catch (e) { log("generateRaw: " + e.message, true); }
    }
    if (typeof ctx.generateQuietPrompt === "function") {
        try {
            const r = await ctx.generateQuietPrompt({ quietPrompt: prompt });
            if (r && String(r).trim() !== "") return r;
        } catch (e1) {
            try {
                const r = await ctx.generateQuietPrompt(prompt, false, false);
                if (r && String(r).trim() !== "") return r;
            } catch (e2) {}
        }
    }
    throw new Error("No LLM function available");
}

function buildCharContext(npc) {
    const lines = [];
    lines.push(`Character: ${npc.name}`);
    if (npc.role) {
        const roleCtx = getRoleContext(npc.role);
        lines.push(`Role/Relationship: ${npc.role} (${roleCtx.description})`);
        lines.push(`Speech style: ${roleCtx.styleHint}`);
        lines.push(`Pronoun: ${roleCtx.pronoun}`);
    }
    if (npc.description) lines.push(`Description: ${npc.description.slice(0, 500)}`);
    if (npc.personality) lines.push(`Personality: ${npc.personality.slice(0, 300)}`);
    const recent = getRecentChat(10);
    if (recent) lines.push(`\nRecent chat excerpt (match this speech style/tone/slang/vocabulary):\n${recent.slice(-1500)}`);
    const lore = getLoreBookContext();
    if (lore) lines.push(`\nLorebook context:\n${lore.slice(-1000)}`);
    return lines.join("\n");
}

// ---------- Post Generation ----------
async function generatePostFor(npc, sceneContext) {
    const data = getCharData();
    if (!data || !npc) return null;
    const charCtx = buildCharContext(npc);
    const sceneText = sceneContext ? sceneContext.slice(0, 600) : "(random slice-of-life moment)";
    const prompt = `[Instagram Post Simulator]

${charCtx}

Scene that just happened:
${sceneText}

Task: Generate ONE Instagram post as "${npc.name}" reacting to this scene.

CRITICAL RULES:
- Caption MUST be in Thai ONLY
- Use character's EXACT speech style and pronouns from role context (e.g., if พี่ then use "พี่", if เพื่อน then use "กู/มึง")
- Match slang, tone, and personality PRECISELY
- Short caption (1-3 sentences), natural IG vibe
- Include emojis if fitting
- Image prompt in ENGLISH only

Respond ONLY with minified JSON:
{"caption":"thai text matching character voice","imagePrompt":"english","hashtags":["#tag"],"mood":"happy|sad|flirty|chill|excited|moody|proud"}`;
    try {
        const systemPrompt = `You are an Instagram content writer.
- Match the character's EXACT pronouns and speech style
- If they use "${npc.role}" role context, use those pronouns ALWAYS
- Keep captions SHORT (max 3 sentences)
- Use emojis strategically
- ONLY respond with valid JSON
- Maintain character voice 100%`;
        const response = await callLLM(prompt, systemPrompt);
        const d = parseJson(response);
        if (!d || !d.caption) { log("Post JSON invalid", true); return null; }
        const likes = Math.max(5, Math.floor((npc.followers || 1000) * (0.3 + Math.random() * 1.4) / 10));
        const post = {
            id: uid("p"),
            authorId: npc.id,
            author: npc.name,
            authorUsername: npc.username,
            authorAvatar: npc.avatar,
            caption: d.caption,
            hashtags: d.hashtags || [],
            image: makeImageUrl(d.imagePrompt, Date.now()),
            imagePrompt: d.imagePrompt || "",
            mood: d.mood || "chill",
            timestamp: Date.now(),
            likes: likes,
            userLiked: false,
            comments: [],
            userComments: [],
        };
        post.comments = await generateComments(npc, post, sceneText);
        data.posts.push(post);
        data.unreadCount++;
        save();
        flashIcon();
        if (isPanelOpen() && getGlobal().currentTab === "feed") renderCurrentTab();
        log(`${npc.name} posted ✓ (Role: ${npc.role || "unknown"})`);
        return post;
    } catch (e) {
        log("Post gen failed: " + e.message, true);
        return null;
    }
}

async function generateComments(npc, post, sceneContext) {
    const userName = getUserName();
    const data = getCharData();
    const otherNpcs = data.npcs.filter(n => n.id !== npc.id).map(n => n.name).join(", ");
    const prompt = `[IG Comments]
${npc.name} posted: "${post.caption}" (mood: ${post.mood})
Scene context: ${sceneContext ? sceneContext.slice(0, 300) : "(none)"}
Other NPCs in this story: ${otherNpcs || "(none)"}
User's name: ${userName}

Generate 2-4 Thai IG comments. Mix of:
- Known NPCs (use their actual names for username if relevant)
- Random followers
- NEVER from "${userName}" or "${npc.name}"

Keep comments short, natural Thai IG style.

Respond ONLY with JSON array: [{"username":"name","text":"thai"}]`;
    try {
        const response = await callLLM(prompt);
        const arr = parseJson(response);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, 5).map(c => ({
            username: c.username || "user_" + Math.floor(Math.random() * 999),
            text: c.text || "",
            timestamp: Date.now(),
        }));
    } catch (e) { return []; }
}

async function generateReactionToUser(npc, userPost) {
    const charCtx = buildCharContext(npc);
    const prompt = `[IG Reaction]
${charCtx}

User's name: ${getUserName()}
User just posted on IG:
Caption: "${userPost.caption}"
Image: "${userPost.imagePrompt || 'photo'}"

Would "${npc.name}" like/comment based on their relationship with user and personality?

Respond ONLY with JSON: {"like":true|false,"comment":"thai comment or null"}`;
    try {
        const response = await callLLM(prompt);
        return parseJson(response);
    } catch { return { like: Math.random() < 0.5, comment: null }; }
}

async function generateDMReply(npcId) {
    const data = getCharData();
    if (!data) return;
    const npc = findNpc(npcId);
    if (!npc) return;
    const thread = data.dms[npcId] || [];
    const recentThread = thread.slice(-10).map(m => (m.from === "user" ? getUserName() : npc.name) + ": " + m.text).join("\n");
    const charCtx = buildCharContext(npc);
    const prompt = `[IG Private DM]
${charCtx}

DM conversation with ${getUserName()}:
${recentThread}

Reply as "${npc.name}" in Thai. Use their EXACT speech style and pronouns. Short (1-3 sentences), casual IG DM vibe. Stay in character.

Reply directly. No JSON. No prefix. Just the message.`;
    try {
        const roleCtx = npc.role ? getRoleContext(npc.role) : { pronoun: "ฉัน" };
        const response = await callLLM(prompt, `You are ${npc.name} (${npc.role || "character"}). Use pronoun "${roleCtx.pronoun}". Stay in character.`);
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 500);
        if (!reply) return;
        data.dms[npcId] = data.dms[npcId] || [];
        data.dms[npcId].push({ from: "char", text: reply, timestamp: Date.now() });
        data.unreadCount++;
        save();
        flashIcon();
    } catch (e) { log("DM reply failed: " + e.message, true); }
}

// ---------- Shadow DOM ----------
let shadowHost = null;
let shadowRoot = null;

function buildShadowHost() {
    const existing = document.getElementById("instachar-shadow-host");
    if (existing) existing.remove();
    shadowHost = document.createElement("div");
    shadowHost.id = "instachar-shadow-host";
    shadowHost.setAttribute("style", "position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;z-index:2147483646 !important;pointer-events:none !important");
    document.documentElement.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: "open" });
    return shadowRoot;
}

const SHADOW_CSS = `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", sans-serif; }
* { box-sizing: border-box; }

.floater { position: fixed; right: 16px; top: 150px; width: 58px; height: 58px; border-radius: 18px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
    border: none;
    box-shadow: 0 15px 35px rgba(102, 126, 234, 0.4), 0 5px 15px rgba(118, 75, 162, 0.3), 0 0 0 2px rgba(255,255,255,0.15);
    cursor: pointer; pointer-events: auto; display: flex; align-items: center; justify-content: center;
    color: white; font-size: 26px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,0.3);
    user-select: none; -webkit-tap-highlight-color: transparent;
    animation: insta-entry 0.6s ease-out, insta-float 3.5s ease-in-out 0.6s infinite; }
.floater.hidden { display: none; }
.floater.pressed { transform: scale(0.92); transition: transform 0.1s; }
.floater.flash { background: red !important; transform: scale(1.5) !important; }
.floater svg { width: 28px; height: 28px; pointer-events: none; }
@keyframes insta-entry { 0% { opacity: 0; transform: scale(0); } 60% { transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
@keyframes insta-float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
.floater:hover { transform: scale(1.08); box-shadow: 0 20px 45px rgba(102, 126, 234, 0.6), 0 0 0 2px rgba(255,255,255,0.25) !important; }

.badge { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 6px;
    background: #ff2d55; color: white; font-size: 11px; font-weight: 700; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; border: 2px solid #000; }
.badge.hidden { display: none; }

.overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh;
    background: #000; pointer-events: auto; display: flex; flex-direction: column;
    color: #f5f5f5; animation: insta-fade 0.2s ease-out; overflow: hidden; }
.overlay.hidden { display: none; }
@keyframes insta-fade { from { opacity: 0; } to { opacity: 1; } }

.statusbar { display: flex; justify-content: space-between; padding: 8px 18px 4px; font-size: 13px; font-weight: 600; flex-shrink: 0; height: 28px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid #262626; flex-shrink: 0; height: 56px; box-sizing: border-box; }
.topbar-title { font-family: "Billabong","Pacifico","Dancing Script",cursive; font-size: 28px; line-height: 1; }
.topbar-actions { display: flex; gap: 8px; }
.icon-btn { background: transparent; border: none; color: #f5f5f5; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.icon-btn:hover { background: #121212; }

.screen { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0; -webkit-overflow-scrolling: touch; }
.screen::-webkit-scrollbar { width: 6px; }
.screen::-webkit-scrollbar-thumb { background: #262626; border-radius: 3px; }

.nav { display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #262626; padding: 8px 0 10px; background: #000; flex-shrink: 0; height: 52px; box-sizing: border-box; }
.nav-item { background: transparent; border: none; color: #f5f5f5; cursor: pointer; padding: 6px 12px; opacity: 0.7; }
.nav-item svg { width: 24px; height: 24px; }
.nav-item.active { opacity: 1; transform: scale(1.1); }
.nav-item.active svg { stroke-width: 2.5; }

.post-bar { display: flex; gap: 8px; padding: 10px 14px; background: #0a0a0a; border-bottom: 1px solid #262626; flex-wrap: wrap; }
.post-bar select, .post-bar button { padding: 8px 12px; background: #262626; border: none; color: #f5f5f5; border-radius: 8px; font-size: 13px; cursor: pointer; }
.post-bar button.primary { background: linear-gradient(45deg, #dc2743, #bc1888); font-weight: 600; }
.post-bar button:disabled { opacity: 0.5; cursor: not-allowed; }

.stories { display: flex; gap: 14px; padding: 12px 14px; overflow-x: auto; border-bottom: 1px solid #262626; }
.stories::-webkit-scrollbar { display: none; }
.story { flex-shrink: 0; width: 66px; cursor: pointer; text-align: center; }
.story-ring { width: 62px; height: 62px; border-radius: 50%; background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); padding: 2px; margin: 0 auto; }
.story-ring img { width: 100%; height: 100%; border-radius: 50%; border: 2px solid #000; object-fit: cover; display: block; }
.story-name { font-size: 11px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.post { border-bottom: 1px solid #262626; padding-bottom: 8px; position: relative; }
.post-head { display: flex; align-items: center; padding: 10px 14px; gap: 10px; }
.post-user { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; }
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.post-user-info { display: flex; flex-direction: column; line-height: 1.15; }
.username { font-weight: 600; font-size: 14px; }
.post-mood { font-size: 11px; color: #737373; }
.post-menu { cursor: pointer; padding: 4px 10px; font-size: 20px; color: #f5f5f5; position: relative; }
.post-menu-dropdown { position: absolute; right: 14px; top: 40px; background: #262626; border-radius: 8px; padding: 6px; display: none; min-width: 130px; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
.post-menu-dropdown.show { display: block; }
.post-menu-item { padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 13px; }
.post-menu-item:hover { background: #3a3a3a; }
.post-menu-item.danger { color: #ed4956; }
.post-image-wrap { width: 100%; aspect-ratio: 1/1; background: #121212; overflow: hidden; cursor: pointer; position: relative; }
.post-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.post-actions { display: flex; align-items: center; padding: 8px 10px 4px; gap: 4px; }
.act-btn { background: transparent; border: none; color: #f5f5f5; padding: 6px; cursor: pointer; border-radius: 50%; }
.act-btn svg { width: 24px; height: 24px; }
.save { margin-left: auto; }
.post-likes { padding: 2px 14px; font-size: 14px; font-weight: 600; }
.post-caption { padding: 4px 14px; font-size: 14px; line-height: 1.4; }
.post-caption b { font-weight: 600; margin-right: 4px; }
.tag { color: #0095f6; margin-right: 4px; }
.post-comments { padding: 2px 14px; }
.comment { font-size: 14px; line-height: 1.4; padding: 1px 0; display: flex; align-items: flex-start; gap: 6px; }
.comment-content { flex: 1; }
.comment b { font-weight: 600; margin-right: 4px; }
.comment-del { background: transparent; border: none; color: #737373; cursor: pointer; font-size: 14px; padding: 0 4px; }
.comment-del:hover { color: #ed4956; }
.post-time { padding: 4px 14px; font-size: 11px; color: #737373; text-transform: uppercase; }
.comment-box { display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid #121212; margin-top: 6px; gap: 8px; }
.comment-input { flex: 1; background: transparent; border: none; color: #f5f5f5; font-size: 14px; outline: none; padding: 6px 0; }
.comment-input::placeholder { color: #737373; }
.comment-post { background: transparent; border: none; color: #0095f6; font-weight: 600; cursor: pointer; font-size: 14px; }

.empty { padding: 40px 20px; text-align: center; color: #a8a8a8; }
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }
.empty-title { font-size: 18px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; }
.empty-sub { font-size: 13px; line-height: 1.5; color: #737373; }
.empty-small { padding: 30px 20px; text-align: center; color: #737373; font-size: 13px; }

.profile-head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #262626; gap: 8px; }
.back-btn { background: transparent; border: none; color: #f5f5f5; font-size: 22px; cursor: pointer; }
.profile-username { font-weight: 700; font-size: 16px; text-align: center; }
.profile-body { padding: 14px; }
.profile-top { display: flex; align-items: center; gap: 24px; margin-bottom: 14px; }
.profile-avatar-wrap { position: relative; }
.profile-avatar { width: 86px; height: 86px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.avatar-change { position: absolute; bottom: 0; right: 0; background: #0095f6; color: white; border: 2px solid #000; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; }
.profile-stats { display: flex; gap: 18px; flex: 1; justify-content: space-around; }
.profile-stats > div { text-align: center; display: flex; flex-direction: column; font-size: 13px; }
.profile-stats b { font-size: 17px; font-weight: 700; }
.profile-stats span { color: #a8a8a8; }
.profile-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.profile-bio { font-size: 13px; line-height: 1.4; margin-bottom: 12px; white-space: pre-wrap; }
.profile-actions { display: flex; gap: 6px; margin-bottom: 14px; }
.follow-btn, .msg-btn, .action-btn { flex: 1; padding: 8px; border-radius: 8px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; }
.follow-btn { background: #0095f6; color: white; }
.follow-btn.following { background: #262626; color: #f5f5f5; }
.msg-btn, .action-btn { background: #262626; color: #f5f5f5; }

.profile-grid, .discover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; margin-top: 8px; }
.grid-item { aspect-ratio: 1/1; background: #121212; overflow: hidden; cursor: pointer; }
.grid-item img { width: 100%; height: 100%; object-fit: cover; }

.search-bar { padding: 8px 14px; border-bottom: 1px solid #262626; }
.search-bar input { width: 100%; padding: 8px 12px; border-radius: 8px; background: #121212; border: none; color: #f5f5f5; font-size: 14px; outline: none; }

.compose { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.compose-title { font-size: 18px; font-weight: 700; }
.compose textarea, .compose input, .inline-input {
    width: 100%; padding: 10px 12px; border-radius: 8px; background: #121212;
    border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none;
    font-family: inherit; resize: vertical; box-sizing: border-box; }
.compose-label { font-size: 12px; color: #a8a8a8; }
.compose-hint { font-size: 11px; color: #737373; }
.primary-btn { padding: 10px; background: linear-gradient(45deg, #dc2743, #bc1888); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; }
.secondary-btn { padding: 10px; background: #262626; color: #f5f5f5; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
.danger-btn { padding: 10px; background: transparent; color: #ed4956; border: 1px solid #ed4956; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; }

.dm-header { padding: 14px; display: flex; justify-content: space-between; align-items: center; }
.dm-title { font-size: 18px; font-weight: 700; }
.dm-list { display: flex; flex-direction: column; }
.dm-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; position: relative; }
.dm-item:hover { background: #121212; }
.dm-item-del { background: transparent; border: none; color: #737373; cursor: pointer; padding: 4px 8px; font-size: 14px; }
.dm-item-del:hover { color: #ed4956; }
.dm-info { flex: 1; min-width: 0; }
.dm-name { font-weight: 600; font-size: 14px; }
.dm-preview { font-size: 13px; color: #a8a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262626; }
.dm-chat-name { font-weight: 600; font-size: 15px; flex: 1; }
.dm-clear-btn { background: transparent; border: none; color: #737373; cursor: pointer; font-size: 13px; padding: 4px 8px; }
.dm-clear-btn:hover { color: #ed4956; }
.dm-thread { padding: 14px; display: flex; flex-direction: column; gap: 6px; min-height: 200px; }
.dm-msg { max-width: 75%; padding: 8px 12px; border-radius: 18px; font-size: 14px; line-height: 1.35; word-wrap: break-word; position: relative; }
.dm-msg.user { align-self: flex-end; background: #0095f6; color: white; }
.dm-msg.char { align-self: flex-start; background: #262626; color: #f5f5f5; }
.dm-msg .msg-del { position: absolute; top: -6px; right: -6px; background: #ed4956; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; display: none; }
.dm-msg:hover .msg-del { display: flex; align-items: center; justify-content: center; }
.dm-input-wrap { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #262626; }
.dm-input-wrap input { flex: 1; padding: 10px 14px; border-radius: 20px; background: #121212; border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none; }
.dm-input-wrap button { padding: 8px 16px; background: transparent; color: #0095f6; border: none; font-weight: 700; cursor: pointer; font-size: 14px; }

.toast { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%) translateY(30px);
    background: #262626; color: #f5f5f5; padding: 10px 20px; border-radius: 24px; font-size: 14px;
    opacity: 0; transition: all 0.3s; pointer-events: none; border: 1px solid #3a3a3a; z-index: 9999;
    white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ✅ FIXED v2: modal-root อยู่ใน overlay → ใช้ position:absolute */
.modal-bg {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.88);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 9998;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 24px 16px 60px;
    pointer-events: auto;
}
.modal {
    background: #111;
    border-radius: 16px;
    padding: 20px;
    width: min(400px, 92vw);
    border: 1px solid #262626;
    flex-shrink: 0;
    margin: 0 0 auto 0;
}
.modal h3 { margin: 0 0 14px 0; font-size: 18px; }
.modal .row { margin-bottom: 12px; }
.modal label { display: block; font-size: 12px; color: #a8a8a8; margin-bottom: 4px; }

.npc-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: #121212; border-radius: 8px; margin-bottom: 6px; }
.npc-info { flex: 1; min-width: 0; }
.npc-name { font-weight: 600; font-size: 13px; }
.npc-bio { font-size: 11px; color: #a8a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.npc-role { font-size: 10px; color: #0095f6; margin-top: 2px; }

@media (min-width: 700px) {
    .overlay { top: 3vh !important; left: 50% !important; right: auto !important; bottom: auto !important;
        width: 430px !important; height: 94vh !important; max-height: 820px; transform: translateX(-50%);
        border-radius: 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }
}
`;

function mountUI() {
    try {
        buildShadowHost();
        shadowRoot.innerHTML =
            "<style>" + SHADOW_CSS + "</style>" +
            '<div id="floater" class="floater" title="InstaChar">📱<span id="badge" class="badge hidden">0</span></div>' +
            '<div id="overlay" class="overlay hidden">' +
                '<div class="statusbar"><span id="clock">—</span><span>📶 🔋</span></div>' +
                '<div class="topbar"><div class="topbar-title">Instagram</div><div class="topbar-actions">' +
                    '<button class="icon-btn" id="btn-refresh" title="Refresh">⟳</button>' +
                    '<button class="icon-btn" id="btn-close" title="Close">✕</button></div></div>' +
                '<div class="screen"><div id="view"></div></div>' +
                '<div class="nav">' +
                    '<button class="nav-item" data-tab="feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></button>' +
                    '<button class="nav-item" data-tab="discover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>' +
                    '<button class="nav-item" data-tab="post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="15" x2="15" y2="15"/></svg></button>' +
                    '<button class="nav-item" data-tab="dm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>' +
                    '<button class="nav-item" data-tab="profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>' +
                '</div>' +
                '<div id="modal-root"></div></div>' +
            '<div id="toast" class="toast"></div>';

        const floater = shadowRoot.getElementById("floater");

        let pDown = false, pStartX = 0, pStartY = 0, pMoved = false;
        floater.addEventListener("pointerdown", (e) => {
            pDown = true; pStartX = e.clientX; pStartY = e.clientY; pMoved = false;
            floater.classList.add("pressed");
            try { floater.setPointerCapture(e.pointerId); } catch (_) {}
        });
        floater.addEventListener("pointermove", (e) => {
            if (!pDown) return;
            const dx = e.clientX - pStartX, dy = e.clientY - pStartY;
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) pMoved = true;
            if (pMoved) {
                const r = floater.getBoundingClientRect();
                const newRight = Math.max(8, Math.min(window.innerWidth - 68, window.innerWidth - r.right - dx));
                const newTop = Math.max(8, Math.min(window.innerHeight - 68, r.top + dy));
                floater.style.right = newRight + "px";
                floater.style.top = newTop + "px";
                floater.style.bottom = "auto";
                pStartX = e.clientX; pStartY = e.clientY;
            }
        });
        floater.addEventListener("pointerup", () => {
            floater.classList.remove("pressed");
            if (!pDown) return;
            pDown = false;
            if (pMoved) {
                const r = floater.getBoundingClientRect();
                getGlobal().iconPos = { right: Math.round(window.innerWidth - r.right), top: Math.round(r.top) };
                save();
            } else { openPanel(); }
        });
        floater.addEventListener("pointercancel", () => { pDown = false; pMoved = false; floater.classList.remove("pressed"); });

        const g = getGlobal();
        if (g.iconPos) {
            if (typeof g.iconPos.right === "number") floater.style.right = g.iconPos.right + "px";
            if (typeof g.iconPos.top === "number") { floater.style.top = g.iconPos.top + "px"; floater.style.bottom = "auto"; }
        }
        setFloaterVisible(g.iconVisible);

        shadowRoot.getElementById("btn-close").addEventListener("click", closePanel);
        shadowRoot.getElementById("btn-refresh").addEventListener("click", () => renderCurrentTab());
        shadowRoot.querySelectorAll(".nav-item").forEach(btn => {
            btn.addEventListener("click", () => {
                getGlobal().currentTab = btn.dataset.tab;
                const data = getCharData();
                if (data) data.selectedProfile = null;
                save();
                renderCurrentTab();
                updateNavActive();
            });
        });

        setInterval(updateClock, 30000);
        log("UI mounted ✓");
    } catch (e) { log("mountUI failed: " + e.message, true); }
}

function setFloaterVisible(v) {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (el) { if (v) el.classList.remove("hidden"); else el.classList.add("hidden"); }
}

function flashIcon() {
    updateBadge();
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (el) {
        el.style.animation = "insta-float 0.4s ease-in-out 3";
        setTimeout(() => { el.style.animation = ""; }, 1500);
    }
}

function findIcon() {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (!el) return;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 3000);
}

function resetIconPos() { getGlobal().iconPos = null; save(); mountUI(); toast("รีเซ็ตตำแหน่งแล้ว"); }

function openPanel() {
    if (!shadowRoot) return;
    ensureNpcFromCharacterCard();
    shadowRoot.getElementById("overlay").classList.remove("hidden");
    const data = getCharData();
    if (data) { data.unreadCount = 0; save(); }
    updateBadge();
    renderCurrentTab();
    updateNavActive();
    updateClock();
}

function closePanel() { if (shadowRoot) shadowRoot.getElementById("overlay").classList.add("hidden"); }
function isPanelOpen() {
    if (!shadowRoot) return false;
    const ov = shadowRoot.getElementById("overlay");
    return ov && !ov.classList.contains("hidden");
}

function updateClock() {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("clock");
    if (!el) return;
    const d = new Date();
    el.textContent = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function updateBadge() {
    if (!shadowRoot) return;
    const data = getCharData();
    const n = data ? (data.unreadCount || 0) : 0;
    const badge = shadowRoot.getElementById("badge");
    if (!badge) return;
    if (n > 0) { badge.textContent = n > 99 ? "99+" : n; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
}

function updateNavActive() {
    if (!shadowRoot) return;
    const g = getGlobal();
    shadowRoot.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === g.currentTab));
}

function toast(msg) {
    if (!shadowRoot) return;
    const t = shadowRoot.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
}

function showModal(html) {
    if (!shadowRoot) return null;
    const root = shadowRoot.getElementById("modal-root");
    root.innerHTML = '<div class="modal-bg"><div class="modal">' + html + '</div></div>';
    root.querySelector(".modal-bg").addEventListener("click", (e) => {
        if (e.target.classList.contains("modal-bg")) root.innerHTML = "";
    });
    return root;
}
function closeModal() { if (shadowRoot) shadowRoot.getElementById("modal-root").innerHTML = ""; }

// ---------- Renderers ----------
function renderCurrentTab() {
    const data = getCharData();
    if (!data) {
        if (shadowRoot) shadowRoot.getElementById("view").innerHTML = '<div class="empty"><div class="empty-icon">👀</div><div class="empty-title">ยังไม่ได้เลือกตัวละคร</div></div>';
        return;
    }
    if (data.selectedProfile) return renderNpcProfile(data.selectedProfile);
    const g = getGlobal();
    switch (g.currentTab) {
        case "feed": return renderFeed();
        case "discover": return renderDiscover();
        case "post": return renderCompose();
        case "dm": return renderDMList();
        case "profile": return renderMyProfile();
    }
}

function renderFeed() {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const view = shadowRoot.getElementById("view");
    const posts = [...data.posts].reverse();

    const postBar = `<div class="post-bar" style="justify-content:center;color:#a8a8a8;font-size:12px">
        🤖 Auto-post activated — Characters post themselves! ✨
    </div>`;

    if (posts.length === 0) {
        view.innerHTML = postBar + '<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">ยังไม่มีโพสต์</div><div class="empty-sub">ลองคุยกับตัวละคร เขาจะโพสต์เอง!</div></div>';
        return;
    }

    view.innerHTML = postBar + renderStoriesBar() + posts.map(renderPostCard).join("");
    attachFeedHandlers();
}

function renderStoriesBar() {
    const data = getCharData();
    if (!data || data.npcs.length === 0) return "";
    return '<div class="stories">' +
        data.npcs.map(n => `<div class="story" data-npc="${n.id}">
            <div class="story-ring"><img src="${escapeHtml(n.avatar)}" onerror="this.src='${defaultAvatar(n.name)}'"/></div>
            <div class="story-name">${escapeHtml(n.username)}</div>
            ${n.role ? `<div class="npc-role">${escapeHtml(n.role)}</div>` : ""}
        </div>`).join("") +
    '</div>';
}

function renderPostCard(post) {
    const liked = post.userLiked;
    const heart = liked ?
        '<svg viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' :
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    const npcComments = (post.comments || []).slice(0, 3).map((c, i) =>
        `<div class="comment"><div class="comment-content"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div><button class="comment-del" data-post="${post.id}" data-type="npc" data-idx="${i}">✕</button></div>`).join("");
    const userComments = (post.userComments || []).map((c, i) =>
        `<div class="comment"><div class="comment-content"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div><button class="comment-del" data-post="${post.id}" data-type="user" data-idx="${i}">✕</button></div>`).join("");
    const totalComments = (post.comments ? post.comments.length : 0) + (post.userComments ? post.userComments.length : 0);
    const moreComments = totalComments > 3 ? `<div class="empty-small" style="padding:4px 14px;text-align:left">ดูคอมเมนต์ทั้งหมด ${totalComments} รายการ</div>` : "";
    const hashtagHtml = (post.hashtags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");

    return `<article class="post" data-post="${post.id}">
        <header class="post-head">
            <div class="post-user" data-npc="${post.authorId || ''}">
                <img class="avatar" src="${escapeHtml(post.authorAvatar)}" onerror="this.src='${defaultAvatar(post.author)}'"/>
                <div class="post-user-info"><div class="username">${escapeHtml(post.authorUsername || post.author)}</div>
                ${post.mood ? `<div class="post-mood">${escapeHtml(post.mood)}</div>` : ""}</div>
            </div>
            <div class="post-menu" data-post="${post.id}">⋯
                <div class="post-menu-dropdown" data-dropdown="${post.id}">
                    <div class="post-menu-item danger" data-del-post="${post.id}">🗑 ลบโพสต์</div>
                </div>
            </div>
        </header>
        <div class="post-image-wrap"><img class="post-image" src="${escapeHtml(post.image)}" loading="lazy"/></div>
        <div class="post-actions">
            <button class="act-btn like-btn" data-post="${post.id}">${heart}</button>
            <button class="act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            <button class="act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
            <button class="act-btn save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        </div>
        <div class="post-likes">${post.likes.toLocaleString()} คนกดใจ</div>
        <div class="post-caption"><b>${escapeHtml(post.authorUsername || post.author)}</b> ${escapeHtml(post.caption)} ${hashtagHtml}</div>
        <div class="post-comments">${npcComments}${userComments}</div>
        ${moreComments}
        <div class="post-time">${timeAgo(post.timestamp)}ที่แล้ว</div>
        <div class="comment-box">
            <input type="text" class="comment-input" data-post="${post.id}" placeholder="เพิ่มความคิดเห็น..."/>
            <button class="comment-post" data-post="${post.id}">โพสต์</button>
        </div>
    </article>`;
}

function attachFeedHandlers() {
    shadowRoot.querySelectorAll(".like-btn").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(btn.dataset.post); });
    });
    shadowRoot.querySelectorAll(".post-user").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const npcId = el.dataset.npc;
            if (!npcId) return;
            const data = getCharData();
            if (data) { data.selectedProfile = npcId; renderNpcProfile(npcId); }
        });
    });
    shadowRoot.querySelectorAll(".story").forEach(el => {
        el.addEventListener("click", () => {
            const data = getCharData();
            if (data) { data.selectedProfile = el.dataset.npc; renderNpcProfile(el.dataset.npc); }
        });
    });
    shadowRoot.querySelectorAll(".comment-post").forEach(btn => {
        btn.addEventListener("click", () => addUserComment(btn.dataset.post));
    });
    shadowRoot.querySelectorAll(".comment-input").forEach(inp => {
        inp.addEventListener("keypress", (e) => { if (e.key === "Enter") addUserComment(inp.dataset.post); });
    });
    shadowRoot.querySelectorAll(".post-menu").forEach(menu => {
        menu.addEventListener("click", (e) => {
            e.stopPropagation();
            const dd = menu.querySelector(".post-menu-dropdown");
            shadowRoot.querySelectorAll(".post-menu-dropdown.show").forEach(d => { if (d !== dd) d.classList.remove("show"); });
            dd.classList.toggle("show");
        });
    });
    shadowRoot.querySelectorAll("[data-del-post]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const pid = btn.dataset.delPost;
            if (!confirm("ลบโพสต์นี้?")) return;
            deletePost(pid);
        });
    });
    shadowRoot.querySelectorAll(".comment-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteComment(btn.dataset.post, btn.dataset.type, parseInt(btn.dataset.idx));
        });
    });
    shadowRoot.getElementById("view").addEventListener("click", () => {
        shadowRoot.querySelectorAll(".post-menu-dropdown.show").forEach(d => d.classList.remove("show"));
    });
}

function toggleLike(postId) {
    const data = getCharData();
    if (!data) return;
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;
    post.userLiked = !post.userLiked;
    post.likes += post.userLiked ? 1 : -1;
    save();
    renderCurrentTab();
}

function addUserComment(postId) {
    const data = getCharData();
    if (!data) return;
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;
    const input = shadowRoot.querySelector('.comment-input[data-post="' + postId + '"]');
    if (!input || !input.value.trim()) return;
    post.userComments = post.userComments || [];
    post.userComments.push({ username: data.userProfile.username || getUserName(), text: input.value.trim(), timestamp: Date.now() });
    input.value = "";
    save();
    renderCurrentTab();
}

function deletePost(postId) {
    const data = getCharData();
    if (!data) return;
    data.posts = data.posts.filter(p => p.id !== postId);
    save();
    renderCurrentTab();
    toast("ลบโพสต์แล้ว");
}

function deleteComment(postId, type, idx) {
    const data = getCharData();
    if (!data) return;
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;
    if (type === "npc") post.comments.splice(idx, 1);
    else post.userComments.splice(idx, 1);
    save();
    renderCurrentTab();
}

function renderNpcProfile(npcId) {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const npc = findNpc(npcId);
    if (!npc) { data.selectedProfile = null; renderCurrentTab(); return; }
    const view = shadowRoot.getElementById("view");
    const posts = data.posts.filter(p => p.authorId === npcId).reverse();

    view.innerHTML = `<div class="profile-head">
        <button class="back-btn" id="back">←</button>
        <div class="profile-username">${escapeHtml(npc.username)}</div><div></div>
    </div>
    <div class="profile-body">
        <div class="profile-top">
            <div class="profile-avatar-wrap">
                <img class="profile-avatar" src="${escapeHtml(npc.avatar)}" onerror="this.src='${defaultAvatar(npc.name)}'"/>
                <label class="avatar-change" title="เปลี่ยนรูป NPC">📷<input type="file" id="npc-prof-avatar-file" accept="image/*" style="display:none"/></label>
            </div>
            <div class="profile-stats">
                <div><b>${posts.length}</b><span>โพสต์</span></div>
                <div><b>${npc.followers.toLocaleString()}</b><span>ผู้ติดตาม</span></div>
                <div><b>${npc.following.toLocaleString()}</b><span>กำลังติดตาม</span></div>
            </div>
        </div>
        <div class="profile-name">${escapeHtml(npc.displayName)}</div>
        ${npc.role ? `<div style="font-size:11px;color:#0095f6;margin-bottom:6px">👤 Role: ${escapeHtml(npc.role)}</div>` : ""}
        <div class="profile-bio">${escapeHtml(npc.bio || "")}</div>
        <div class="profile-actions">
            <button class="follow-btn ${npc.userFollowing ? "following" : ""}" id="follow">${npc.userFollowing ? "กำลังติดตาม" : "ติดตาม"}</button>
            <button class="msg-btn" id="msg">ข้อความ</button>
            <button class="action-btn" id="edit-npc-btn" style="flex:0;padding:8px 14px">✎</button>
        </div>
        <div class="profile-grid">
            ${posts.length === 0 ? '<div class="empty-small">ยังไม่มีโพสต์</div>' :
                posts.map(p => `<div class="grid-item"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")}
        </div>
    </div>`;

    // ✅ เปลี่ยนรูป avatar NPC จากหน้าโปรไฟล์ NPC ได้เลย
    shadowRoot.getElementById("npc-prof-avatar-file").addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 3 * 1024 * 1024) { toast("รูปใหญ่เกิน 3MB"); return; }
        const r = new FileReader();
        r.onload = (ev) => {
            npc.avatar = ev.target.result;
            save();
            toast("✓ เปลี่ยนรูป NPC แล้ว");
            renderNpcProfile(npcId);
        };
        r.readAsDataURL(f);
    });

    shadowRoot.getElementById("back").addEventListener("click", () => { data.selectedProfile = null; renderCurrentTab(); });
    shadowRoot.getElementById("follow").addEventListener("click", () => {
        npc.userFollowing = !npc.userFollowing;
        npc.followers += npc.userFollowing ? 1 : -1;
        save();
        renderNpcProfile(npcId);
    });
    shadowRoot.getElementById("msg").addEventListener("click", () => {
        getGlobal().currentTab = "dm";
        data.selectedProfile = null;
        save();
        openDM(npcId);
    });
    shadowRoot.getElementById("edit-npc-btn").addEventListener("click", () => {
        openNpcModal(npcId);
    });
}

function renderDiscover() {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const view = shadowRoot.getElementById("view");
    const posts = [...data.posts].reverse();
    view.innerHTML =
        '<div class="search-bar"><input type="text" placeholder="ค้นหา"/></div>' +
        '<div class="discover-grid">' +
            (posts.length === 0 ? '<div class="empty-small" style="grid-column:1/-1">ยังไม่มีโพสต์</div>' :
                posts.map(p => `<div class="grid-item" data-npc="${p.authorId || ''}"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")) +
        '</div>';
    shadowRoot.querySelectorAll(".grid-item").forEach(el => {
        el.addEventListener("click", () => {
            const npcId = el.dataset.npc;
            if (!npcId) return;
            data.selectedProfile = npcId;
            renderNpcProfile(npcId);
        });
    });
}

function renderCompose() {
    if (!shadowRoot) return;
    const view = shadowRoot.getElementById("view");
    view.innerHTML = `<div class="compose">
        <div class="compose-title">โพสต์ใหม่ (ในฐานะ ${escapeHtml(getUserName())})</div>
        <div id="compose-preview" style="display:none;margin-bottom:8px;border-radius:8px;overflow:hidden;background:#121212">
            <img id="compose-preview-img" style="width:100%;max-height:300px;object-fit:cover;display:block"/>
            <button id="compose-remove" style="width:100%;padding:6px;background:#262626;color:#ed4956;border:none;cursor:pointer;font-size:12px">✕ ลบรูป</button>
        </div>
        <label class="primary-btn" style="text-align:center;cursor:pointer;margin:0;background:#262626;color:#f5f5f5">📷 เลือกรูปจากเครื่อง
            <input type="file" id="compose-file" accept="image/*" style="display:none"/></label>
        <textarea id="compose-caption" placeholder="เขียน caption..." rows="3"></textarea>
        <label class="compose-label">หรือใช้ AI สร้างรูป (prompt ภาษาอังกฤษ):</label>
        <input type="text" id="compose-image" placeholder="sunset beach aesthetic..."/>
        <div class="compose-hint">ถ้าไม่มีรูป + ไม่มี prompt จะ random ภาพสวยๆ</div>
        <button id="compose-post" class="primary-btn">โพสต์</button>
        <div id="compose-status" style="font-size:13px;color:#a8a8a8;text-align:center"></div>
    </div>`;
    let uploaded = null;
    const fi = shadowRoot.getElementById("compose-file");
    const prev = shadowRoot.getElementById("compose-preview");
    const pimg = shadowRoot.getElementById("compose-preview-img");
    fi.addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { toast("รูปใหญ่เกิน 5MB"); return; }
        const r = new FileReader();
        r.onload = (ev) => { uploaded = ev.target.result; pimg.src = uploaded; prev.style.display = "block"; };
        r.readAsDataURL(f);
    });
    shadowRoot.getElementById("compose-remove").addEventListener("click", () => {
        uploaded = null; fi.value = ""; prev.style.display = "none";
    });
    shadowRoot.getElementById("compose-post").addEventListener("click", () => submitUserPost(uploaded));
}

async function submitUserPost(uploadedImage) {
    const data = getCharData();
    if (!data) return;
    const caption = shadowRoot.getElementById("compose-caption").value.trim();
    const imgInput = shadowRoot.getElementById("compose-image").value.trim();
    const statusEl = shadowRoot.getElementById("compose-status");
    let imageUrl, imagePrompt = "";
    if (uploadedImage) { imageUrl = uploadedImage; imagePrompt = caption || "user photo"; }
    else if (imgInput.startsWith("http")) { imageUrl = imgInput; imagePrompt = caption; }
    else { imagePrompt = imgInput || caption || "aesthetic mood photo cinematic"; imageUrl = makeImageUrl(imagePrompt); }

    const userName = getUserName();
    const post = {
        id: uid("p"), authorId: null, author: userName,
        authorUsername: data.userProfile.username || sanitizeUsername(userName),
        authorAvatar: data.userProfile.avatar || defaultAvatar(userName),
        caption, hashtags: [], image: imageUrl, imagePrompt,
        timestamp: Date.now(), likes: 0, userLiked: false,
        comments: [], userComments: [], isUserPost: true,
    };
    data.posts.push(post);
    save();
    statusEl.textContent = "โพสต์แล้ว — กำลังรอตัวละคร react...";
    for (const npc of data.npcs) {
        try {
            const reaction = await generateReactionToUser(npc, post);
            if (reaction && reaction.like) post.likes++;
            if (reaction && reaction.comment) post.comments.push({ username: npc.username, text: reaction.comment, timestamp: Date.now() });
            save();
        } catch {}
    }
    statusEl.textContent = "✓ ตัวละคร react แล้ว";
    setTimeout(() => { getGlobal().currentTab = "feed"; renderCurrentTab(); updateNavActive(); }, 800);
}

function renderDMList() {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const view = shadowRoot.getElementById("view");
    const npcsWithDms = data.npcs;
    view.innerHTML = `<div class="dm-header"><div class="dm-title">ข้อความ</div></div>
    <div class="dm-list">
        ${npcsWithDms.length === 0 ? '<div class="empty-small">ยังไม่มีตัวละคร</div>' :
            npcsWithDms.map(n => {
                const thread = data.dms[n.id] || [];
                const last = thread[thread.length - 1];
                return `<div class="dm-item" data-npc="${n.id}">
                    <img class="avatar" src="${escapeHtml(n.avatar)}" onerror="this.src='${defaultAvatar(n.name)}'"/>
                    <div class="dm-info">
                        <div class="dm-name">${escapeHtml(n.displayName)}</div>
                        <div class="dm-preview">${last ? escapeHtml(last.text.slice(0, 50)) : "เริ่มคุย..."}</div>
                    </div>
                    ${thread.length > 0 ? `<button class="dm-item-del" data-clear="${n.id}" title="ลบประวัติแชท">🗑</button>` : ""}
                </div>`;
            }).join("")}
    </div>`;
    shadowRoot.querySelectorAll(".dm-item").forEach(el => {
        el.addEventListener("click", (e) => {
            if (e.target.classList.contains("dm-item-del")) return;
            openDM(el.dataset.npc);
        });
    });
    shadowRoot.querySelectorAll(".dm-item-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.dataset.clear;
            if (!confirm("ลบประวัติแชทนี้?")) return;
            delete data.dms[id];
            save();
            renderDMList();
            toast("ลบแชทแล้ว ✓");
        });
    });
}

function openDM(npcId) {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const npc = findNpc(npcId);
    if (!npc) return;
    const view = shadowRoot.getElementById("view");
    const thread = data.dms[npcId] || [];
    view.innerHTML = `<div class="dm-chat-head">
        <button class="back-btn" id="back">←</button>
        <img class="avatar" src="${escapeHtml(npc.avatar)}" onerror="this.src='${defaultAvatar(npc.name)}'"/>
        <div class="dm-chat-name">${escapeHtml(npc.displayName)}</div>
        <button class="dm-clear-btn" id="clear-thread">🗑 ลบ</button>
    </div>
    <div class="dm-thread" id="dm-thread">
        ${thread.map((m, i) => `<div class="dm-msg ${m.from === "user" ? "user" : "char"}">
            ${escapeHtml(m.text)}<button class="msg-del" data-idx="${i}">✕</button></div>`).join("")}
        ${thread.length === 0 ? '<div class="empty-small">ส่งข้อความแรกเลย</div>' : ""}
    </div>
    <div class="dm-input-wrap">
        <input type="text" id="dm-input" placeholder="ข้อความ..."/>
        <button id="dm-send">ส่ง</button>
    </div>`;
    shadowRoot.getElementById("back").addEventListener("click", () => { getGlobal().currentTab = "dm"; renderCurrentTab(); });
    shadowRoot.getElementById("clear-thread").addEventListener("click", () => {
        if (!confirm("ลบประวัติแชทกับ " + npc.name + "?")) return;
        delete data.dms[npcId];
        save();
        openDM(npcId);
    });
    shadowRoot.querySelectorAll(".msg-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.idx);
            data.dms[npcId].splice(i, 1);
            save();
            openDM(npcId);
        });
    });
    const send = async () => {
        const inp = shadowRoot.getElementById("dm-input");
        const text = inp.value.trim();
        if (!text) return;
        data.dms[npcId] = data.dms[npcId] || [];
        data.dms[npcId].push({ from: "user", text, timestamp: Date.now() });
        inp.value = "";
        save();
        openDM(npcId);
        await generateDMReply(npcId);
        openDM(npcId);
    };
    shadowRoot.getElementById("dm-send").addEventListener("click", send);
    shadowRoot.getElementById("dm-input").addEventListener("keypress", (e) => { if (e.key === "Enter") send(); });
    const tEl = shadowRoot.getElementById("dm-thread");
    if (tEl) tEl.scrollTop = tEl.scrollHeight;
}

function renderMyProfile() {
    if (!shadowRoot) return;
    const data = getCharData();
    if (!data) return;
    const view = shadowRoot.getElementById("view");
    const userName = getUserName();
    const myPosts = data.posts.filter(p => p.isUserPost).reverse();
    const up = data.userProfile;

    view.innerHTML = `<div class="profile-head">
        <div></div><div class="profile-username">${escapeHtml(up.username || userName)}</div><div></div>
    </div>
    <div class="profile-body">
        <div class="profile-top">
            <div class="profile-avatar-wrap">
                <img class="profile-avatar" id="my-avatar-img" src="${escapeHtml(up.avatar || defaultAvatar(userName))}"/>
                <label class="avatar-change" title="เปลี่ยนรูป">📷<input type="file" id="my-avatar-file" accept="image/*" style="display:none"/></label>
            </div>
            <div class="profile-stats">
                <div><b>${myPosts.length}</b><span>โพสต์</span></div>
                <div><b>${data.npcs.filter(n => n.userFollowing).length}</b><span>ผู้ติดตาม</span></div>
                <div><b>0</b><span>กำลังติดตาม</span></div>
            </div>
        </div>
        <label class="compose-label">Username (IG handle)</label>
        <input class="inline-input" id="my-username" placeholder="your_ig_handle" value="${escapeHtml(up.username || "")}"/>
        <label class="compose-label" style="margin-top:8px">Display Name</label>
        <input class="inline-input" id="my-name" placeholder="ชื่อที่แสดง" value="${escapeHtml(up.displayName || userName)}"/>
        <label class="compose-label" style="margin-top:8px">Bio</label>
        <textarea class="inline-input" id="my-bio" rows="2" placeholder="ไบโอ...">${escapeHtml(up.bio || "")}</textarea>
        <button class="primary-btn" id="save-profile">💾 บันทึกโปรไฟล์</button>

        <h3 style="margin-top:24px;font-size:15px">📋 ตัวละครใน IG (${data.npcs.length})</h3>
        <div class="compose-hint" style="margin-bottom:8px">✅ ตัวละครเหล่านี้จะโพสต์เองอัตโนมัติ!</div>
        <div id="npc-list">
            ${data.npcs.map(n => `<div class="npc-item">
                <img class="avatar" src="${escapeHtml(n.avatar)}" onerror="this.src='${defaultAvatar(n.name)}'"/>
                <div class="npc-info">
                    <div class="npc-name">${escapeHtml(n.name)}</div>
                    ${n.role ? `<div class="npc-role">Role: ${escapeHtml(n.role)}</div>` : ""}
                    <div class="npc-bio">${escapeHtml(n.bio || "(no bio)")}</div>
                </div>
                <button class="comment-del" data-edit-npc="${n.id}" title="แก้ไข">✎</button>
                <button class="comment-del" data-del-npc="${n.id}" title="ลบ">🗑</button>
            </div>`).join("")}
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="secondary-btn" id="add-npc" style="flex:1">+ เพิ่มตัวละคร</button>
            <button class="secondary-btn" id="scan-npcs" style="flex:1;background:linear-gradient(45deg,#1a1a2e,#16213e);border:1px solid #0095f6;color:#0095f6">🔍 สแกน Lorebook</button>
        </div>
        <div id="scan-status" style="font-size:12px;color:#a8a8a8;text-align:center;padding:4px 0;min-height:18px"></div>

        <div class="profile-grid" style="margin-top:16px">
            ${myPosts.map(p => `<div class="grid-item"><img src="${escapeHtml(p.image)}"/></div>`).join("")}
        </div>
    </div>`;

    shadowRoot.getElementById("my-avatar-file").addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 3 * 1024 * 1024) { toast("รูปใหญ่เกิน 3MB"); return; }
        const r = new FileReader();
        r.onload = (ev) => {
            data.userProfile.avatar = ev.target.result;
            save();
            shadowRoot.getElementById("my-avatar-img").src = ev.target.result;
            toast("✓ อัพโหลดรูปแล้ว");
        };
        r.readAsDataURL(f);
    });

    shadowRoot.getElementById("save-profile").addEventListener("click", () => {
        data.userProfile.username = shadowRoot.getElementById("my-username").value.trim() || sanitizeUsername(userName);
        data.userProfile.displayName = shadowRoot.getElementById("my-name").value.trim() || userName;
        data.userProfile.bio = shadowRoot.getElementById("my-bio").value.trim();
        save();
        toast("✓ บันทึกโปรไฟล์แล้ว");
    });

    shadowRoot.getElementById("add-npc").addEventListener("click", () => openNpcModal(null));
    shadowRoot.querySelectorAll("[data-edit-npc]").forEach(b => b.addEventListener("click", () => openNpcModal(b.dataset.editNpc)));
    shadowRoot.querySelectorAll("[data-del-npc]").forEach(b => b.addEventListener("click", () => {
        const id = b.dataset.delNpc;
        const npc = findNpc(id);
        if (!npc) return;
        if (!confirm("ลบตัวละคร " + npc.name + " + โพสต์/DM ของเขา?")) return;
        deleteNpc(id);
        renderMyProfile();
    }));

    // ✅ ปุ่มสแกน Lorebook
    shadowRoot.getElementById("scan-npcs").addEventListener("click", async () => {
        const statusEl = shadowRoot.getElementById("scan-status");
        const btn = shadowRoot.getElementById("scan-npcs");
        btn.disabled = true;
        btn.textContent = "⏳ กำลังสแกน...";
        const added = await extractNpcsFromLorebook((msg) => {
            if (statusEl) statusEl.textContent = msg;
        });
        btn.disabled = false;
        btn.textContent = "🔍 สแกน Lorebook";
        if (added.length > 0) {
            toast(`✅ เพิ่ม NPC ใหม่ ${added.length} ตัว: ${added.map(n => n.name).join(", ")}`);
            renderMyProfile();
        } else {
            if (statusEl) statusEl.textContent = "ไม่พบ NPC ใหม่";
            setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
        }
    });
}

// ✅ FIXED: openNpcModal พร้อม role dropdown + avatar preview
function openNpcModal(npcId) {
    const data = getCharData();
    if (!data) return;
    const npc = npcId ? findNpc(npcId) : null;

    const roleOptions = Object.keys(ROLE_KEYWORDS).map(r =>
        `<option value="${r}" ${npc && npc.role === r ? "selected" : ""}>${r}</option>`
    ).join("");

    showModal(`<h3>${npc ? "แก้ไข" : "เพิ่ม"}ตัวละคร</h3>
        <div class="row">
            <label>ชื่อตัวละคร *</label>
            <input class="inline-input" id="npc-name" value="${npc ? escapeHtml(npc.name) : ""}"/>
        </div>
        <div class="row">
            <label>คำอธิบาย (LLM จะใช้อันนี้จับสไตล์การพูด)</label>
            <textarea class="inline-input" id="npc-desc" rows="4" placeholder="เช่น: เจ้าชู้ พูดกู-มึง ชอบยั่ว...">${npc ? escapeHtml(npc.description || "") : ""}</textarea>
        </div>
        <div class="row">
            <label>Bio สำหรับ IG (สั้นๆ)</label>
            <input class="inline-input" id="npc-bio" value="${npc ? escapeHtml(npc.bio || "") : ""}" placeholder="bio IG"/>
        </div>
        <div class="row">
            <label>Role / ความสัมพันธ์</label>
            <select class="inline-input" id="npc-role" style="height:40px;cursor:pointer">
                <option value="" ${!npc || !npc.role ? "selected" : ""}>-- ตรวจจับอัตโนมัติ --</option>
                ${roleOptions}
            </select>
        </div>
        <div class="row">
            <label>รูปโปรไฟล์</label>
            <label style="display:block;padding:10px;background:#262626;border-radius:8px;text-align:center;cursor:pointer;margin-bottom:8px">
                📷 อัพโหลดรูป
                <input type="file" id="npc-avatar-file" accept="image/*" style="display:none"/>
            </label>
            <img id="npc-avatar-preview" src="${npc && npc.avatar ? escapeHtml(npc.avatar) : ""}"
                style="${npc && npc.avatar ? "" : "display:none;"}width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid #262626;display:${npc && npc.avatar ? "block" : "none"}"/>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
            <button class="secondary-btn" id="npc-cancel" style="flex:1">ยกเลิก</button>
            <button class="primary-btn" id="npc-save" style="flex:1;margin:0">บันทึก</button>
        </div>`);

    let avatarData = npc ? npc.avatar : null;

    shadowRoot.getElementById("npc-avatar-file").addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 3 * 1024 * 1024) { toast("รูปใหญ่เกิน 3MB"); return; }
        const r = new FileReader();
        r.onload = (ev) => {
            avatarData = ev.target.result;
            const img = shadowRoot.getElementById("npc-avatar-preview");
            img.src = avatarData;
            img.style.display = "block";
        };
        r.readAsDataURL(f);
    });

    shadowRoot.getElementById("npc-cancel").addEventListener("click", closeModal);

    shadowRoot.getElementById("npc-save").addEventListener("click", () => {
        const name = shadowRoot.getElementById("npc-name").value.trim();
        const desc = shadowRoot.getElementById("npc-desc").value.trim();
        const bio = shadowRoot.getElementById("npc-bio").value.trim();
        const roleVal = shadowRoot.getElementById("npc-role").value;
        if (!name) { toast("ใส่ชื่อตัวละคร"); return; }

        if (npc) {
            npc.name = name;
            npc.displayName = name;
            npc.description = desc;
            npc.bio = bio;
            npc.role = roleVal || detectRole(npc, desc, getRecentChat(20), getLoreBookContext()) || npc.role;
            if (avatarData) npc.avatar = avatarData;
        } else {
            const newNpc = createNpc(name, desc, "");
            newNpc.bio = bio;
            newNpc.role = roleVal || newNpc.role;
            if (avatarData) newNpc.avatar = avatarData;
        }
        save();
        closeModal();
        renderMyProfile();
        toast("✓ บันทึกแล้ว");
    });
}

// ---------- Event hooks ----------
async function onMessageReceived() {
    try {
        const g = getGlobal();
        if (!g.autoPost) { log("Auto-post disabled", false); return; }
        const ctx = getContext();
        const chat = ctx.chat || [];
        const msg = chat[chat.length - 1];
        if (!msg || msg.is_user || msg.is_system) { log("Skipped: user/system message", false); return; }
        if (Math.random() > g.postChance) { log(`Random skip: ${Math.round(g.postChance * 100)}% chance`, false); return; }
        let npc = msg.name ? findNpcByName(msg.name) : null;
        if (!npc) npc = ensureNpcFromCharacterCard();
        if (!npc) { log("Auto-post skipped: no NPC found", true); return; }
        log(`🤖 Auto-posting for: ${npc.name} (Role: ${npc.role || "unknown"})`);
        await generatePostFor(npc, msg.mes || "");
    } catch (e) { log("message handler: " + e.message, true); }
}

function onChatChanged() {
    try {
        const data = getCharData();
        if (data) ensureNpcFromCharacterCard();
        updateBadge();
        if (isPanelOpen()) renderCurrentTab();
    } catch {}
}

// ---------- Ambient ----------
let ambientTimer = null;
async function runAmbient() {
    const g = getGlobal();
    if (!g.ambientEnabled) return;
    const data = getCharData();
    if (!data || data.npcs.length === 0) return;
    const npc = data.npcs[Math.floor(Math.random() * data.npcs.length)];
    const userPosts = data.posts.filter(p => p.isUserPost).slice(-5);
    const roll = Math.random();
    try {
        if (roll < 0.35 && userPosts.length > 0) {
            const target = userPosts[Math.floor(Math.random() * userPosts.length)];
            const r = await generateReactionToUser(npc, target);
            if (r && r.comment) {
                target.comments.push({ username: npc.username, text: r.comment, timestamp: Date.now() });
                if (r.like) target.likes++;
                data.unreadCount++;
                save();
                flashIcon();
                if (isPanelOpen()) renderCurrentTab();
            }
        } else if (roll < 0.6 && userPosts.length > 0) {
            userPosts[Math.floor(Math.random() * userPosts.length)].likes++;
            data.unreadCount++;
            save();
            flashIcon();
        } else if (roll < 0.85) {
            const prompt = `[Ambient DM]\n${buildCharContext(npc)}\n\nCharacter "${npc.name}" randomly DMs ${getUserName()} out of the blue. Short Thai message (1-2 sentences), matching their speech style.\n\nReply directly. No JSON. No prefix. Just the message.`;
            try {
                const r = await callLLM(prompt, "You are " + npc.name + ". Stay in character.");
                const reply = (r || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 300);
                if (reply) {
                    data.dms[npc.id] = data.dms[npc.id] || [];
                    data.dms[npc.id].push({ from: "char", text: reply, timestamp: Date.now() });
                    data.unreadCount++;
                    save();
                    flashIcon();
                }
            } catch {}
        } else {
            await generatePostFor(npc, "");
        }
    } catch (e) { log("ambient: " + e.message, true); }
}

function scheduleAmbient() {
    stopAmbient();
    const g = getGlobal();
    if (!g.ambientEnabled) return;
    const delay = 300000 + Math.random() * 600000;
    ambientTimer = setTimeout(async () => { await runAmbient(); scheduleAmbient(); }, delay);
}
function stopAmbient() { if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; } }

// ---------- Settings UI ----------
async function loadSettingsUI() {
    try {
        const html = await $.get(extensionFolderPath + "/settings.html");
        if (!html || html.length < 100) { log("Settings HTML seems incomplete", true); return; }
        $("#extensions_settings2").append(html);
        const g = getGlobal();
        $("#instachar-toggle-icon").prop("checked", g.iconVisible);
        $("#instachar-toggle-autopost").prop("checked", g.autoPost);
        $("#instachar-toggle-ambient").prop("checked", g.ambientEnabled);
        $("#instachar-chance-slider").val(Math.round(g.postChance * 100));
        $("#instachar-chance-val").text(Math.round(g.postChance * 100) + "%");
        $("#instachar-debug-log").text(debugLog.slice(-14).join("\n"));
        log("Settings UI loaded ✓", false);
    } catch (e) { log("loadSettingsUI: " + e.message, true); }
}

function attachDelegation() {
    $(document).off(".instachar")
        .on("change.instachar", "#instachar-toggle-icon", function () {
            getGlobal().iconVisible = $(this).prop("checked");
            save(); setFloaterVisible(getGlobal().iconVisible);
        })
        .on("change.instachar", "#instachar-toggle-autopost", function () {
            getGlobal().autoPost = $(this).prop("checked");
            save();
            log("Auto-post: " + ($(this).prop("checked") ? "ON ✓" : "OFF"), false);
        })
        .on("change.instachar", "#instachar-toggle-ambient", function () {
            getGlobal().ambientEnabled = $(this).prop("checked");
            save();
            if (getGlobal().ambientEnabled) scheduleAmbient(); else stopAmbient();
        })
        .on("input.instachar", "#instachar-chance-slider", function () {
            const v = parseInt($(this).val());
            getGlobal().postChance = v / 100;
            $("#instachar-chance-val").text(v + "%"); save();
        })
        .on("click.instachar", "#instachar-open-btn", openPanel)
        .on("click.instachar", "#instachar-find-btn", findIcon)
        .on("click.instachar", "#instachar-reset-pos-btn", resetIconPos)
        .on("click.instachar", "#instachar-reset-char-btn", function () {
            const key = getCharKey();
            if (!key) { toast("ไม่ได้อยู่ใน character chat"); return; }
            if (!confirm("ลบข้อมูล InstaChar ของ character นี้?")) return;
            delete getGlobal().characters[key];
            save();
            if (isPanelOpen()) renderCurrentTab();
            toast("ลบแล้ว");
        })
        .on("click.instachar", "#instachar-reset-all-btn", function () {
            if (!confirm("ลบข้อมูล InstaChar ทั้งหมด? ย้อนไม่ได้!")) return;
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_GLOBAL));
            save();
            if (isPanelOpen()) renderCurrentTab();
            toast("ลบทั้งหมดแล้ว");
        });
}

// ---------- Init ----------
jQuery(async () => {
    log("InstaChar v" + VERSION + " init...");
    try {
        getGlobal();
        attachDelegation();
        await loadSettingsUI();
        mountUI();
        if (eventSource && event_types) {
            try {
                if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
                if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
            } catch (e) { log("event bind: " + e.message, true); }
        }
        if (getGlobal().ambientEnabled) scheduleAmbient();
        log("✅ Ready! v" + VERSION + " — Modal Fix + Lorebook Scan + Role Editor");
    } catch (e) { log("Init FAILED: " + e.message, true); }
});
