/* InstaChar v0.3.0 — Instagram for SillyTavern
 * Rewritten following HamHam's proven pattern:
 * - Minimal imports (only what exists in every ST version)
 * - getContext() for all chat/character data
 * - Shadow DOM injection on document.documentElement
 * - Max z-index (2147483647)
 */

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const MODULE_NAME = "instachar";
const VERSION = "0.3.0";

// ---------- Logging ----------
function log(msg, isError) {
    if (isError) console.error("[InstaChar] " + msg);
    else console.log("[InstaChar] " + msg);
}

// ---------- Context helpers ----------
function ctx() {
    try { return getContext(); } catch (e) { log("ctx err: " + e.message, true); return {}; }
}
function getChat() { return ctx().chat || []; }
function getCharacters() { return ctx().characters || []; }
function getCurrentCharIdx() { return ctx().characterId; }
function getUserName() { return ctx().name1 || "You"; }

async function quietPrompt(prompt) {
    const c = ctx();
    if (typeof c.generateQuietPrompt === "function") {
        return await c.generateQuietPrompt(prompt, false, false);
    }
    throw new Error("generateQuietPrompt not available in context");
}

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
    enabled: true,
    autoPost: true,
    postChance: 0.35,
    imageModel: "flux",
    fabPosition: { x: null, y: null },
    posts: [],
    dms: {},
    userProfile: { username: "", displayName: "", bio: "", avatar: "" },
    charProfiles: {},
    unreadCount: 0,
};

function getSettings() {
    try {
        if (!extension_settings[MODULE_NAME]) {
            extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }
        const s = extension_settings[MODULE_NAME];
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

// ---------- Utils ----------
function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff} วิ`;
    if (diff < 3600) return `${Math.floor(diff / 60)} น.`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชม.`;
    return `${Math.floor(diff / 86400)} วัน`;
}
function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function sanitizeUsername(name) {
    if (!name) return "user_" + Math.floor(Math.random() * 9999);
    return name.toLowerCase().replace(/[^a-z0-9_\u0e00-\u0e7f]/g, "").slice(0, 20) || "user";
}
function defaultAvatar(name) {
    const initial = (name || "?").charAt(0).toUpperCase();
    const colors = ["#e91e63", "#9c27b0", "#3f51b5", "#00bcd4", "#4caf50", "#ff9800", "#f44336"];
    const color = colors[(name || "").length % colors.length];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect fill='${color}' width='80' height='80'/><text x='40' y='52' font-size='36' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
function getCharAvatar(charName) {
    try {
        const ch = getCharacters().find(c => c && c.name === charName);
        if (ch && ch.avatar && ch.avatar !== "none") return `/characters/${ch.avatar}`;
    } catch {}
    return defaultAvatar(charName);
}
function makeImageUrl(prompt, seed) {
    const s = getSettings();
    const p = encodeURIComponent(prompt || "aesthetic cinematic photo");
    return `https://image.pollinations.ai/prompt/${p}?width=768&height=768&nologo=true&model=${s.imageModel}&seed=${seed || Math.floor(Math.random() * 99999)}`;
}
function parseJson(text) {
    if (!text) return null;
    let t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const first = t.indexOf("{"), firstArr = t.indexOf("[");
    let start = (first >= 0 && (firstArr < 0 || first < firstArr)) ? first : firstArr;
    if (start < 0) return null;
    t = t.slice(start);
    try { return JSON.parse(t); } catch {
        for (let i = t.length - 1; i > 0; i--) {
            if (t[i] === "}" || t[i] === "]") {
                try { return JSON.parse(t.slice(0, i + 1)); } catch {}
            }
        }
        return null;
    }
}

// ---------- Character profiles ----------
function ensureCharProfile(charName) {
    if (!charName) return null;
    const s = getSettings();
    if (!s.charProfiles[charName]) {
        let bio = "";
        try {
            const ch = getCharacters().find(c => c && c.name === charName);
            bio = ch?.description?.slice(0, 150) || "";
        } catch {}
        s.charProfiles[charName] = {
            username: sanitizeUsername(charName) + "_" + Math.floor(Math.random() * 99),
            displayName: charName,
            bio,
            avatar: getCharAvatar(charName),
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

// ---------- Post generation ----------
async function maybeGeneratePost(charName, msgText) {
    const s = getSettings();
    if (!s.enabled || !s.autoPost) return;
    ensureCharProfile(charName);

    const prompt = `[System: Instagram Simulator]
Character "${charName}" experienced this scene:
"${msgText.slice(0, 800)}"

Would ${charName} post on Instagram right now? Consider their personality.

If YES, respond ONLY with JSON (no markdown fences):
{"post": true, "caption": "thai caption in character voice", "imagePrompt": "english scene description for AI image", "hashtags": ["#tag"], "mood": "happy|sad|flirty|chill|moody"}

If NO: {"post": false}`;

    try {
        const resp = await quietPrompt(prompt);
        const data = parseJson(resp);
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
            likes, userLiked: false,
            comments: [], userComments: [],
        };
        post.comments = await generateComments(charName, post, msgText);
        profile.postCount = (profile.postCount || 0) + 1;
        s.posts.push(post);
        s.unreadCount = (s.unreadCount || 0) + 1;
        save();
        updateBadge();
        if (isAppOpen() && currentTab === "feed") renderFeed();
        log(`Post generated for ${charName}`);
    } catch (e) { log("post gen err: " + e.message, true); }
}

async function generateComments(author, post, sceneContext) {
    const userName = getUserName();
    const recent = getChat().slice(-10).map(m => m.mes || "").join("\n");
    const prompt = `[Instagram Comments]
Character "${author}" posted: "${post.caption}" (mood: ${post.mood})
Scene: "${sceneContext.slice(0, 400)}"
Recent chat: "${recent.slice(-1200)}"

Generate 2-5 thai IG comments from NPCs in scene or random followers. NOT from "${userName}" or "${author}".

ONLY JSON array, no fences:
[{"username": "name", "text": "thai comment"}]`;

    try {
        const resp = await quietPrompt(prompt);
        const arr = parseJson(resp);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, 6).map(c => ({
            username: c.username || "user_" + Math.floor(Math.random() * 999),
            text: c.text || "",
            timestamp: Date.now(),
        }));
    } catch { return []; }
}

async function generateReactionToUserPost(charName, userPost) {
    const prompt = `[Instagram Reaction]
User posted: "${userPost.caption}" (image: ${userPost.imagePrompt || 'photo'})
How would "${charName}" react based on personality and relationship?
ONLY JSON: {"like": true|false, "comment": "thai or null"}`;
    try { return parseJson(await quietPrompt(prompt)); }
    catch { return { like: Math.random() < 0.5, comment: null }; }
}

// ---------- Shadow DOM UI ----------
let shadowHost = null;
let shadowRoot = null;
let currentTab = "feed";
let selectedProfile = null;

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
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', 'Sarabun', sans-serif; }
* { box-sizing: border-box; }

.fab {
    position: fixed; bottom: 90px; right: 16px;
    width: 54px; height: 54px; border-radius: 15px;
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    color: white;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; pointer-events: auto;
    box-shadow: 0 4px 20px rgba(220, 39, 67, 0.5), 0 0 0 2px rgba(255,255,255,0.1);
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
    touch-action: none;
    animation: fab-entry 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fab svg { width: 28px; height: 28px; pointer-events: none; }
.fab.dragging { transform: scale(1.1); box-shadow: 0 8px 32px rgba(220, 39, 67, 0.8); }
.fab .badge {
    position: absolute; top: -4px; right: -4px;
    background: #ff2d55; color: white;
    font-size: 11px; font-weight: 700;
    min-width: 20px; height: 20px; padding: 0 5px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid #000;
}
.fab .badge.hidden { display: none; }
@keyframes fab-entry { 0% { opacity: 0; transform: scale(0.3); } 100% { opacity: 1; transform: scale(1); } }

.overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(6px);
    pointer-events: auto;
    display: flex; align-items: center; justify-content: center;
    animation: fadein 0.25s ease-out;
}
.overlay.hidden { display: none; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

.phone {
    width: min(420px, 96vw); height: min(820px, 94vh);
    background: #000; border-radius: 28px; overflow: hidden;
    display: flex; flex-direction: column; color: #f5f5f5;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
    animation: popin 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes popin { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.statusbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 18px 4px; font-size: 13px; font-weight: 600; }
.status-icons { display: flex; gap: 6px; font-size: 11px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid #262626; }
.brand { font-family: 'Billabong', 'Pacifico', 'Dancing Script', cursive; font-size: 28px; }
.top-actions { display: flex; gap: 8px; }
.icon-btn { background: transparent; border: none; color: #f5f5f5; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.icon-btn:hover { background: #121212; }

.screen { flex: 1; overflow-y: auto; overflow-x: hidden; }
.screen::-webkit-scrollbar { width: 6px; }
.screen::-webkit-scrollbar-thumb { background: #262626; border-radius: 3px; }

.nav { display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #262626; padding: 8px 0 10px; background: #000; }
.nav-item { background: transparent; border: none; color: #f5f5f5; cursor: pointer; padding: 6px 12px; opacity: 0.9; }
.nav-item svg { width: 24px; height: 24px; }
.nav-item.active { transform: scale(1.15); }
.nav-item.active svg { stroke-width: 2.5; }

.stories { display: flex; gap: 14px; padding: 12px 14px; overflow-x: auto; border-bottom: 1px solid #262626; }
.stories::-webkit-scrollbar { display: none; }
.story { flex-shrink: 0; width: 66px; cursor: pointer; text-align: center; }
.story-ring { width: 62px; height: 62px; border-radius: 50%; background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); padding: 2px; margin: 0 auto; }
.story-ring img { width: 100%; height: 100%; border-radius: 50%; border: 2px solid #000; object-fit: cover; display: block; }
.story-name { font-size: 11px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.post { border-bottom: 1px solid #262626; padding-bottom: 8px; margin-bottom: 4px; }
.post-head { display: flex; align-items: center; padding: 10px 14px; gap: 10px; }
.post-user { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; }
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.uinfo { display: flex; flex-direction: column; line-height: 1.15; }
.uname { font-weight: 600; font-size: 14px; }
.umood { font-size: 11px; color: #737373; }
.post-image { width: 100%; aspect-ratio: 1/1; object-fit: cover; display: block; background: #121212; }
.post-actions { display: flex; align-items: center; padding: 8px 10px 4px; gap: 4px; }
.act { background: transparent; border: none; color: #f5f5f5; padding: 6px; cursor: pointer; border-radius: 50%; }
.act svg { width: 24px; height: 24px; }
.act.save-btn { margin-left: auto; }
.likes { padding: 2px 14px; font-size: 14px; font-weight: 600; }
.caption { padding: 4px 14px; font-size: 14px; line-height: 1.4; }
.caption b { font-weight: 600; margin-right: 4px; }
.tag { color: #0095f6; margin-right: 4px; }
.comments { padding: 2px 14px; }
.comment { font-size: 14px; line-height: 1.4; padding: 1px 0; }
.comment b { font-weight: 600; margin-right: 4px; }
.more { padding: 2px 14px; font-size: 13px; color: #737373; }
.ptime { padding: 4px 14px; font-size: 11px; color: #737373; text-transform: uppercase; }
.cbox { display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid #121212; gap: 8px; }
.cinput { flex: 1; background: transparent; border: none; color: #f5f5f5; font-size: 14px; outline: none; padding: 6px 0; font-family: inherit; }
.cinput::placeholder { color: #737373; }
.cpost { background: transparent; border: none; color: #0095f6; font-weight: 600; cursor: pointer; font-size: 14px; }

.empty { padding: 60px 20px; text-align: center; color: #a8a8a8; }
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }
.empty-title { font-size: 18px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; }
.empty-sub { font-size: 13px; line-height: 1.5; color: #737373; }
.empty-small { padding: 40px 20px; text-align: center; color: #737373; font-size: 13px; }

.profile-head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #262626; gap: 8px; }
.back-btn { background: transparent; border: none; color: #f5f5f5; font-size: 22px; cursor: pointer; padding: 4px; }
.pusername { font-weight: 700; font-size: 16px; text-align: center; }
.pbody { padding: 14px; }
.ptop { display: flex; align-items: center; gap: 24px; margin-bottom: 14px; }
.pavatar { width: 86px; height: 86px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; }
.pstats { display: flex; gap: 18px; flex: 1; justify-content: space-around; }
.pstats > div { text-align: center; display: flex; flex-direction: column; font-size: 13px; }
.pstats b { font-size: 17px; font-weight: 700; }
.pstats span { color: #a8a8a8; }
.pname { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.pbio { font-size: 13px; line-height: 1.4; margin-bottom: 12px; white-space: pre-wrap; }
.pactions { display: flex; gap: 6px; margin-bottom: 14px; }
.follow-btn, .msg-btn { flex: 1; padding: 8px; border-radius: 8px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.follow-btn { background: #0095f6; color: white; }
.follow-btn.following { background: #121212; color: #f5f5f5; }
.msg-btn { background: #121212; color: #f5f5f5; }
.pgrid, .dgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; margin-top: 8px; }
.gitem { aspect-ratio: 1/1; background: #121212; overflow: hidden; cursor: pointer; }
.gitem img { width: 100%; height: 100%; object-fit: cover; }

.sbar { padding: 8px 14px; border-bottom: 1px solid #262626; }
.sbar input { width: 100%; padding: 8px 12px; border-radius: 8px; background: #121212; border: none; color: #f5f5f5; font-size: 14px; outline: none; }

.compose { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.compose-title { font-size: 18px; font-weight: 700; }
.compose textarea, .compose input, .iinput {
    width: 100%; padding: 10px 12px; border-radius: 8px;
    background: #121212; border: 1px solid #262626; color: #f5f5f5;
    font-size: 14px; outline: none; resize: vertical; box-sizing: border-box;
    font-family: inherit;
}
.clabel { font-size: 12px; color: #a8a8a8; }
.chint { font-size: 11px; color: #737373; }
.pbtn { padding: 10px; background: #0095f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; }
.dbtn { padding: 10px; background: transparent; color: #ed4956; border: 1px solid #ed4956; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; font-family: inherit; }
.srow { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; }
.srow input[type="range"] { width: 140px; }

.dmhead { padding: 14px; }
.dmtitle { font-size: 18px; font-weight: 700; }
.dmitem { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; }
.dmitem:hover { background: #121212; }
.dminfo { flex: 1; min-width: 0; }
.dmname { font-weight: 600; font-size: 14px; }
.dmprev { font-size: 13px; color: #a8a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dmchead { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262626; }
.dmcname { font-weight: 600; font-size: 15px; }
.dmthread { padding: 14px; display: flex; flex-direction: column; gap: 6px; min-height: 300px; }
.dmmsg { max-width: 75%; padding: 8px 12px; border-radius: 18px; font-size: 14px; line-height: 1.35; word-wrap: break-word; }
.dmmsg.user { align-self: flex-end; background: #0095f6; color: white; border-bottom-right-radius: 4px; }
.dmmsg.char { align-self: flex-start; background: #121212; color: #f5f5f5; border-bottom-left-radius: 4px; }
.dminput-wrap { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #262626; }
.dminput-wrap input { flex: 1; padding: 10px 14px; border-radius: 20px; background: #121212; border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none; font-family: inherit; }
.dminput-wrap button { padding: 8px 16px; background: transparent; color: #0095f6; border: none; font-weight: 700; cursor: pointer; font-size: 14px; font-family: inherit; }

.toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #121212; color: #f5f5f5; padding: 10px 20px; border-radius: 24px; font-size: 14px; opacity: 0; transition: opacity 0.3s; pointer-events: none; border: 1px solid #262626; }
.toast.show { opacity: 1; }

@media (max-width: 480px) {
    .phone { width: 100vw; height: 100vh; border-radius: 0; }
}
`;

function mountUI() {
    const root = buildShadowHost();
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    root.appendChild(style);

    const fab = document.createElement("div");
    fab.className = "fab";
    fab.id = "ic-fab";
    fab.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
        <span class="badge hidden" id="ic-badge">0</span>
    `;

    const s = getSettings();
    if (s.fabPosition.x !== null && s.fabPosition.y !== null) {
        fab.style.left = s.fabPosition.x + "px";
        fab.style.top = s.fabPosition.y + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
    }
    root.appendChild(fab);
    attachFabDrag(fab);

    const overlay = document.createElement("div");
    overlay.className = "overlay hidden";
    overlay.id = "ic-overlay";
    overlay.innerHTML = appShellHtml();
    root.appendChild(overlay);
    attachShellHandlers();

    const toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.id = "ic-toast";
    root.appendChild(toastEl);

    updateBadge();
    log("UI mounted inside shadow DOM ✓");
}

function $(sel) { return shadowRoot ? shadowRoot.querySelector(sel) : null; }
function $$(sel) { return shadowRoot ? shadowRoot.querySelectorAll(sel) : []; }

function appShellHtml() {
    return `
    <div class="phone">
        <div class="statusbar">
            <span id="ic-clock">—</span>
            <div class="status-icons"><span>📶</span><span>🔋</span></div>
        </div>
        <div class="topbar">
            <div class="brand">Instagram</div>
            <div class="top-actions">
                <button class="icon-btn" id="ic-refresh">⟳</button>
                <button class="icon-btn" id="ic-close">✕</button>
            </div>
        </div>
        <div class="screen"><div id="ic-view"></div></div>
        <div class="nav">
            <button class="nav-item" data-tab="feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></button>
            <button class="nav-item" data-tab="discover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
            <button class="nav-item" data-tab="post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></button>
            <button class="nav-item" data-tab="dm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            <button class="nav-item" data-tab="profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>
        </div>
    </div>`;
}

function attachShellHandlers() {
    $("#ic-close").onclick = closeApp;
    $("#ic-refresh").onclick = () => renderCurrentTab();
    $$(".nav-item").forEach(btn => {
        btn.onclick = () => {
            currentTab = btn.dataset.tab;
            selectedProfile = null;
            renderCurrentTab();
            updateNavActive();
        };
    });
    $("#ic-overlay").addEventListener("click", (e) => {
        if (e.target.classList.contains("overlay")) closeApp();
    });
}

function attachFabDrag(fab) {
    let startX, startY, origX, origY, isDragging = false;
    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        startX = p.clientX; startY = p.clientY;
        const rect = fab.getBoundingClientRect();
        origX = rect.left; origY = rect.top;
        isDragging = false;
    };
    const onMove = (e) => {
        if (startX === undefined) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX, dy = p.clientY - startY;
        if (!isDragging && Math.abs(dx) + Math.abs(dy) > 8) {
            isDragging = true;
            fab.classList.add("dragging");
        }
        if (isDragging) {
            e.preventDefault();
            const nx = Math.max(4, Math.min(window.innerWidth - fab.offsetWidth - 4, origX + dx));
            const ny = Math.max(4, Math.min(window.innerHeight - fab.offsetHeight - 4, origY + dy));
            fab.style.left = nx + "px"; fab.style.top = ny + "px";
            fab.style.right = "auto"; fab.style.bottom = "auto";
        }
    };
    const onUp = () => {
        if (startX === undefined) return;
        fab.classList.remove("dragging");
        if (isDragging) {
            const rect = fab.getBoundingClientRect();
            const s = getSettings();
            s.fabPosition = { x: rect.left, y: rect.top };
            save();
        } else {
            toggleApp();
        }
        startX = undefined;
    };
    fab.addEventListener("mousedown", onDown);
    fab.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
}

function resetFabPosition() {
    const s = getSettings();
    s.fabPosition = { x: null, y: null };
    save();
    const fab = $("#ic-fab");
    if (fab) {
        fab.style.left = ""; fab.style.top = "";
        fab.style.right = "16px"; fab.style.bottom = "90px";
    }
    toast("รีเซ็ตตำแหน่งแล้ว");
}

function isAppOpen() {
    const el = $("#ic-overlay");
    return el && !el.classList.contains("hidden");
}
function openApp() {
    const el = $("#ic-overlay");
    if (!el) return;
    el.classList.remove("hidden");
    const s = getSettings();
    s.unreadCount = 0;
    save();
    updateBadge();
    renderCurrentTab();
    updateNavActive();
    updateClock();
}
function closeApp() { const el = $("#ic-overlay"); if (el) el.classList.add("hidden"); }
function toggleApp() { if (isAppOpen()) closeApp(); else openApp(); }

function updateClock() {
    const el = $("#ic-clock");
    if (!el) return;
    const d = new Date();
    el.textContent = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}
function updateBadge() {
    const s = getSettings();
    const badge = $("#ic-badge");
    if (!badge) return;
    if (s.unreadCount > 0) {
        badge.textContent = s.unreadCount > 99 ? "99+" : s.unreadCount;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}
function updateNavActive() {
    $$(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === currentTab));
}
function toast(msg) {
    const t = $("#ic-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Render tabs ----------
function renderCurrentTab() {
    if (selectedProfile) return renderProfile(selectedProfile);
    switch (currentTab) {
        case "feed": return renderFeed();
        case "discover": return renderDiscover();
        case "post": return renderCompose();
        case "dm": return renderDMList();
        case "profile": return renderMyProfile();
    }
}

function renderFeed() {
    const s = getSettings();
    const view = $("#ic-view");
    if (!view) return;
    const posts = [...s.posts].reverse();
    if (posts.length === 0) {
        view.innerHTML = `<div class="empty">
            <div class="empty-icon">📷</div>
            <div class="empty-title">ยังไม่มีโพสต์</div>
            <div class="empty-sub">คุยกับตัวละครไปเรื่อยๆ<br>แล้วพวกเขาจะเริ่มโพสต์เอง</div>
        </div>`;
        return;
    }
    view.innerHTML = renderStories() + posts.map(renderPost).join("");
    attachFeedHandlers();
}

function renderStories() {
    const s = getSettings();
    const chars = Object.entries(s.charProfiles).slice(0, 10);
    if (chars.length === 0) return "";
    return `<div class="stories">${chars.map(([name, p]) => `
        <div class="story" data-profile="${escapeHtml(name)}">
            <div class="story-ring"><img src="${escapeHtml(p.avatar)}" onerror="this.src='${defaultAvatar(name)}'"/></div>
            <div class="story-name">${escapeHtml(p.username)}</div>
        </div>
    `).join("")}</div>`;
}

function renderPost(post) {
    const liked = post.userLiked;
    const heart = liked
        ? `<svg viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const npcC = (post.comments || []).slice(0, 3).map(c => `<div class="comment"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div>`).join("");
    const userC = (post.userComments || []).map(c => `<div class="comment"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div>`).join("");
    const total = (post.comments?.length || 0) + (post.userComments?.length || 0);
    const more = total > 3 ? `<div class="more">ดูคอมเมนต์ทั้งหมด ${total} รายการ</div>` : "";
    const tags = (post.hashtags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");
    return `
    <article class="post" data-post="${post.id}">
        <header class="post-head">
            <div class="post-user" data-profile="${escapeHtml(post.author)}">
                <img class="avatar" src="${escapeHtml(post.authorAvatar)}" onerror="this.src='${defaultAvatar(post.author)}'"/>
                <div class="uinfo">
                    <div class="uname">${escapeHtml(post.authorUsername || post.author)}</div>
                    ${post.mood ? `<div class="umood">${escapeHtml(post.mood)}</div>` : ""}
                </div>
            </div>
            <div>⋯</div>
        </header>
        <img class="post-image" src="${escapeHtml(post.image)}" loading="lazy"/>
        <div class="post-actions">
            <button class="act like-btn" data-post="${post.id}">${heart}</button>
            <button class="act"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            <button class="act"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
            <button class="act save-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        </div>
        <div class="likes">${post.likes.toLocaleString()} คนกดใจ</div>
        <div class="caption"><b>${escapeHtml(post.authorUsername || post.author)}</b> ${escapeHtml(post.caption)} ${tags}</div>
        <div class="comments">${npcC}${userC}</div>
        ${more}
        <div class="ptime">${timeAgo(post.timestamp)}ที่แล้ว</div>
        <div class="cbox">
            <input type="text" class="cinput" data-post="${post.id}" placeholder="เพิ่มความคิดเห็น..."/>
            <button class="cpost" data-post="${post.id}">โพสต์</button>
        </div>
    </article>`;
}

function attachFeedHandlers() {
    $$(".like-btn").forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); toggleLike(btn.dataset.post); };
    });
    $$(".post-user, .story").forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            selectedProfile = el.dataset.profile;
            renderProfile(el.dataset.profile);
        };
    });
    $$(".cpost").forEach(btn => {
        btn.onclick = () => addUserComment(btn.dataset.post);
    });
    $$(".cinput").forEach(inp => {
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
    const input = $(`.cinput[data-post="${postId}"]`);
    if (!input || !input.value.trim()) return;
    post.userComments = post.userComments || [];
    post.userComments.push({
        username: s.userProfile.username || getUserName(),
        text: input.value.trim(),
        timestamp: Date.now(),
    });
    input.value = "";
    save();
    renderCurrentTab();
}

function renderProfile(charName) {
    const s = getSettings();
    const profile = ensureCharProfile(charName);
    if (!profile) return;
    const view = $("#ic-view");
    const posts = s.posts.filter(p => p.author === charName).reverse();
    view.innerHTML = `
        <div class="profile-head">
            <button class="back-btn" id="ic-back">←</button>
            <div class="pusername">${escapeHtml(profile.username)}</div>
            <div></div>
        </div>
        <div class="pbody">
            <div class="ptop">
                <img class="pavatar" src="${escapeHtml(profile.avatar)}" onerror="this.src='${defaultAvatar(charName)}'"/>
                <div class="pstats">
                    <div><b>${posts.length}</b><span>โพสต์</span></div>
                    <div><b>${profile.followers.toLocaleString()}</b><span>ผู้ติดตาม</span></div>
                    <div><b>${profile.following.toLocaleString()}</b><span>กำลังติดตาม</span></div>
                </div>
            </div>
            <div class="pname">${escapeHtml(profile.displayName)}</div>
            <div class="pbio">${escapeHtml(profile.bio || "")}</div>
            <div class="pactions">
                <button class="follow-btn ${profile.userFollowing ? 'following' : ''}" id="ic-follow">${profile.userFollowing ? 'กำลังติดตาม' : 'ติดตาม'}</button>
                <button class="msg-btn" id="ic-msg">ข้อความ</button>
            </div>
            <div class="pgrid">
                ${posts.length === 0 ? '<div class="empty-small">ยังไม่มีโพสต์</div>' :
                    posts.map(p => `<div class="gitem" data-post="${p.id}"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")}
            </div>
        </div>`;
    $("#ic-back").onclick = () => { selectedProfile = null; renderCurrentTab(); };
    $("#ic-follow").onclick = () => {
        profile.userFollowing = !profile.userFollowing;
        profile.followers += profile.userFollowing ? 1 : -1;
        save();
        renderProfile(charName);
    };
    $("#ic-msg").onclick = () => { currentTab = "dm"; selectedProfile = null; openDM(charName); };
}

function renderDiscover() {
    const s = getSettings();
    const view = $("#ic-view");
    const posts = [...s.posts].reverse();
    view.innerHTML = `
        <div class="sbar"><input type="text" placeholder="ค้นหา"/></div>
        <div class="dgrid">
            ${posts.map(p => `<div class="gitem" data-profile="${escapeHtml(p.author)}"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")}
        </div>`;
    $$(".gitem").forEach(el => {
        el.onclick = () => { selectedProfile = el.dataset.profile; renderProfile(el.dataset.profile); };
    });
}

function renderCompose() {
    const view = $("#ic-view");
    view.innerHTML = `
        <div class="compose">
            <div class="compose-title">โพสต์ใหม่</div>
            <textarea id="ic-caption" placeholder="เขียน caption..." rows="3"></textarea>
            <label class="clabel">รูป (prompt ภาษาอังกฤษ หรือ URL):</label>
            <input type="text" id="ic-img" placeholder="sunset beach aesthetic หรือ https://..."/>
            <div class="chint">ว่างไว้จะ random ภาพสวยๆ</div>
            <button class="pbtn" id="ic-submit">โพสต์</button>
            <div id="ic-status" style="font-size:13px;color:#a8a8a8;text-align:center"></div>
        </div>`;
    $("#ic-submit").onclick = submitUserPost;
}

async function submitUserPost() {
    const s = getSettings();
    const caption = $("#ic-caption").value.trim();
    const imgInput = $("#ic-img").value.trim();
    const statusEl = $("#ic-status");

    let imageUrl, imagePrompt = imgInput;
    if (imgInput.startsWith("http")) imageUrl = imgInput;
    else { imagePrompt = imgInput || "aesthetic mood photo"; imageUrl = makeImageUrl(imagePrompt); }

    const post = {
        id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
        author: getUserName(),
        authorUsername: s.userProfile.username || sanitizeUsername(getUserName()),
        authorAvatar: s.userProfile.avatar || defaultAvatar(getUserName()),
        caption, hashtags: [], image: imageUrl, imagePrompt,
        timestamp: Date.now(), likes: 0, userLiked: false,
        comments: [], userComments: [], isUserPost: true,
    };
    s.posts.push(post);
    save();
    statusEl.textContent = "กำลังโพสต์...";

    for (const name of Object.keys(s.charProfiles)) {
        try {
            const r = await generateReactionToUserPost(name, post);
            if (r?.like) post.likes += 1;
            if (r?.comment) post.comments.push({ username: s.charProfiles[name].username, text: r.comment, timestamp: Date.now() });
            save();
        } catch {}
    }
    statusEl.textContent = "โพสต์แล้ว ✓";
    setTimeout(() => { currentTab = "feed"; renderCurrentTab(); updateNavActive(); }, 700);
}

function renderDMList() {
    const s = getSettings();
    const view = $("#ic-view");
    const chars = Object.entries(s.charProfiles);
    view.innerHTML = `
        <div class="dmhead"><div class="dmtitle">ข้อความ</div></div>
        <div>${chars.length === 0 ? '<div class="empty-small">ยังไม่มีคนคุย</div>' :
            chars.map(([name, p]) => {
                const thread = s.dms[name] || [];
                const last = thread[thread.length - 1];
                return `<div class="dmitem" data-char="${escapeHtml(name)}">
                    <img class="avatar" src="${escapeHtml(p.avatar)}" onerror="this.src='${defaultAvatar(name)}'"/>
                    <div class="dminfo">
                        <div class="dmname">${escapeHtml(p.displayName)}</div>
                        <div class="dmprev">${last ? escapeHtml(last.text.slice(0, 50)) : "เริ่มคุย..."}</div>
                    </div>
                </div>`;
            }).join("")
        }</div>`;
    $$(".dmitem").forEach(el => { el.onclick = () => openDM(el.dataset.char); });
}

function openDM(charName) {
    const s = getSettings();
    const profile = ensureCharProfile(charName);
    const view = $("#ic-view");
    const thread = s.dms[charName] || [];
    view.innerHTML = `
        <div class="dmchead">
            <button class="back-btn" id="ic-back">←</button>
            <img class="avatar" src="${escapeHtml(profile.avatar)}" onerror="this.src='${defaultAvatar(charName)}'"/>
            <div class="dmcname">${escapeHtml(profile.displayName)}</div>
        </div>
        <div class="dmthread" id="ic-thread">
            ${thread.map(m => `<div class="dmmsg ${m.from === 'user' ? 'user' : 'char'}">${escapeHtml(m.text)}</div>`).join("")}
            ${thread.length === 0 ? '<div class="empty-small">ส่งข้อความแรกเลย</div>' : ''}
        </div>
        <div class="dminput-wrap">
            <input type="text" id="ic-dm-input" placeholder="ข้อความ..."/>
            <button id="ic-dm-send">ส่ง</button>
        </div>`;
    $("#ic-back").onclick = () => { selectedProfile = null; currentTab = "dm"; renderCurrentTab(); };
    const send = async () => {
        const inp = $("#ic-dm-input");
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
    $("#ic-dm-send").onclick = send;
    $("#ic-dm-input").addEventListener("keypress", (e) => { if (e.key === "Enter") send(); });
    const tEl = $("#ic-thread");
    if (tEl) tEl.scrollTop = tEl.scrollHeight;
}

async function generateDMReply(charName) {
    const s = getSettings();
    const thread = s.dms[charName] || [];
    const recent = thread.slice(-8).map(m => `${m.from === "user" ? getUserName() : charName}: ${m.text}`).join("\n");
    const prompt = `[Instagram DM]
You are "${charName}" in a private IG DM with ${getUserName()}.
History:
${recent}

Reply as ${charName}, in Thai, short (1-3 sentences), casual IG DM style. In character. No prefix, no JSON.`;
    try {
        const resp = await quietPrompt(prompt);
        const reply = (resp || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 500);
        if (!reply) return;
        s.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        save();
    } catch (e) { log("DM reply err: " + e.message, true); }
}

function renderMyProfile() {
    const s = getSettings();
    const view = $("#ic-view");
    const myPosts = s.posts.filter(p => p.isUserPost).reverse();
    const uname = s.userProfile.username || getUserName();
    view.innerHTML = `
        <div class="profile-head">
            <div></div>
            <div class="pusername">${escapeHtml(uname)}</div>
            <div></div>
        </div>
        <div class="pbody">
            <div class="ptop">
                <img class="pavatar" src="${escapeHtml(s.userProfile.avatar || defaultAvatar(getUserName()))}"/>
                <div class="pstats">
                    <div><b>${myPosts.length}</b><span>โพสต์</span></div>
                    <div><b>${Object.values(s.charProfiles).filter(p => p.followsUser).length}</b><span>ผู้ติดตาม</span></div>
                    <div><b>${Object.values(s.charProfiles).filter(p => p.userFollowing).length}</b><span>กำลังติดตาม</span></div>
                </div>
            </div>
            <input class="iinput" id="ic-my-name" placeholder="ชื่อที่แสดง" value="${escapeHtml(s.userProfile.displayName || getUserName())}"/>
            <textarea class="iinput" id="ic-my-bio" rows="2" placeholder="ไบโอ...">${escapeHtml(s.userProfile.bio || "")}</textarea>
            <div class="srow">
                <label>Auto-post จากตัวละคร</label>
                <input type="checkbox" id="ic-auto" ${s.autoPost ? 'checked' : ''}/>
            </div>
            <div class="srow">
                <label>ความถี่: <span id="ic-cval">${Math.round(s.postChance * 100)}%</span></label>
                <input type="range" id="ic-chance" min="10" max="100" step="5" value="${Math.round(s.postChance * 100)}"/>
            </div>
            <button class="pbtn" id="ic-save">บันทึก</button>
            <button class="dbtn" id="ic-resetfab">รีเซ็ตตำแหน่งไอคอน 📱</button>
            <button class="dbtn" id="ic-clear">ลบข้อมูลทั้งหมด</button>
            <div class="pgrid">
                ${myPosts.map(p => `<div class="gitem"><img src="${escapeHtml(p.image)}"/></div>`).join("")}
            </div>
        </div>`;
    $("#ic-save").onclick = () => {
        s.userProfile.displayName = $("#ic-my-name").value;
        s.userProfile.bio = $("#ic-my-bio").value;
        s.autoPost = $("#ic-auto").checked;
        s.postChance = parseInt($("#ic-chance").value) / 100;
        save();
        toast("บันทึกแล้ว ✓");
    };
    $("#ic-chance").oninput = (e) => { $("#ic-cval").textContent = e.target.value + "%"; };
    $("#ic-resetfab").onclick = () => resetFabPosition();
    $("#ic-clear").onclick = () => {
        if (!confirm("ลบทั้งหมด?")) return;
        extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        save();
        renderCurrentTab();
    };
}

// ---------- Event hooks ----------
async function onMessageReceived(messageId) {
    try {
        const s = getSettings();
        if (!s.enabled || !s.autoPost) return;
        const msg = getChat()[messageId];
        if (!msg || msg.is_user || msg.is_system) return;
        if (Math.random() > s.postChance) return;
        if (!msg.name) return;
        await maybeGeneratePost(msg.name, msg.mes || "");
    } catch (e) { log("msg handler err: " + e.message, true); }
}
function onChatChanged() {
    try {
        const idx = getCurrentCharIdx();
        const chars = getCharacters();
        if (idx !== undefined && idx !== null && chars[idx]) {
            ensureCharProfile(chars[idx].name);
        }
    } catch {}
}

// ---------- Init ----------
jQuery(async () => {
    log("InstaChar " + VERSION + " init...");
    try {
        getSettings();
        mountUI();
        setInterval(updateClock, 30000);
        if (eventSource && event_types) {
            try {
                if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
                if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
                log("Event listeners bound");
            } catch (e) { log("Event bind: " + e.message, true); }
        }
        setTimeout(() => toast("InstaChar v" + VERSION + " พร้อมใช้งาน 📱"), 800);
        log("Ready!");
    } catch (e) { log("Init FAILED: " + e.message, true); }
});
