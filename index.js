/* InstaChar v0.3.0 — Character Instagram for SillyTavern */

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "Instachar";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const VERSION = "0.3.0";

const DEFAULT_SETTINGS = {
    iconVisible: true,
    autoPost: true,
    ambientEnabled: true,
    postChance: 0.35,
    imageModel: "flux",
    iconPos: null,
    posts: [],
    dms: {},
    userProfile: { username: "", displayName: "", bio: "", avatar: "" },
    charProfiles: {},
    unreadCount: 0,
    currentTab: "feed",
};

// ---------- Logging ----------
const debugLog = [];
function log(msg, isError) {
    const ts = new Date().toLocaleTimeString();
    const line = "[" + ts + "] " + (isError ? "ERR " : "OK  ") + msg;
    debugLog.push(line);
    if (debugLog.length > 60) debugLog.shift();
    if (isError) console.error("[InstaChar] " + msg);
    else console.log("[InstaChar] " + msg);
    const $dbg = $("#instachar-debug-log");
    if ($dbg.length) $dbg.text(debugLog.slice(-12).join("\n"));
}

// ---------- Settings ----------
function getSettings() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }
        const s = extension_settings[extensionName];
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
            if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k]));
        }
        return s;
    } catch (e) {
        log("getSettings err: " + e.message, true);
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

function save() {
    try { saveSettingsDebounced(); } catch (e) { log("save err: " + e.message, true); }
}

// ---------- Utility ----------
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
    const colors = ["#e91e63","#9c27b0","#3f51b5","#00bcd4","#4caf50","#ff9800","#f44336"];
    const color = colors[(name || "").length % colors.length];
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect fill='" + color + "' width='80' height='80'/><text x='40' y='52' font-size='36' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>" + initial + "</text></svg>";
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function sanitizeUsername(name) {
    if (!name) return "user_" + Math.floor(Math.random() * 9999);
    return name.toLowerCase().replace(/[^a-z0-9_\u0e00-\u0e7f]/g, "").slice(0, 20) || "user";
}

function makeImageUrl(prompt, seed) {
    const s = getSettings();
    const p = encodeURIComponent(prompt || "aesthetic photo cinematic");
    return "https://image.pollinations.ai/prompt/" + p + "?width=768&height=768&nologo=true&model=" + s.imageModel + "&seed=" + (seed || Math.floor(Math.random() * 99999));
}

function getCurrentCharacterName() {
    try {
        const ctx = getContext();
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            return (ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].name) || null;
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

function getCharacterAvatar(charName) {
    try {
        const ctx = getContext();
        const ch = ctx.characters.find(c => c.name === charName);
        if (ch && ch.avatar && ch.avatar !== "none") return "/characters/" + ch.avatar;
    } catch (e) {}
    return defaultAvatar(charName);
}

function ensureCharProfile(charName) {
    if (!charName) return null;
    const s = getSettings();
    if (!s.charProfiles[charName]) {
        let bio = "";
        try {
            const ctx = getContext();
            const ch = ctx.characters.find(c => c.name === charName);
            bio = (ch && ch.description) ? ch.description.slice(0, 150) : "";
        } catch {}
        s.charProfiles[charName] = {
            username: sanitizeUsername(charName) + "_" + Math.floor(Math.random() * 99),
            displayName: charName,
            bio: bio,
            avatar: getCharacterAvatar(charName),
            followers: Math.floor(Math.random() * 5000) + 100,
            following: Math.floor(Math.random() * 500) + 50,
            postCount: 0,
            userFollowing: false,
            followsUser: false,
        };
        save();
    }
    return s.charProfiles[charName];
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

    const sysPrompt = systemPrompt || "You are a data assistant. Respond with valid JSON only. No markdown fences. No explanations.";

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

// ---------- Post Generation ----------
async function maybeGeneratePost(charName, messageText) {
    const s = getSettings();
    if (!s.autoPost) return;
    ensureCharProfile(charName);

    const prompt = `[System: Instagram Simulator]
Character "${charName}" just experienced: "${messageText.slice(0, 800)}"

Would they post on Instagram now based on personality?

If YES: {"post": true, "caption": "thai caption", "imagePrompt": "english image prompt describing scene", "hashtags": ["#tag"], "mood": "happy|sad|flirty|chill|excited|moody|proud|angry"}
If NO: {"post": false}

Respond ONLY with JSON.`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !data.post) return;

        const profile = s.charProfiles[charName];
        const likes = Math.max(5, Math.floor((profile.followers || 1000) * (0.3 + Math.random() * 1.4) / 10));

        const post = {
            id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
            author: charName,
            authorUsername: profile.username,
            authorAvatar: profile.avatar,
            caption: data.caption || "",
            hashtags: data.hashtags || [],
            image: makeImageUrl(data.imagePrompt, Date.now()),
            imagePrompt: data.imagePrompt,
            mood: data.mood,
            timestamp: Date.now(),
            likes: likes,
            userLiked: false,
            comments: [],
            userComments: [],
        };

        post.comments = await generateComments(charName, post, messageText);
        profile.postCount = (profile.postCount || 0) + 1;
        s.posts.push(post);
        s.unreadCount = (s.unreadCount || 0) + 1;
        save();
        flashIcon();
        if (isPanelOpen() && s.currentTab === "feed") renderCurrentTab();
        log("Post created by " + charName);
    } catch (e) {
        log("Post gen failed: " + e.message, true);
    }
}

async function generateComments(authorName, post, sceneContext) {
    const userName = getUserName();
    const ctx = getContext();
    const recentMessages = (ctx.chat || []).slice(-10).map(m => m.mes || "").join("\n");

    const prompt = `[System: IG Comments]
Character "${authorName}" posted: "${post.caption}" (mood: ${post.mood})
Scene: "${sceneContext.slice(0, 400)}"
Recent chat: "${recentMessages.slice(-1200)}"

Generate 2-5 Thai IG comments from NPCs in the scene or random followers. NOT from "${userName}" or "${authorName}".

Respond ONLY with JSON array: [{"username":"name","text":"thai comment"}]`;

    try {
        const response = await callLLM(prompt);
        const arr = parseJson(response);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, 6).map(c => ({
            username: c.username || "user_" + Math.floor(Math.random() * 999),
            text: c.text || "",
            timestamp: Date.now(),
        }));
    } catch (e) {
        return [];
    }
}

async function generateCharReaction(charName, userPost) {
    const prompt = `[System: IG Reaction]
User posted: "${userPost.caption}" (image: "${userPost.imagePrompt || 'photo'}")
Character "${charName}" reacts based on their personality and relationship with user.

Respond ONLY with JSON: {"like": true|false, "comment": "thai comment or null"}`;
    try {
        const response = await callLLM(prompt);
        return parseJson(response);
    } catch {
        return { like: Math.random() < 0.5, comment: null };
    }
}

async function generateDMReply(charName) {
    const s = getSettings();
    const thread = s.dms[charName] || [];
    const recent = thread.slice(-8).map(m => (m.from === "user" ? getUserName() : charName) + ": " + m.text).join("\n");
    const prompt = `[System: IG DM]
Roleplay as "${charName}" in private IG DM with ${getUserName()}.

Recent:
${recent}

Reply as ${charName} in Thai, short (1-3 sentences), casual IG DM style. Stay in character.
Reply directly, no JSON, no prefix.`;
    try {
        const response = await callLLM(prompt, "You are a character in a roleplay. Reply in Thai naturally, stay in character.");
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 500);
        if (!reply) return;
        s.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        save();
    } catch (e) {
        log("DM reply failed: " + e.message, true);
    }
}

// ---------- Shadow DOM (Critical for CSS isolation) ----------
let shadowHost = null;
let shadowRoot = null;

function buildShadowHost() {
    const existing = document.getElementById("instachar-shadow-host");
    if (existing) existing.remove();
    shadowHost = document.createElement("div");
    shadowHost.id = "instachar-shadow-host";
    shadowHost.setAttribute("style", "position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;z-index:2147483646 !important;pointer-events:none !important;margin:0 !important;padding:0 !important;border:0 !important;");
    document.documentElement.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: "open" });
    return shadowRoot;
}

const SHADOW_CSS = `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", sans-serif; }
* { box-sizing: border-box; }

/* Floater — positioned below HamHam (HamHam is at top:80px, 60px tall, so InstaChar at top:150px) */
.floater {
    position: fixed;
    right: 16px;
    top: 150px;
    width: 58px;
    height: 58px;
    border-radius: 16px;
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    border: 3px solid #fff;
    box-shadow: 0 8px 24px rgba(220, 39, 67, 0.5), 0 3px 8px rgba(75, 21, 40, 0.2);
    cursor: pointer;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    animation: insta-entry 0.6s ease-out, insta-idle 3.5s ease-in-out 0.6s infinite;
    color: white;
}
.floater.hidden { display: none; }
.floater.pressed { transform: scale(0.92); transition: transform 0.1s; }
.floater.flash { background: red !important; transform: scale(1.5) !important; }
.floater svg { width: 28px; height: 28px; pointer-events: none; }
@keyframes insta-entry { 0% { opacity: 0; transform: scale(0) rotate(-180deg); } 60% { transform: scale(1.2) rotate(10deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes insta-idle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.badge {
    position: absolute;
    top: -6px; right: -6px;
    min-width: 20px; height: 20px;
    padding: 0 6px;
    background: #ff2d55;
    color: white;
    font-size: 11px;
    font-weight: 700;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #000;
}
.badge.hidden { display: none; }

/* Panel - IG style phone */
.overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(6px);
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: insta-fade 0.25s ease-out;
    z-index: 1;
}
.overlay.hidden { display: none; }
@keyframes insta-fade { from { opacity: 0; } to { opacity: 1; } }

.phone {
    width: min(420px, 100vw);
    height: min(820px, 100vh);
    max-height: 100vh;
    background: #000;
    border-radius: 28px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: #f5f5f5;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
    animation: insta-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
    min-height: 0;
}
@keyframes insta-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.statusbar { display: flex; justify-content: space-between; padding: 8px 18px 4px; font-size: 13px; font-weight: 600; flex-shrink: 0; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid #262626; flex-shrink: 0; }
.topbar-title { font-family: "Billabong","Pacifico","Dancing Script",cursive; font-size: 28px; }
.topbar-actions { display: flex; gap: 8px; }
.icon-btn { background: transparent; border: none; color: #f5f5f5; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.icon-btn:hover { background: #121212; }

.screen { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0; }
.screen::-webkit-scrollbar { width: 6px; }
.screen::-webkit-scrollbar-thumb { background: #262626; border-radius: 3px; }

.nav {
    display: flex;
    justify-content: space-around;
    align-items: center;
    border-top: 1px solid #262626;
    padding: 8px 0 10px;
    background: #000;
    flex-shrink: 0;
}
.nav-item { background: transparent; border: none; color: #f5f5f5; cursor: pointer; padding: 6px 12px; opacity: 0.8; }
.nav-item svg { width: 24px; height: 24px; }
.nav-item.active { opacity: 1; transform: scale(1.15); }
.nav-item.active svg { stroke-width: 2.5; }

.stories { display: flex; gap: 14px; padding: 12px 14px; overflow-x: auto; border-bottom: 1px solid #262626; }
.stories::-webkit-scrollbar { display: none; }
.story { flex-shrink: 0; width: 66px; cursor: pointer; text-align: center; }
.story-ring {
    width: 62px; height: 62px; border-radius: 50%;
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    padding: 2px; margin: 0 auto;
}
.story-ring img { width: 100%; height: 100%; border-radius: 50%; border: 2px solid #000; object-fit: cover; display: block; }
.story-name { font-size: 11px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.post { border-bottom: 1px solid #262626; padding-bottom: 8px; }
.post-head { display: flex; align-items: center; padding: 10px 14px; gap: 10px; }
.post-user { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; }
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.post-user-info { display: flex; flex-direction: column; line-height: 1.15; }
.username { font-weight: 600; font-size: 14px; }
.post-mood { font-size: 11px; color: #737373; }
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
.comment { font-size: 14px; line-height: 1.4; padding: 1px 0; }
.comment b { font-weight: 600; margin-right: 4px; }
.comment-more { padding: 2px 14px; font-size: 13px; color: #737373; cursor: pointer; }
.post-time { padding: 4px 14px; font-size: 11px; color: #737373; text-transform: uppercase; }
.comment-box { display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid #121212; margin-top: 6px; gap: 8px; }
.comment-input { flex: 1; background: transparent; border: none; color: #f5f5f5; font-size: 14px; outline: none; padding: 6px 0; }
.comment-input::placeholder { color: #737373; }
.comment-post { background: transparent; border: none; color: #0095f6; font-weight: 600; cursor: pointer; font-size: 14px; }

.empty { padding: 60px 20px; text-align: center; color: #a8a8a8; }
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }
.empty-title { font-size: 18px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; }
.empty-sub { font-size: 13px; line-height: 1.5; color: #737373; }
.empty-small { padding: 40px 20px; text-align: center; color: #737373; font-size: 13px; }

.profile-head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #262626; gap: 8px; }
.back-btn { background: transparent; border: none; color: #f5f5f5; font-size: 22px; cursor: pointer; }
.profile-username { font-weight: 700; font-size: 16px; text-align: center; }
.profile-body { padding: 14px; }
.profile-top { display: flex; align-items: center; gap: 24px; margin-bottom: 14px; }
.profile-avatar { width: 86px; height: 86px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.profile-stats { display: flex; gap: 18px; flex: 1; justify-content: space-around; }
.profile-stats > div { text-align: center; display: flex; flex-direction: column; font-size: 13px; }
.profile-stats b { font-size: 17px; font-weight: 700; }
.profile-stats span { color: #a8a8a8; }
.profile-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.profile-bio { font-size: 13px; line-height: 1.4; margin-bottom: 12px; white-space: pre-wrap; }
.profile-actions { display: flex; gap: 6px; margin-bottom: 14px; }
.follow-btn, .msg-btn { flex: 1; padding: 8px; border-radius: 8px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; }
.follow-btn { background: #0095f6; color: white; }
.follow-btn.following { background: #121212; color: #f5f5f5; }
.msg-btn { background: #121212; color: #f5f5f5; }

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
    font-family: inherit; resize: vertical; box-sizing: border-box;
}
.compose-label { font-size: 12px; color: #a8a8a8; }
.compose-hint { font-size: 11px; color: #737373; }
.primary-btn { padding: 10px; background: #0095f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; }
.danger-btn { padding: 10px; background: transparent; color: #ed4956; border: 1px solid #ed4956; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; }

.dm-header { padding: 14px; }
.dm-title { font-size: 18px; font-weight: 700; }
.dm-list { display: flex; flex-direction: column; }
.dm-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; }
.dm-item:hover { background: #121212; }
.dm-info { flex: 1; min-width: 0; }
.dm-name { font-weight: 600; font-size: 14px; }
.dm-preview { font-size: 13px; color: #a8a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262626; }
.dm-chat-name { font-weight: 600; font-size: 15px; }
.dm-thread { padding: 14px; display: flex; flex-direction: column; gap: 6px; min-height: 300px; }
.dm-msg { max-width: 75%; padding: 8px 12px; border-radius: 18px; font-size: 14px; line-height: 1.35; word-wrap: break-word; }
.dm-msg.user { align-self: flex-end; background: #0095f6; color: white; }
.dm-msg.char { align-self: flex-start; background: #121212; color: #f5f5f5; }
.dm-input-wrap { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #262626; }
.dm-input-wrap input { flex: 1; padding: 10px 14px; border-radius: 20px; background: #121212; border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none; }
.dm-input-wrap button { padding: 8px 16px; background: transparent; color: #0095f6; border: none; font-weight: 700; cursor: pointer; font-size: 14px; }

.settings-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; }
.settings-row input[type="range"] { width: 140px; }

.toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%) translateY(30px);
    background: #121212;
    color: #f5f5f5;
    padding: 10px 20px;
    border-radius: 24px;
    font-size: 14px;
    opacity: 0;
    transition: all 0.3s;
    pointer-events: none;
    border: 1px solid #262626;
    z-index: 100;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-width: 600px) {
    .overlay { background: #000; backdrop-filter: none; }
    .phone { width: 100vw; height: 100vh; max-height: none; border-radius: 0; box-shadow: none; }
}
`;

// ---------- Mount UI ----------
function mountUI() {
    try {
        buildShadowHost();
        shadowRoot.innerHTML =
            "<style>" + SHADOW_CSS + "</style>" +
            '<div id="floater" class="floater" title="InstaChar">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<rect x="5" y="2" width="14" height="20" rx="2.5"></rect>' +
                    '<line x1="12" y1="18" x2="12.01" y2="18"></line>' +
                '</svg>' +
                '<span id="badge" class="badge hidden">0</span>' +
            '</div>' +
            '<div id="overlay" class="overlay hidden">' +
                '<div class="phone">' +
                    '<div class="statusbar"><span id="clock">—</span><span>📶 🔋</span></div>' +
                    '<div class="topbar">' +
                        '<div class="topbar-title">Instagram</div>' +
                        '<div class="topbar-actions">' +
                            '<button class="icon-btn" id="btn-refresh" title="Refresh">⟳</button>' +
                            '<button class="icon-btn" id="btn-close" title="Close">✕</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="screen"><div id="view"></div></div>' +
                    '<div class="nav">' +
                        '<button class="nav-item" data-tab="feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></button>' +
                        '<button class="nav-item" data-tab="discover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>' +
                        '<button class="nav-item" data-tab="post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></button>' +
                        '<button class="nav-item" data-tab="dm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></button>' +
                        '<button class="nav-item" data-tab="profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="toast" class="toast"></div>';

        const floater = shadowRoot.getElementById("floater");
        const overlay = shadowRoot.getElementById("overlay");

        // Drag & click handling
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
                getSettings().iconPos = { right: Math.round(window.innerWidth - r.right), top: Math.round(r.top) };
                save();
            } else {
                openPanel();
            }
        });
        floater.addEventListener("pointercancel", () => { pDown = false; pMoved = false; floater.classList.remove("pressed"); });

        // Apply saved position
        const s = getSettings();
        if (s.iconPos) {
            if (typeof s.iconPos.right === "number") floater.style.right = s.iconPos.right + "px";
            if (typeof s.iconPos.top === "number") { floater.style.top = s.iconPos.top + "px"; floater.style.bottom = "auto"; }
        }
        setFloaterVisible(s.iconVisible);

        // Panel handlers
        shadowRoot.getElementById("btn-close").addEventListener("click", closePanel);
        shadowRoot.getElementById("btn-refresh").addEventListener("click", () => renderCurrentTab());
        overlay.addEventListener("click", (e) => { if (e.target.id === "overlay") closePanel(); });

        shadowRoot.querySelectorAll(".nav-item").forEach(btn => {
            btn.addEventListener("click", () => {
                getSettings().currentTab = btn.dataset.tab;
                getSettings().selectedProfile = null;
                save();
                renderCurrentTab();
                updateNavActive();
            });
        });

        setInterval(updateClock, 30000);
        log("UI mounted (shadow DOM)");
    } catch (e) {
        log("mountUI failed: " + e.message, true);
    }
}

function setFloaterVisible(visible) {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (!el) return;
    if (visible) el.classList.remove("hidden"); else el.classList.add("hidden");
}

function flashIcon() {
    updateBadge();
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (el) {
        el.style.animation = "insta-idle 0.4s ease-in-out 3";
        setTimeout(() => { el.style.animation = ""; }, 1500);
    }
}

function findIcon() {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (!el) { alert("Icon not mounted!"); return; }
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 3000);
}

function resetIconPos() {
    getSettings().iconPos = null;
    save();
    mountUI();
    toast("รีเซ็ตตำแหน่งไอคอนแล้ว ✓");
}

function openPanel() {
    if (!shadowRoot) return;
    shadowRoot.getElementById("overlay").classList.remove("hidden");
    const s = getSettings();
    s.unreadCount = 0;
    save();
    updateBadge();
    renderCurrentTab();
    updateNavActive();
    updateClock();
}

function closePanel() {
    if (!shadowRoot) return;
    shadowRoot.getElementById("overlay").classList.add("hidden");
}

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
    const s = getSettings();
    const badge = shadowRoot.getElementById("badge");
    if (!badge) return;
    if (s.unreadCount > 0) {
        badge.textContent = s.unreadCount > 99 ? "99+" : s.unreadCount;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

function updateNavActive() {
    if (!shadowRoot) return;
    const s = getSettings();
    shadowRoot.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === s.currentTab);
    });
}

function toast(msg) {
    if (!shadowRoot) return;
    const t = shadowRoot.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Tab Renderers ----------
function renderCurrentTab() {
    const s = getSettings();
    if (s.selectedProfile) return renderProfile(s.selectedProfile);
    switch (s.currentTab) {
        case "feed": return renderFeed();
        case "discover": return renderDiscover();
        case "post": return renderCompose();
        case "dm": return renderDMList();
        case "profile": return renderMyProfile();
    }
}

function renderFeed() {
    if (!shadowRoot) return;
    const s = getSettings();
    const view = shadowRoot.getElementById("view");
    if (!view) return;
    const posts = [...s.posts].reverse();
    if (posts.length === 0) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">ยังไม่มีโพสต์</div><div class="empty-sub">คุยกับตัวละครไปเรื่อยๆ<br>แล้วพวกเขาจะเริ่มโพสต์เอง</div></div>';
        return;
    }
    view.innerHTML = renderStoriesBar() + posts.map(renderPostCard).join("");
    attachFeedHandlers();
}

function renderStoriesBar() {
    const s = getSettings();
    const chars = Object.entries(s.charProfiles).slice(0, 10);
    if (chars.length === 0) return "";
    return '<div class="stories">' + chars.map(([name, p]) =>
        '<div class="story" data-profile="' + escapeHtml(name) + '">' +
            '<div class="story-ring"><img src="' + escapeHtml(p.avatar) + '" onerror="this.src=\'' + defaultAvatar(name) + '\'"/></div>' +
            '<div class="story-name">' + escapeHtml(p.username) + '</div>' +
        '</div>'
    ).join("") + '</div>';
}

function renderPostCard(post) {
    const liked = post.userLiked;
    const heart = liked ?
        '<svg viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' :
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    const npcComments = (post.comments || []).slice(0, 3).map(c => '<div class="comment"><b>' + escapeHtml(c.username) + '</b> ' + escapeHtml(c.text) + '</div>').join("");
    const userComments = (post.userComments || []).map(c => '<div class="comment"><b>' + escapeHtml(c.username) + '</b> ' + escapeHtml(c.text) + '</div>').join("");
    const totalComments = (post.comments ? post.comments.length : 0) + (post.userComments ? post.userComments.length : 0);
    const moreComments = totalComments > 3 ? '<div class="comment-more">ดูคอมเมนต์ทั้งหมด ' + totalComments + ' รายการ</div>' : "";
    const hashtagHtml = (post.hashtags || []).map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join(" ");
    return '<article class="post" data-post="' + post.id + '">' +
        '<header class="post-head">' +
            '<div class="post-user" data-profile="' + escapeHtml(post.author) + '">' +
                '<img class="avatar" src="' + escapeHtml(post.authorAvatar) + '" onerror="this.src=\'' + defaultAvatar(post.author) + '\'"/>' +
                '<div class="post-user-info"><div class="username">' + escapeHtml(post.authorUsername || post.author) + '</div>' +
                (post.mood ? '<div class="post-mood">' + escapeHtml(post.mood) + '</div>' : "") + '</div>' +
            '</div><div>⋯</div>' +
        '</header>' +
        '<div class="post-image-wrap"><img class="post-image" src="' + escapeHtml(post.image) + '" loading="lazy"/></div>' +
        '<div class="post-actions">' +
            '<button class="act-btn like-btn" data-post="' + post.id + '">' + heart + '</button>' +
            '<button class="act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>' +
            '<button class="act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
            '<button class="act-btn save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>' +
        '</div>' +
        '<div class="post-likes">' + post.likes.toLocaleString() + ' คนกดใจ</div>' +
        '<div class="post-caption"><b>' + escapeHtml(post.authorUsername || post.author) + '</b> ' + escapeHtml(post.caption) + ' ' + hashtagHtml + '</div>' +
        '<div class="post-comments">' + npcComments + userComments + '</div>' +
        moreComments +
        '<div class="post-time">' + timeAgo(post.timestamp) + 'ที่แล้ว</div>' +
        '<div class="comment-box">' +
            '<input type="text" class="comment-input" data-post="' + post.id + '" placeholder="เพิ่มความคิดเห็น..."/>' +
            '<button class="comment-post" data-post="' + post.id + '">โพสต์</button>' +
        '</div>' +
    '</article>';
}

function attachFeedHandlers() {
    if (!shadowRoot) return;
    shadowRoot.querySelectorAll(".like-btn").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(btn.dataset.post); });
    });
    shadowRoot.querySelectorAll(".post-user, .story").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            getSettings().selectedProfile = el.dataset.profile;
            renderProfile(el.dataset.profile);
        });
    });
    shadowRoot.querySelectorAll(".comment-post").forEach(btn => {
        btn.addEventListener("click", () => addUserComment(btn.dataset.post));
    });
    shadowRoot.querySelectorAll(".comment-input").forEach(inp => {
        inp.addEventListener("keypress", (e) => { if (e.key === "Enter") addUserComment(inp.dataset.post); });
    });
}

function toggleLike(postId) {
    const s = getSettings();
    const post = s.posts.find(p => p.id === postId);
    if (!post) return;
    post.userLiked = !post.userLiked;
    post.likes += post.userLiked ? 1 : -1;
    save();
    renderCurrentTab();
}

function addUserComment(postId) {
    const s = getSettings();
    const post = s.posts.find(p => p.id === postId);
    if (!post) return;
    const input = shadowRoot.querySelector('.comment-input[data-post="' + postId + '"]');
    if (!input || !input.value.trim()) return;
    post.userComments = post.userComments || [];
    post.userComments.push({ username: s.userProfile.username || getUserName(), text: input.value.trim(), timestamp: Date.now() });
    input.value = "";
    save();
    renderCurrentTab();
}

function renderProfile(charName) {
    if (!shadowRoot) return;
    const s = getSettings();
    const profile = ensureCharProfile(charName);
    if (!profile) return;
    const view = shadowRoot.getElementById("view");
    const posts = s.posts.filter(p => p.author === charName).reverse();
    view.innerHTML =
        '<div class="profile-head">' +
            '<button class="back-btn" id="back">←</button>' +
            '<div class="profile-username">' + escapeHtml(profile.username) + '</div><div></div>' +
        '</div>' +
        '<div class="profile-body">' +
            '<div class="profile-top">' +
                '<img class="profile-avatar" src="' + escapeHtml(profile.avatar) + '" onerror="this.src=\'' + defaultAvatar(charName) + '\'"/>' +
                '<div class="profile-stats">' +
                    '<div><b>' + posts.length + '</b><span>โพสต์</span></div>' +
                    '<div><b>' + profile.followers.toLocaleString() + '</b><span>ผู้ติดตาม</span></div>' +
                    '<div><b>' + profile.following.toLocaleString() + '</b><span>กำลังติดตาม</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="profile-name">' + escapeHtml(profile.displayName) + '</div>' +
            '<div class="profile-bio">' + escapeHtml(profile.bio || "") + '</div>' +
            '<div class="profile-actions">' +
                '<button class="follow-btn ' + (profile.userFollowing ? "following" : "") + '" id="follow">' + (profile.userFollowing ? "กำลังติดตาม" : "ติดตาม") + '</button>' +
                '<button class="msg-btn" id="msg">ข้อความ</button>' +
            '</div>' +
            '<div class="profile-grid">' +
                (posts.length === 0 ? '<div class="empty-small">ยังไม่มีโพสต์</div>' :
                    posts.map(p => '<div class="grid-item"><img src="' + escapeHtml(p.image) + '" loading="lazy"/></div>').join("")) +
            '</div>' +
        '</div>';
    shadowRoot.getElementById("back").addEventListener("click", () => {
        getSettings().selectedProfile = null;
        renderCurrentTab();
    });
    shadowRoot.getElementById("follow").addEventListener("click", () => {
        profile.userFollowing = !profile.userFollowing;
        profile.followers += profile.userFollowing ? 1 : -1;
        save();
        renderProfile(charName);
    });
    shadowRoot.getElementById("msg").addEventListener("click", () => {
        getSettings().currentTab = "dm";
        getSettings().selectedProfile = null;
        openDM(charName);
    });
}

function renderDiscover() {
    if (!shadowRoot) return;
    const s = getSettings();
    const view = shadowRoot.getElementById("view");
    const posts = [...s.posts].reverse();
    view.innerHTML =
        '<div class="search-bar"><input type="text" placeholder="ค้นหา"/></div>' +
        '<div class="discover-grid">' +
            posts.map(p => '<div class="grid-item" data-profile="' + escapeHtml(p.author) + '"><img src="' + escapeHtml(p.image) + '" loading="lazy"/></div>').join("") +
        '</div>';
    shadowRoot.querySelectorAll(".grid-item").forEach(el => {
        el.addEventListener("click", () => {
            getSettings().selectedProfile = el.dataset.profile;
            renderProfile(el.dataset.profile);
        });
    });
}

function renderCompose() {
    if (!shadowRoot) return;
    const view = shadowRoot.getElementById("view");
    view.innerHTML =
        '<div class="compose">' +
            '<div class="compose-title">โพสต์ใหม่</div>' +
            '<div id="compose-preview" style="display:none;margin-bottom:8px;border-radius:8px;overflow:hidden;background:#121212">' +
                '<img id="compose-preview-img" style="width:100%;max-height:300px;object-fit:cover;display:block"/>' +
                '<button id="compose-remove" style="width:100%;padding:6px;background:#262626;color:#ed4956;border:none;cursor:pointer;font-size:12px">✕ ลบรูป</button>' +
            '</div>' +
            '<div style="display:flex;gap:8px">' +
                '<label class="primary-btn" style="flex:1;text-align:center;cursor:pointer;margin:0;background:#262626;color:#f5f5f5">' +
                    '📷 เลือกรูปจากเครื่อง' +
                    '<input type="file" id="compose-file" accept="image/*" style="display:none"/>' +
                '</label>' +
            '</div>' +
            '<textarea id="compose-caption" placeholder="เขียน caption..." rows="3"></textarea>' +
            '<label class="compose-label">หรือใช้ AI สร้างรูป (prompt ภาษาอังกฤษ):</label>' +
            '<input type="text" id="compose-image" placeholder="sunset beach aesthetic..."/>' +
            '<div class="compose-hint">ถ้าไม่มีรูป + ไม่มี prompt จะ random ภาพสวยๆ ให้</div>' +
            '<button id="compose-post" class="primary-btn">โพสต์</button>' +
            '<div id="compose-status" style="font-size:13px;color:#a8a8a8;text-align:center"></div>' +
        '</div>';

    let uploadedDataUrl = null;
    const fileInput = shadowRoot.getElementById("compose-file");
    const preview = shadowRoot.getElementById("compose-preview");
    const previewImg = shadowRoot.getElementById("compose-preview-img");

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast("รูปใหญ่เกิน 5MB");
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            uploadedDataUrl = ev.target.result;
            previewImg.src = uploadedDataUrl;
            preview.style.display = "block";
        };
        reader.readAsDataURL(file);
    });

    shadowRoot.getElementById("compose-remove").addEventListener("click", () => {
        uploadedDataUrl = null;
        fileInput.value = "";
        preview.style.display = "none";
    });

    shadowRoot.getElementById("compose-post").addEventListener("click", () => {
        submitUserPost(uploadedDataUrl);
    });
}

async function submitUserPost(uploadedImage) {
    const s = getSettings();
    const caption = shadowRoot.getElementById("compose-caption").value.trim();
    const imgInput = shadowRoot.getElementById("compose-image").value.trim();
    const statusEl = shadowRoot.getElementById("compose-status");

    let imageUrl, imagePrompt = "";
    if (uploadedImage) {
        imageUrl = uploadedImage;
        imagePrompt = caption || "user uploaded photo";
    } else if (imgInput.startsWith("http")) {
        imageUrl = imgInput;
        imagePrompt = caption;
    } else {
        imagePrompt = imgInput || caption || "aesthetic mood photo cinematic";
        imageUrl = makeImageUrl(imagePrompt);
    }

    const userName = getUserName();
    const post = {
        id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
        author: userName,
        authorUsername: s.userProfile.username || sanitizeUsername(userName),
        authorAvatar: s.userProfile.avatar || defaultAvatar(userName),
        caption, hashtags: [], image: imageUrl, imagePrompt,
        timestamp: Date.now(), likes: 0, userLiked: false,
        comments: [], userComments: [], isUserPost: true,
    };
    s.posts.push(post);
    save();
    statusEl.textContent = "กำลังโพสต์...";

    const charNames = Object.keys(s.charProfiles);
    if (charNames.length === 0) {
        statusEl.textContent = "โพสต์แล้ว ✓ (ยังไม่มีตัวละครมา react)";
    } else {
        statusEl.textContent = "กำลังรอตัวละคร react...";
        for (const name of charNames) {
            try {
                const reaction = await generateCharReaction(name, post);
                if (reaction && reaction.like) post.likes += 1;
                if (reaction && reaction.comment) {
                    post.comments.push({ username: s.charProfiles[name].username, text: reaction.comment, timestamp: Date.now() });
                }
                save();
            } catch {}
        }
        statusEl.textContent = "โพสต์แล้ว ✓ ตัวละครมา react แล้ว";
    }
    setTimeout(() => {
        s.currentTab = "feed";
        renderCurrentTab();
        updateNavActive();
    }, 1000);
}

function renderDMList() {
    if (!shadowRoot) return;
    const s = getSettings();
    const view = shadowRoot.getElementById("view");
    const chars = Object.entries(s.charProfiles);
    view.innerHTML =
        '<div class="dm-header"><div class="dm-title">ข้อความ</div></div>' +
        '<div class="dm-list">' +
            (chars.length === 0 ? '<div class="empty-small">ยังไม่มีคนคุย</div>' :
                chars.map(([name, p]) => {
                    const thread = s.dms[name] || [];
                    const last = thread[thread.length - 1];
                    return '<div class="dm-item" data-char="' + escapeHtml(name) + '">' +
                        '<img class="avatar" src="' + escapeHtml(p.avatar) + '" onerror="this.src=\'' + defaultAvatar(name) + '\'"/>' +
                        '<div class="dm-info">' +
                            '<div class="dm-name">' + escapeHtml(p.displayName) + '</div>' +
                            '<div class="dm-preview">' + (last ? escapeHtml(last.text.slice(0, 50)) : "เริ่มคุย...") + '</div>' +
                        '</div>' +
                    '</div>';
                }).join("")) +
        '</div>';
    shadowRoot.querySelectorAll(".dm-item").forEach(el => {
        el.addEventListener("click", () => openDM(el.dataset.char));
    });
}

function openDM(charName) {
    if (!shadowRoot) return;
    const s = getSettings();
    const profile = ensureCharProfile(charName);
    const view = shadowRoot.getElementById("view");
    const thread = s.dms[charName] || [];
    view.innerHTML =
        '<div class="dm-chat-head">' +
            '<button class="back-btn" id="back">←</button>' +
            '<img class="avatar" src="' + escapeHtml(profile.avatar) + '" onerror="this.src=\'' + defaultAvatar(charName) + '\'"/>' +
            '<div class="dm-chat-name">' + escapeHtml(profile.displayName) + '</div>' +
        '</div>' +
        '<div class="dm-thread" id="dm-thread">' +
            thread.map(m => '<div class="dm-msg ' + (m.from === "user" ? "user" : "char") + '">' + escapeHtml(m.text) + '</div>').join("") +
            (thread.length === 0 ? '<div class="empty-small">ส่งข้อความแรกเลย</div>' : "") +
        '</div>' +
        '<div class="dm-input-wrap">' +
            '<input type="text" id="dm-input" placeholder="ข้อความ..."/>' +
            '<button id="dm-send">ส่ง</button>' +
        '</div>';
    shadowRoot.getElementById("back").addEventListener("click", () => {
        s.selectedProfile = null; s.currentTab = "dm"; renderCurrentTab();
    });
    const send = async () => {
        const inp = shadowRoot.getElementById("dm-input");
        const text = inp.value.trim();
        if (!text) return;
        s.dms[charName] = s.dms[charName] || [];
        s.dms[charName].push({ from: "user", text, timestamp: Date.now() });
        inp.value = "";
        save();
        openDM(charName);
        await generateDMReply(charName);
        openDM(charName);
    };
    shadowRoot.getElementById("dm-send").addEventListener("click", send);
    shadowRoot.getElementById("dm-input").addEventListener("keypress", (e) => { if (e.key === "Enter") send(); });
    const threadEl = shadowRoot.getElementById("dm-thread");
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
}

function renderMyProfile() {
    if (!shadowRoot) return;
    const s = getSettings();
    const view = shadowRoot.getElementById("view");
    const userName = getUserName();
    const myPosts = s.posts.filter(p => p.isUserPost).reverse();
    view.innerHTML =
        '<div class="profile-head"><div></div><div class="profile-username">' + escapeHtml(s.userProfile.username || userName) + '</div><div></div></div>' +
        '<div class="profile-body">' +
            '<div class="profile-top">' +
                '<img class="profile-avatar" src="' + escapeHtml(s.userProfile.avatar || defaultAvatar(userName)) + '"/>' +
                '<div class="profile-stats">' +
                    '<div><b>' + myPosts.length + '</b><span>โพสต์</span></div>' +
                    '<div><b>' + Object.values(s.charProfiles).filter(p => p.followsUser).length + '</b><span>ผู้ติดตาม</span></div>' +
                    '<div><b>' + Object.values(s.charProfiles).filter(p => p.userFollowing).length + '</b><span>กำลังติดตาม</span></div>' +
                '</div>' +
            '</div>' +
            '<input class="inline-input" id="my-name" placeholder="ชื่อที่แสดง" value="' + escapeHtml(s.userProfile.displayName || userName) + '"/>' +
            '<textarea class="inline-input" id="my-bio" rows="2" placeholder="ไบโอ...">' + escapeHtml(s.userProfile.bio || "") + '</textarea>' +
            '<button class="primary-btn" id="save-profile">บันทึก</button>' +
            '<div class="profile-grid">' +
                myPosts.map(p => '<div class="grid-item"><img src="' + escapeHtml(p.image) + '"/></div>').join("") +
            '</div>' +
        '</div>';
    shadowRoot.getElementById("save-profile").addEventListener("click", () => {
        s.userProfile.displayName = shadowRoot.getElementById("my-name").value;
        s.userProfile.bio = shadowRoot.getElementById("my-bio").value;
        save();
        toast("บันทึกแล้ว ✓");
    });
}

// ---------- Ambient Activity ----------
let ambientTimer = null;

async function runAmbientActivity() {
    const s = getSettings();
    if (!s.autoPost) return; // respect master switch
    const charNames = Object.keys(s.charProfiles);
    if (charNames.length === 0) return;

    // Pick random character
    const charName = charNames[Math.floor(Math.random() * charNames.length)];
    const userPosts = s.posts.filter(p => p.isUserPost).slice(-5); // recent 5 user posts
    const charPosts = s.posts.filter(p => p.author === charName).slice(-3);

    // Decide what to do: 40% comment on user post, 25% like user post, 25% DM, 10% post own
    const roll = Math.random();

    try {
        if (roll < 0.40 && userPosts.length > 0) {
            // Comment on user's recent post
            const target = userPosts[Math.floor(Math.random() * userPosts.length)];
            const reaction = await generateCharReaction(charName, target);
            if (reaction && reaction.comment) {
                target.comments = target.comments || [];
                target.comments.push({
                    username: s.charProfiles[charName].username,
                    text: reaction.comment,
                    timestamp: Date.now(),
                });
                if (reaction.like) target.likes += 1;
                s.unreadCount = (s.unreadCount || 0) + 1;
                save();
                flashIcon();
                if (isPanelOpen()) renderCurrentTab();
                log("Ambient: " + charName + " commented on user post");
            }
        } else if (roll < 0.65 && userPosts.length > 0) {
            // Just like a user post
            const target = userPosts[Math.floor(Math.random() * userPosts.length)];
            target.likes += 1;
            s.unreadCount = (s.unreadCount || 0) + 1;
            save();
            flashIcon();
            if (isPanelOpen()) renderCurrentTab();
            log("Ambient: " + charName + " liked user post");
        } else if (roll < 0.90) {
            // Send DM
            await generateAmbientDM(charName);
        } else {
            // Character posts something
            await generateAmbientPost(charName);
        }
    } catch (e) {
        log("Ambient err: " + e.message, true);
    }
}

async function generateAmbientDM(charName) {
    const s = getSettings();
    const profile = s.charProfiles[charName];
    const userName = getUserName();
    const thread = s.dms[charName] || [];
    const recentThread = thread.slice(-4).map(m => (m.from === "user" ? userName : charName) + ": " + m.text).join("\n");

    const prompt = `[System: IG DM — Ambient]
Character "${charName}" decides to randomly DM ${userName} out of the blue.

Previous DM context (if any):
${recentThread || "(no previous messages)"}

Generate ONE short casual Thai DM that ${charName} would send (1-2 sentences). Match their personality. Could be:
- Random thought/question
- Checking in
- Something they saw/did
- Flirty/friendly banter

Reply directly, no JSON, no prefix, just the message text.`;

    try {
        const response = await callLLM(prompt, "You are a character in roleplay. Reply in Thai naturally.");
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 300);
        if (!reply) return;
        s.dms[charName] = s.dms[charName] || [];
        s.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        s.unreadCount = (s.unreadCount || 0) + 1;
        save();
        flashIcon();
        if (isPanelOpen()) renderCurrentTab();
        log("Ambient: " + charName + " sent DM");
    } catch (e) {
        log("Ambient DM err: " + e.message, true);
    }
}

async function generateAmbientPost(charName) {
    const s = getSettings();
    const prompt = `[System: IG Random Post]
Character "${charName}" decides to post on Instagram right now — just a random slice-of-life moment, not tied to any specific scene.

Generate a post in their personality. Respond ONLY with JSON:
{"caption": "thai caption", "imagePrompt": "english prompt describing scene", "hashtags": ["#tag"], "mood": "happy|sad|flirty|chill|excited|moody|proud|angry"}`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !data.caption) return;

        const profile = s.charProfiles[charName];
        const likes = Math.max(5, Math.floor((profile.followers || 1000) * (0.3 + Math.random() * 1.4) / 10));

        const post = {
            id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
            author: charName,
            authorUsername: profile.username,
            authorAvatar: profile.avatar,
            caption: data.caption || "",
            hashtags: data.hashtags || [],
            image: makeImageUrl(data.imagePrompt, Date.now()),
            imagePrompt: data.imagePrompt,
            mood: data.mood,
            timestamp: Date.now(),
            likes: likes,
            userLiked: false,
            comments: [],
            userComments: [],
        };

        // Generate a couple random comments
        try {
            const commentPrompt = `Character "${charName}" posted: "${data.caption}". Generate 1-3 random Thai IG comments from followers. JSON array: [{"username":"name","text":"thai"}]`;
            const cResp = await callLLM(commentPrompt);
            const cArr = parseJson(cResp);
            if (Array.isArray(cArr)) {
                post.comments = cArr.slice(0, 3).map(c => ({
                    username: c.username || "user_" + Math.floor(Math.random() * 999),
                    text: c.text || "",
                    timestamp: Date.now(),
                }));
            }
        } catch {}

        profile.postCount = (profile.postCount || 0) + 1;
        s.posts.push(post);
        s.unreadCount = (s.unreadCount || 0) + 1;
        save();
        flashIcon();
        if (isPanelOpen()) renderCurrentTab();
        log("Ambient: " + charName + " posted");
    } catch (e) {
        log("Ambient post err: " + e.message, true);
    }
}

function startAmbientTimer() {
    stopAmbientTimer();
    const scheduleNext = () => {
        const s = getSettings();
        if (!s.ambientEnabled) return;
        // Random interval 60-180 seconds
        const delay = 60000 + Math.random() * 120000;
        ambientTimer = setTimeout(async () => {
            if (s.ambientEnabled) {
                await runAmbientActivity();
                scheduleNext();
            }
        }, delay);
    };
    scheduleNext();
    log("Ambient timer started");
}

function stopAmbientTimer() {
    if (ambientTimer) {
        clearTimeout(ambientTimer);
        ambientTimer = null;
    }
}

// ---------- Event hooks ----------
async function onMessageReceived() {
    try {
        const s = getSettings();
        if (!s.autoPost) return;
        const ctx = getContext();
        const chat = ctx.chat || [];
        const msg = chat[chat.length - 1];
        if (!msg || msg.is_user || msg.is_system) return;
        if (Math.random() > s.postChance) return;
        if (!msg.name) return;
        await maybeGeneratePost(msg.name, msg.mes || "");
    } catch (e) {
        log("message handler: " + e.message, true);
    }
}

function onChatChanged() {
    try {
        const name = getCurrentCharacterName();
        if (name) ensureCharProfile(name);
    } catch {}
}

// ---------- Settings UI (ST drawer) ----------
async function loadSettingsUI() {
    try {
        const html = await $.get(extensionFolderPath + "/settings.html");
        $("#extensions_settings2").append(html);
        log("Settings HTML appended");

        const s = getSettings();
        $("#instachar-toggle-icon").prop("checked", s.iconVisible);
        $("#instachar-toggle-autopost").prop("checked", s.autoPost);
        $("#instachar-toggle-ambient").prop("checked", s.ambientEnabled);
        $("#instachar-chance-slider").val(Math.round(s.postChance * 100));
        $("#instachar-chance-val").text(Math.round(s.postChance * 100) + "%");
        $("#instachar-debug-log").text(debugLog.slice(-12).join("\n"));
    } catch (e) {
        log("loadSettingsUI: " + e.message, true);
    }
}

function attachDelegation() {
    $(document).off(".instachar")
        .on("change.instachar", "#instachar-toggle-icon", function () {
            getSettings().iconVisible = $(this).prop("checked");
            save();
            setFloaterVisible(getSettings().iconVisible);
        })
        .on("change.instachar", "#instachar-toggle-autopost", function () {
            getSettings().autoPost = $(this).prop("checked");
            save();
        })
        .on("change.instachar", "#instachar-toggle-ambient", function () {
            const enabled = $(this).prop("checked");
            getSettings().ambientEnabled = enabled;
            save();
            if (enabled) startAmbientTimer(); else stopAmbientTimer();
        })
        .on("input.instachar", "#instachar-chance-slider", function () {
            const v = parseInt($(this).val());
            getSettings().postChance = v / 100;
            $("#instachar-chance-val").text(v + "%");
            save();
        })
        .on("click.instachar", "#instachar-open-btn", openPanel)
        .on("click.instachar", "#instachar-find-btn", findIcon)
        .on("click.instachar", "#instachar-reset-pos-btn", resetIconPos)
        .on("click.instachar", "#instachar-reset-all-btn", function () {
            if (!confirm("ลบข้อมูล InstaChar ทั้งหมด? (ย้อนไม่ได้)")) return;
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            save();
            if (isPanelOpen()) renderCurrentTab();
            toast("ลบข้อมูลทั้งหมดแล้ว");
        });
}

// ---------- Init ----------
jQuery(async () => {
    log("InstaChar v" + VERSION + " init...");
    try {
        getSettings();
        attachDelegation();
        await loadSettingsUI();
        mountUI();
        if (eventSource && event_types) {
            try {
                if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
                if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
            } catch (e) { log("event bind: " + e.message, true); }
        }
        startAmbientTimer();
        log("Ready! 📱");
    } catch (e) {
        log("Init FAILED: " + e.message, true);
    }
});
