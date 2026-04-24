/**
 * InstaChar v0.2.0 - Instagram-style extension for SillyTavern
 * Characters auto-post to IG based on roleplay scenes.
 */

console.log("[InstaChar] Script loaded, starting imports...");

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
    characters,
    this_chid,
    name1,
    generateQuietPrompt,
} from "../../../../script.js";

import {
    extension_settings,
    getContext,
} from "../../../extensions.js";

console.log("[InstaChar] Imports successful");

const MODULE_NAME = "instachar";
const VERSION = "0.2.0";

// ---------- Default Settings ----------
const defaultSettings = {
    enabled: true,
    autoPost: true,
    postChance: 0.35,
    imageModel: "flux",
    fabPosition: { x: null, y: null }, // null = auto
    posts: [],
    dms: {},
    userProfile: {
        username: "",
        displayName: "",
        bio: "",
        avatar: "",
    },
    charProfiles: {},
    unreadCount: 0,
};

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(defaultSettings));
    }
    const s = extension_settings[MODULE_NAME];
    for (const k of Object.keys(defaultSettings)) {
        if (s[k] === undefined) {
            s[k] = JSON.parse(JSON.stringify(defaultSettings[k]));
        }
    }
    return s;
}

function saveSettings() {
    try {
        saveSettingsDebounced();
    } catch (e) {
        console.warn("[InstaChar] saveSettings error:", e);
    }
}

// ---------- Utility ----------
function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff} วิ`;
    if (diff < 3600) return `${Math.floor(diff / 60)} น.`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชม.`;
    return `${Math.floor(diff / 86400)} วัน`;
}

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCharacterAvatar(charName) {
    try {
        const ch = characters.find(c => c.name === charName);
        if (ch && ch.avatar && ch.avatar !== "none") {
            return `/characters/${ch.avatar}`;
        }
    } catch {}
    return defaultAvatar(charName);
}

function defaultAvatar(name) {
    const initial = (name || "?").charAt(0).toUpperCase();
    const colors = ["#e91e63", "#9c27b0", "#3f51b5", "#00bcd4", "#4caf50", "#ff9800", "#f44336"];
    const color = colors[(name || "").length % colors.length];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect fill='${color}' width='80' height='80'/><text x='40' y='52' font-size='36' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function sanitizeUsername(name) {
    if (!name) return "user_" + Math.floor(Math.random() * 9999);
    return name.toLowerCase()
        .replace(/[^a-z0-9_\u0e00-\u0e7f]/g, "")
        .slice(0, 20) || "user";
}

function makeImageUrl(prompt, seed) {
    const s = loadSettings();
    const p = encodeURIComponent(prompt || "aesthetic photo cinematic");
    return `https://image.pollinations.ai/prompt/${p}?width=768&height=768&nologo=true&model=${s.imageModel}&seed=${seed || Math.floor(Math.random() * 99999)}`;
}

// ---------- Character Profile ----------
function ensureCharProfile(charName) {
    if (!charName) return null;
    const s = loadSettings();
    if (!s.charProfiles[charName]) {
        let bio = "";
        try {
            const ch = characters.find(c => c.name === charName);
            bio = ch?.description?.slice(0, 150) || "";
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
        saveSettings();
    }
    return s.charProfiles[charName];
}

// ---------- Post Generation ----------
async function maybeGeneratePost(charName, messageText) {
    const s = loadSettings();
    if (!s.enabled || !s.autoPost) return;

    ensureCharProfile(charName);

    const prompt = `[System: Instagram Simulator]
You are simulating Instagram for the character "${charName}". The character just experienced this scene:

"${messageText.slice(0, 800)}"

Decide: Would ${charName} post on Instagram right now based on their personality?

If YES, respond ONLY with valid JSON:
{
  "post": true,
  "caption": "Caption in Thai matching ${charName}'s personality",
  "imagePrompt": "English prompt for AI image generation describing the scene/aesthetic",
  "hashtags": ["#tag1"],
  "mood": "happy|sad|flirty|chill|excited|moody|proud|angry"
}

If NO: {"post": false}

Respond ONLY with JSON. No explanations, no markdown fences.`;

    try {
        const response = await generateQuietPrompt(prompt, false, false);
        const data = parseJson(response);
        if (!data || !data.post) return;

        const profile = s.charProfiles[charName];
        const baseFame = profile.followers || 1000;
        const likes = Math.max(5, Math.floor(baseFame * (0.3 + Math.random() * 1.4) / 10));

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

        saveSettings();
        flashBadge();
        if (isAppOpen() && currentTab === "feed") renderFeed();
    } catch (e) {
        console.warn("[InstaChar] post generation failed:", e);
    }
}

async function generateComments(authorName, post, sceneContext) {
    const userName = name1 || "User";
    const recentMessages = chat.slice(-10).map(m => m.mes || "").join("\n");

    const prompt = `[System: Instagram Comments]
Character "${authorName}" just posted on Instagram:
- Caption: "${post.caption}"
- Mood: ${post.mood}
- Scene: "${sceneContext.slice(0, 400)}"

Recent chat context:
"${recentMessages.slice(-1200)}"

Generate 2-5 realistic Thai IG comments from NPCs/friends in the scene or random followers. NOT from "${userName}" (user) or "${authorName}" (poster).

Respond ONLY with JSON array:
[{"username": "name", "text": "comment in thai"}]

No other text, no markdown fences.`;

    try {
        const response = await generateQuietPrompt(prompt, false, false);
        const arr = parseJson(response);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, 6).map(c => ({
            username: c.username || "user_" + Math.floor(Math.random() * 999),
            text: c.text || "",
            timestamp: Date.now(),
        }));
    } catch (e) {
        console.warn("[InstaChar] comments gen failed:", e);
        return [];
    }
}

async function generateCharacterReactionToUserPost(charName, userPost) {
    const prompt = `[System: Instagram Reaction]
User posted on Instagram:
- Caption: "${userPost.caption}"
- Image: "${userPost.imagePrompt || 'photo'}"

Character "${charName}" sees this. Based on their personality and relationship:
Respond ONLY with JSON:
{"like": true|false, "comment": "thai comment or null"}

No other text.`;

    try {
        const response = await generateQuietPrompt(prompt, false, false);
        return parseJson(response);
    } catch {
        return { like: Math.random() < 0.5, comment: null };
    }
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
    try {
        return JSON.parse(t);
    } catch {
        for (let i = t.length - 1; i > 0; i--) {
            if (t[i] === "}" || t[i] === "]") {
                try {
                    return JSON.parse(t.slice(0, i + 1));
                } catch {}
            }
        }
        return null;
    }
}

// ---------- FAB (Draggable) ----------
let fabDragState = null;

function injectFAB() {
    let fab = document.getElementById("ic-fab");
    if (fab) fab.remove();

    fab = document.createElement("div");
    fab.id = "ic-fab";
    fab.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
        <span id="ic-badge" class="ic-hidden">0</span>
    `;

    // Apply initial position
    const s = loadSettings();
    if (s.fabPosition.x !== null && s.fabPosition.y !== null) {
        fab.style.left = s.fabPosition.x + "px";
        fab.style.top = s.fabPosition.y + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
    }

    document.body.appendChild(fab);
    attachFabDrag(fab);
    updateBadge();
    console.log("[InstaChar] FAB injected at:", fab.getBoundingClientRect());
}

function attachFabDrag(fab) {
    let startX, startY, origX, origY;
    let isDragging = false;
    let pressTimer = null;

    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        startX = p.clientX;
        startY = p.clientY;
        const rect = fab.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        isDragging = false;
        fab.style.transition = "none";
    };

    const onMove = (e) => {
        if (startX === undefined) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX;
        const dy = p.clientY - startY;
        if (!isDragging && Math.abs(dx) + Math.abs(dy) > 8) {
            isDragging = true;
            fab.classList.add("ic-dragging");
        }
        if (isDragging) {
            e.preventDefault();
            const nx = Math.max(4, Math.min(window.innerWidth - fab.offsetWidth - 4, origX + dx));
            const ny = Math.max(4, Math.min(window.innerHeight - fab.offsetHeight - 4, origY + dy));
            fab.style.left = nx + "px";
            fab.style.top = ny + "px";
            fab.style.right = "auto";
            fab.style.bottom = "auto";
        }
    };

    const onUp = (e) => {
        if (startX === undefined) return;
        fab.style.transition = "";
        fab.classList.remove("ic-dragging");
        if (isDragging) {
            // Save position
            const rect = fab.getBoundingClientRect();
            const s = loadSettings();
            s.fabPosition = { x: rect.left, y: rect.top };
            saveSettings();
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
    const s = loadSettings();
    s.fabPosition = { x: null, y: null };
    saveSettings();
    injectFAB();
}

// ---------- UI Shell ----------
let currentTab = "feed";
let selectedProfile = null;

function injectOverlay() {
    let overlay = document.getElementById("ic-overlay");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.id = "ic-overlay";
    overlay.className = "ic-hidden";
    overlay.innerHTML = renderAppShell();
    document.body.appendChild(overlay);
    attachShellHandlers();
}

function renderAppShell() {
    return `
    <div id="ic-phone">
        <div class="ic-statusbar">
            <span id="ic-clock">—</span>
            <div class="ic-status-icons"><span>📶</span><span>🔋</span></div>
        </div>
        <div class="ic-topbar">
            <div class="ic-topbar-title">Instagram</div>
            <div class="ic-topbar-actions">
                <button class="ic-icon-btn" id="ic-btn-refresh" title="Refresh">⟳</button>
                <button class="ic-icon-btn" id="ic-btn-close" title="Close">✕</button>
            </div>
        </div>
        <div id="ic-screen"><div id="ic-view"></div></div>
        <div class="ic-nav">
            <button class="ic-nav-item" data-tab="feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></button>
            <button class="ic-nav-item" data-tab="discover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>
            <button class="ic-nav-item" data-tab="post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></button>
            <button class="ic-nav-item" data-tab="dm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></button>
            <button class="ic-nav-item" data-tab="profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>
        </div>
    </div>
    `;
}

function attachShellHandlers() {
    document.getElementById("ic-btn-close").onclick = closeApp;
    document.getElementById("ic-btn-refresh").onclick = () => renderCurrentTab();
    document.querySelectorAll(".ic-nav-item").forEach(btn => {
        btn.onclick = () => {
            currentTab = btn.dataset.tab;
            selectedProfile = null;
            renderCurrentTab();
            updateNavActive();
        };
    });
    document.getElementById("ic-overlay").addEventListener("click", (e) => {
        if (e.target.id === "ic-overlay") closeApp();
    });
}

function updateNavActive() {
    document.querySelectorAll(".ic-nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === currentTab);
    });
}

function isAppOpen() {
    const el = document.getElementById("ic-overlay");
    return el && !el.classList.contains("ic-hidden");
}

function openApp() {
    const overlay = document.getElementById("ic-overlay");
    if (!overlay) return;
    overlay.classList.remove("ic-hidden");
    const s = loadSettings();
    s.unreadCount = 0;
    saveSettings();
    updateBadge();
    renderCurrentTab();
    updateNavActive();
    updateClock();
}

function closeApp() {
    const overlay = document.getElementById("ic-overlay");
    if (overlay) overlay.classList.add("ic-hidden");
}

function toggleApp() {
    if (isAppOpen()) closeApp();
    else openApp();
}

function updateClock() {
    const el = document.getElementById("ic-clock");
    if (!el) return;
    const d = new Date();
    el.textContent = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function updateBadge() {
    const s = loadSettings();
    const badge = document.getElementById("ic-badge");
    if (!badge) return;
    if (s.unreadCount > 0) {
        badge.textContent = s.unreadCount > 99 ? "99+" : s.unreadCount;
        badge.classList.remove("ic-hidden");
    } else {
        badge.classList.add("ic-hidden");
    }
}

function flashBadge() {
    updateBadge();
    const fab = document.getElementById("ic-fab");
    if (fab) {
        fab.classList.add("ic-pulse");
        setTimeout(() => fab.classList.remove("ic-pulse"), 1500);
    }
}

// ---------- Renderers ----------
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
    const s = loadSettings();
    const view = document.getElementById("ic-view");
    if (!view) return;
    const posts = [...s.posts].reverse();

    if (posts.length === 0) {
        view.innerHTML = `
            <div class="ic-empty">
                <div class="ic-empty-icon">📷</div>
                <div class="ic-empty-title">ยังไม่มีโพสต์</div>
                <div class="ic-empty-sub">คุยกับตัวละครไปเรื่อยๆ<br>แล้วพวกเขาจะเริ่มโพสต์เอง</div>
            </div>`;
        return;
    }

    view.innerHTML = renderStoriesBar() + posts.map(renderPostCard).join("");
    attachFeedHandlers();
}

function renderStoriesBar() {
    const s = loadSettings();
    const chars = Object.entries(s.charProfiles).slice(0, 10);
    if (chars.length === 0) return "";
    return `<div class="ic-stories">${chars.map(([name, p]) => `
        <div class="ic-story" data-profile="${escapeHtml(name)}">
            <div class="ic-story-ring"><img src="${escapeHtml(p.avatar)}" onerror="this.src='${defaultAvatar(name)}'"/></div>
            <div class="ic-story-name">${escapeHtml(p.username)}</div>
        </div>
    `).join("")}</div>`;
}

function renderPostCard(post) {
    const liked = post.userLiked;
    const heart = liked ?
        `<svg viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>` :
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

    const npcComments = (post.comments || []).slice(0, 3).map(c => `
        <div class="ic-comment"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div>
    `).join("");
    const userComments = (post.userComments || []).map(c => `
        <div class="ic-comment"><b>${escapeHtml(c.username)}</b> ${escapeHtml(c.text)}</div>
    `).join("");
    const totalComments = (post.comments?.length || 0) + (post.userComments?.length || 0);
    const moreComments = totalComments > 3 ? `<div class="ic-comment-more">ดูคอมเมนต์ทั้งหมด ${totalComments} รายการ</div>` : "";
    const hashtagHtml = (post.hashtags || []).map(t => `<span class="ic-tag">${escapeHtml(t)}</span>`).join(" ");

    return `
    <article class="ic-post" data-post="${post.id}">
        <header class="ic-post-head">
            <div class="ic-post-user" data-profile="${escapeHtml(post.author)}">
                <img class="ic-avatar" src="${escapeHtml(post.authorAvatar)}" onerror="this.src='${defaultAvatar(post.author)}'"/>
                <div class="ic-post-user-info">
                    <div class="ic-username">${escapeHtml(post.authorUsername || post.author)}</div>
                    ${post.mood ? `<div class="ic-post-mood">${escapeHtml(post.mood)}</div>` : ""}
                </div>
            </div>
            <div class="ic-post-menu">⋯</div>
        </header>
        <div class="ic-post-image-wrap">
            <img class="ic-post-image" src="${escapeHtml(post.image)}" loading="lazy"/>
            <div class="ic-post-double-heart"></div>
        </div>
        <div class="ic-post-actions">
            <button class="ic-act-btn ic-like-btn ${liked ? 'liked' : ''}" data-post="${post.id}">${heart}</button>
            <button class="ic-act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            <button class="ic-act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
            <button class="ic-act-btn ic-save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        </div>
        <div class="ic-post-likes">${post.likes.toLocaleString()} คนกดใจ</div>
        <div class="ic-post-caption"><b>${escapeHtml(post.authorUsername || post.author)}</b> ${escapeHtml(post.caption)} ${hashtagHtml}</div>
        <div class="ic-post-comments">${npcComments}${userComments}</div>
        ${moreComments}
        <div class="ic-post-time">${timeAgo(post.timestamp)}ที่แล้ว</div>
        <div class="ic-comment-box">
            <input type="text" class="ic-comment-input" data-post="${post.id}" placeholder="เพิ่มความคิดเห็น..."/>
            <button class="ic-comment-post" data-post="${post.id}">โพสต์</button>
        </div>
    </article>
    `;
}

function attachFeedHandlers() {
    document.querySelectorAll(".ic-like-btn").forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); toggleLike(btn.dataset.post); };
    });
    document.querySelectorAll(".ic-post-user, .ic-story").forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            selectedProfile = el.dataset.profile;
            renderProfile(el.dataset.profile);
        };
    });
    document.querySelectorAll(".ic-comment-post").forEach(btn => {
        btn.onclick = () => addUserComment(btn.dataset.post);
    });
    document.querySelectorAll(".ic-comment-input").forEach(inp => {
        inp.addEventListener("keypress", (e) => {
            if (e.key === "Enter") addUserComment(inp.dataset.post);
        });
    });
    document.querySelectorAll(".ic-post-image-wrap").forEach(wrap => {
        let lastTap = 0;
        wrap.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastTap < 400) {
                const postId = wrap.closest(".ic-post").dataset.post;
                const likeBtn = wrap.closest(".ic-post").querySelector(".ic-like-btn");
                if (!likeBtn.classList.contains("liked")) toggleLike(postId);
                const heart = wrap.querySelector(".ic-post-double-heart");
                heart.classList.add("show");
                setTimeout(() => heart.classList.remove("show"), 800);
            }
            lastTap = now;
        });
    });
}

function toggleLike(postId) {
    const s = loadSettings();
    const post = s.posts.find(p => p.id === postId);
    if (!post) return;
    post.userLiked = !post.userLiked;
    post.likes += post.userLiked ? 1 : -1;
    saveSettings();
    renderCurrentTab();
}

function addUserComment(postId) {
    const s = loadSettings();
    const post = s.posts.find(p => p.id === postId);
    if (!post) return;
    const input = document.querySelector(`.ic-comment-input[data-post="${postId}"]`);
    if (!input || !input.value.trim()) return;
    post.userComments = post.userComments || [];
    post.userComments.push({
        username: s.userProfile.username || name1 || "you",
        text: input.value.trim(),
        timestamp: Date.now(),
    });
    input.value = "";
    saveSettings();
    renderCurrentTab();
}

// ---------- Profile ----------
function renderProfile(charName) {
    const s = loadSettings();
    const profile = ensureCharProfile(charName);
    if (!profile) return;
    const view = document.getElementById("ic-view");
    const posts = s.posts.filter(p => p.author === charName).reverse();

    view.innerHTML = `
        <div class="ic-profile-head">
            <button class="ic-back-btn" id="ic-back">←</button>
            <div class="ic-profile-username">${escapeHtml(profile.username)}</div>
            <div></div>
        </div>
        <div class="ic-profile-body">
            <div class="ic-profile-top">
                <img class="ic-profile-avatar" src="${escapeHtml(profile.avatar)}" onerror="this.src='${defaultAvatar(charName)}'"/>
                <div class="ic-profile-stats">
                    <div><b>${posts.length}</b><span>โพสต์</span></div>
                    <div><b>${profile.followers.toLocaleString()}</b><span>ผู้ติดตาม</span></div>
                    <div><b>${profile.following.toLocaleString()}</b><span>กำลังติดตาม</span></div>
                </div>
            </div>
            <div class="ic-profile-name">${escapeHtml(profile.displayName)}</div>
            <div class="ic-profile-bio">${escapeHtml(profile.bio || "")}</div>
            <div class="ic-profile-actions">
                <button class="ic-follow-btn ${profile.userFollowing ? 'following' : ''}" id="ic-follow">
                    ${profile.userFollowing ? 'กำลังติดตาม' : 'ติดตาม'}
                </button>
                <button class="ic-msg-btn" id="ic-msg">ข้อความ</button>
            </div>
            <div class="ic-profile-grid">
                ${posts.length === 0 ? '<div class="ic-empty-small">ยังไม่มีโพสต์</div>' :
                    posts.map(p => `<div class="ic-grid-item" data-post="${p.id}"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")}
            </div>
        </div>
    `;
    document.getElementById("ic-back").onclick = () => { selectedProfile = null; renderCurrentTab(); };
    document.getElementById("ic-follow").onclick = () => {
        profile.userFollowing = !profile.userFollowing;
        profile.followers += profile.userFollowing ? 1 : -1;
        saveSettings();
        renderProfile(charName);
    };
    document.getElementById("ic-msg").onclick = () => {
        currentTab = "dm";
        selectedProfile = null;
        openDM(charName);
    };
}

// ---------- Discover ----------
function renderDiscover() {
    const s = loadSettings();
    const view = document.getElementById("ic-view");
    const posts = [...s.posts].reverse();
    view.innerHTML = `
        <div class="ic-search-bar"><input type="text" placeholder="ค้นหา"/></div>
        <div class="ic-discover-grid">
            ${posts.map((p, i) => `<div class="ic-grid-item ${i % 7 === 2 ? 'ic-grid-tall' : ''}" data-profile="${escapeHtml(p.author)}"><img src="${escapeHtml(p.image)}" loading="lazy"/></div>`).join("")}
        </div>
    `;
    document.querySelectorAll(".ic-grid-item").forEach(el => {
        el.onclick = () => { selectedProfile = el.dataset.profile; renderProfile(el.dataset.profile); };
    });
}

// ---------- Compose ----------
function renderCompose() {
    const view = document.getElementById("ic-view");
    view.innerHTML = `
        <div class="ic-compose">
            <div class="ic-compose-title">โพสต์ใหม่</div>
            <textarea id="ic-compose-caption" placeholder="เขียน caption..." rows="3"></textarea>
            <label class="ic-compose-label">รูป (prompt ภาษาอังกฤษ หรือ URL):</label>
            <input type="text" id="ic-compose-image" placeholder="sunset beach aesthetic หรือ https://..."/>
            <div class="ic-compose-hint">ว่างไว้จะ random ภาพสวยๆ</div>
            <button id="ic-compose-post" class="ic-primary-btn">โพสต์</button>
            <div id="ic-compose-status"></div>
        </div>
    `;
    document.getElementById("ic-compose-post").onclick = submitUserPost;
}

async function submitUserPost() {
    const s = loadSettings();
    const caption = document.getElementById("ic-compose-caption").value.trim();
    const imgInput = document.getElementById("ic-compose-image").value.trim();
    const statusEl = document.getElementById("ic-compose-status");

    let imageUrl, imagePrompt = imgInput;
    if (imgInput.startsWith("http")) {
        imageUrl = imgInput;
    } else {
        imagePrompt = imgInput || "aesthetic mood photo cinematic";
        imageUrl = makeImageUrl(imagePrompt);
    }

    const post = {
        id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
        author: name1 || "You",
        authorUsername: s.userProfile.username || sanitizeUsername(name1 || "you"),
        authorAvatar: s.userProfile.avatar || defaultAvatar(name1 || "you"),
        caption, hashtags: [], image: imageUrl, imagePrompt,
        timestamp: Date.now(), likes: 0, userLiked: false,
        comments: [], userComments: [], isUserPost: true,
    };
    s.posts.push(post);
    saveSettings();

    statusEl.textContent = "กำลังโพสต์...";

    const charNames = Object.keys(s.charProfiles);
    for (const name of charNames) {
        try {
            const reaction = await generateCharacterReactionToUserPost(name, post);
            if (reaction?.like) post.likes += 1;
            if (reaction?.comment) {
                post.comments.push({
                    username: s.charProfiles[name].username,
                    text: reaction.comment,
                    timestamp: Date.now(),
                });
            }
            saveSettings();
        } catch {}
    }

    statusEl.textContent = "โพสต์แล้ว ✓";
    setTimeout(() => { currentTab = "feed"; renderCurrentTab(); updateNavActive(); }, 700);
}

// ---------- DM ----------
function renderDMList() {
    const s = loadSettings();
    const view = document.getElementById("ic-view");
    const chars = Object.entries(s.charProfiles);
    view.innerHTML = `
        <div class="ic-dm-header"><div class="ic-dm-title">ข้อความ</div></div>
        <div class="ic-dm-list">
            ${chars.length === 0 ? '<div class="ic-empty-small">ยังไม่มีคนคุย</div>' :
                chars.map(([name, p]) => {
                    const thread = s.dms[name] || [];
                    const last = thread[thread.length - 1];
                    return `<div class="ic-dm-item" data-char="${escapeHtml(name)}">
                        <img class="ic-avatar" src="${escapeHtml(p.avatar)}" onerror="this.src='${defaultAvatar(name)}'"/>
                        <div class="ic-dm-info">
                            <div class="ic-dm-name">${escapeHtml(p.displayName)}</div>
                            <div class="ic-dm-preview">${last ? escapeHtml(last.text.slice(0, 50)) : "เริ่มคุย..."}</div>
                        </div>
                    </div>`;
                }).join("")}
        </div>
    `;
    document.querySelectorAll(".ic-dm-item").forEach(el => {
        el.onclick = () => openDM(el.dataset.char);
    });
}

function openDM(charName) {
    const s = loadSettings();
    const profile = ensureCharProfile(charName);
    const view = document.getElementById("ic-view");
    const thread = s.dms[charName] || [];
    view.innerHTML = `
        <div class="ic-dm-chat-head">
            <button class="ic-back-btn" id="ic-back">←</button>
            <img class="ic-avatar" src="${escapeHtml(profile.avatar)}" onerror="this.src='${defaultAvatar(charName)}'"/>
            <div class="ic-dm-chat-name">${escapeHtml(profile.displayName)}</div>
        </div>
        <div class="ic-dm-thread" id="ic-dm-thread">
            ${thread.map(m => `<div class="ic-dm-msg ${m.from === 'user' ? 'user' : 'char'}">${escapeHtml(m.text)}</div>`).join("")}
            ${thread.length === 0 ? '<div class="ic-empty-small">ส่งข้อความแรกเลย</div>' : ''}
        </div>
        <div class="ic-dm-input-wrap">
            <input type="text" id="ic-dm-input" placeholder="ข้อความ..."/>
            <button id="ic-dm-send">ส่ง</button>
        </div>
    `;
    document.getElementById("ic-back").onclick = () => { selectedProfile = null; currentTab = "dm"; renderCurrentTab(); };
    const send = async () => {
        const inp = document.getElementById("ic-dm-input");
        const text = inp.value.trim();
        if (!text) return;
        s.dms[charName] = s.dms[charName] || [];
        s.dms[charName].push({ from: "user", text, timestamp: Date.now() });
        inp.value = "";
        saveSettings();
        openDM(charName);
        await generateDMReply(charName);
        openDM(charName);
    };
    document.getElementById("ic-dm-send").onclick = send;
    document.getElementById("ic-dm-input").addEventListener("keypress", (e) => { if (e.key === "Enter") send(); });
    const threadEl = document.getElementById("ic-dm-thread");
    threadEl.scrollTop = threadEl.scrollHeight;
}

async function generateDMReply(charName) {
    const s = loadSettings();
    const thread = s.dms[charName] || [];
    const recent = thread.slice(-8).map(m => `${m.from === "user" ? (name1 || "User") : charName}: ${m.text}`).join("\n");
    const prompt = `[System: Instagram DM]
You are roleplaying as "${charName}" in a private Instagram DM with ${name1 || "the user"}.

Recent history:
${recent}

Reply as ${charName} naturally, in Thai, short (1-3 sentences), casual IG DM style. Stay in character.
Reply directly, no prefix, no JSON.`;
    try {
        const response = await generateQuietPrompt(prompt, false, false);
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 500);
        if (!reply) return;
        s.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        saveSettings();
    } catch (e) {
        console.warn("[InstaChar] DM reply failed:", e);
    }
}

// ---------- My Profile ----------
function renderMyProfile() {
    const s = loadSettings();
    const view = document.getElementById("ic-view");
    const myPosts = s.posts.filter(p => p.isUserPost).reverse();
    view.innerHTML = `
        <div class="ic-profile-head">
            <div></div>
            <div class="ic-profile-username">${escapeHtml(s.userProfile.username || name1 || "you")}</div>
            <div></div>
        </div>
        <div class="ic-profile-body">
            <div class="ic-profile-top">
                <img class="ic-profile-avatar" src="${escapeHtml(s.userProfile.avatar || defaultAvatar(name1 || "you"))}"/>
                <div class="ic-profile-stats">
                    <div><b>${myPosts.length}</b><span>โพสต์</span></div>
                    <div><b>${Object.values(s.charProfiles).filter(p => p.followsUser).length}</b><span>ผู้ติดตาม</span></div>
                    <div><b>${Object.values(s.charProfiles).filter(p => p.userFollowing).length}</b><span>กำลังติดตาม</span></div>
                </div>
            </div>
            <input class="ic-inline-input" id="ic-my-name" placeholder="ชื่อที่แสดง" value="${escapeHtml(s.userProfile.displayName || name1 || "")}"/>
            <textarea class="ic-inline-input" id="ic-my-bio" rows="2" placeholder="ไบโอ...">${escapeHtml(s.userProfile.bio || "")}</textarea>
            <div class="ic-settings-row">
                <label>Auto-post จากตัวละคร</label>
                <input type="checkbox" id="ic-auto-post" ${s.autoPost ? 'checked' : ''}/>
            </div>
            <div class="ic-settings-row">
                <label>ความถี่: <span id="ic-chance-val">${Math.round(s.postChance * 100)}%</span></label>
                <input type="range" id="ic-chance" min="10" max="100" step="5" value="${Math.round(s.postChance * 100)}"/>
            </div>
            <button class="ic-primary-btn" id="ic-save-profile">บันทึก</button>
            <button class="ic-danger-btn" id="ic-reset-fab">รีเซ็ตตำแหน่งไอคอน 📱</button>
            <button class="ic-danger-btn" id="ic-clear">ลบข้อมูลทั้งหมด</button>
            <div class="ic-profile-grid">
                ${myPosts.map(p => `<div class="ic-grid-item"><img src="${escapeHtml(p.image)}"/></div>`).join("")}
            </div>
        </div>
    `;
    document.getElementById("ic-save-profile").onclick = () => {
        s.userProfile.displayName = document.getElementById("ic-my-name").value;
        s.userProfile.bio = document.getElementById("ic-my-bio").value;
        s.autoPost = document.getElementById("ic-auto-post").checked;
        s.postChance = parseInt(document.getElementById("ic-chance").value) / 100;
        saveSettings();
        toast("บันทึกแล้ว ✓");
    };
    document.getElementById("ic-chance").oninput = (e) => {
        document.getElementById("ic-chance-val").textContent = e.target.value + "%";
    };
    document.getElementById("ic-reset-fab").onclick = () => {
        resetFabPosition();
        toast("รีเซ็ตตำแหน่งแล้ว ✓");
    };
    document.getElementById("ic-clear").onclick = () => {
        if (!confirm("ลบโพสต์ DM และข้อมูลทั้งหมด?")) return;
        extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(defaultSettings));
        saveSettings();
        renderCurrentTab();
    };
}

function toast(msg) {
    let t = document.getElementById("ic-toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "ic-toast";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Event Hooks ----------
async function onMessageReceived(messageId) {
    try {
        const s = loadSettings();
        if (!s.enabled || !s.autoPost) return;
        const msg = chat[messageId];
        if (!msg || msg.is_user || msg.is_system) return;
        if (Math.random() > s.postChance) return;
        if (!msg.name) return;
        await maybeGeneratePost(msg.name, msg.mes || "");
    } catch (e) {
        console.warn("[InstaChar] message handler error:", e);
    }
}

function onChatChanged() {
    try {
        if (this_chid !== undefined && characters[this_chid]) {
            ensureCharProfile(characters[this_chid].name);
        }
    } catch {}
}

// ---------- Slash Command ----------
function registerSlashCommand() {
    try {
        // Try to use modern slash command system
        import("../../../slash-commands/SlashCommandParser.js").then(m => {
            import("../../../slash-commands/SlashCommand.js").then(mm => {
                m.SlashCommandParser.addCommandObject(mm.SlashCommand.fromProps({
                    name: "insta",
                    callback: () => {
                        resetFabPosition();
                        toast("InstaChar: รีเซ็ตตำแหน่งไอคอนแล้ว");
                        return "";
                    },
                    helpString: "Reset InstaChar FAB position",
                }));
                console.log("[InstaChar] Slash command /insta registered");
            });
        }).catch(() => {
            console.log("[InstaChar] Slash command system not available");
        });
    } catch (e) {
        console.log("[InstaChar] Slash command registration skipped:", e.message);
    }
}

// ---------- Init ----------
function init() {
    console.log(`[InstaChar] Initializing v${VERSION}...`);
    try {
        loadSettings();
        injectFAB();
        injectOverlay();
        setInterval(updateClock, 30000);

        if (eventSource && event_types) {
            eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
            eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
            console.log("[InstaChar] Event listeners registered");
        } else {
            console.warn("[InstaChar] eventSource unavailable, auto-post disabled");
        }

        registerSlashCommand();
        console.log(`[InstaChar] v${VERSION} loaded ✓`);
    } catch (e) {
        console.error("[InstaChar] init failed:", e);
    }
}

// Wait for jQuery and DOM ready
if (typeof jQuery !== "undefined") {
    jQuery(init);
} else {
    document.addEventListener("DOMContentLoaded", init);
}
