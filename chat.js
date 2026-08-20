if (!API.isAuthenticated()) window.location.href = 'index.html';

const currentUser = JSON.parse(localStorage.getItem('lumaCurrentUser') || '{}');
let selectedCompanionId = localStorage.getItem('selectedCompanion') || 'aria';
let currentCompanion = null;
let isTyping = false;
let allCompanions = [];

// ── Toast ──────────────────────────────────────────────
function showToast(msg, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(8px)';
        t.style.transition = 'all 0.25s ease';
        setTimeout(() => t.remove(), 260);
    }, 3000);
}

// ── Voice ──────────────────────────────────────────────
function findBestVoice(vc) {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const targetLang = vc.language || 'en-US';
    const targetGender = vc.gender || 'female';
    const styleHints = {
        cheerful: ['samantha','tessa','karen'], gentle: ['moira','karen','hazel'],
        energetic: ['daniel','aaron','matthew'], contemplative: ['moira','hazel','zira'],
        cute: ['samantha','tessa','zira'], playful: ['samantha','tessa'], mysterious: ['moira','hazel']
    };
    const genderHints = {
        female: ['female','samantha','karen','moira','tessa','zira','hazel','google uk english female','google us english','microsoft zira','microsoft hazel'],
        male: ['male','daniel','tom','aaron','matthew','google uk english male','microsoft mark','microsoft david','microsoft james']
    };
    let candidates = voices.filter(v => v.lang && v.lang.startsWith(targetLang.split('-')[0]));
    if (!candidates.length) candidates = voices;
    let best = null, bestScore = -1;
    candidates.forEach(v => {
        let score = 0;
        const nl = (v.name || '').toLowerCase();
        if (targetGender === 'female' && !nl.match(/male|daniel|tom|matthew|aaron|david|james|mark/)) score += 3;
        if (targetGender === 'male' && nl.match(/male|daniel|tom|matthew|aaron|david|james|mark/)) score += 3;
        (styleHints[vc.style] || []).forEach(sn => { if (nl.includes(sn)) score += 5; });
        (genderHints[targetGender] || []).forEach(gn => { if (nl.includes(gn)) score += 2; });
        if (v.lang && v.lang.startsWith(targetLang)) score += 1;
        if (score > bestScore) { bestScore = score; best = v; }
    });
    return best;
}

function speak(text, btn) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const clean = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
    if (!clean) return;
    if (btn) btn.classList.add('speaking');
    const vc = (currentCompanion && currentCompanion.voice_config) || {};
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = findBestVoice(vc);
    if (voice) utterance.voice = voice;
    utterance.pitch = vc.pitch || 1.0;
    utterance.rate = vc.rate || 1.0;
    utterance.volume = vc.volume || 1.0;
    utterance.lang = vc.language || 'en-US';
    utterance.onend = () => { if (btn) btn.classList.remove('speaking'); };
    utterance.onerror = () => { if (btn) btn.classList.remove('speaking'); };
    speechSynthesis.speak(utterance);
}

if (window.speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
}

// ── Sidebar ────────────────────────────────────────────
async function renderSidebar() {
    const list = document.getElementById('chatList');
    if (!list) return;
    try {
        allCompanions = await API.getCompanions();
        list.innerHTML = '';
        allCompanions.forEach(c => {
            const item = document.createElement('div');
            item.className = 'chat-item' + (c.id === selectedCompanionId ? ' active' : '');
            item.dataset.id = c.id;
            const mood = c.current_mood || {};
            item.innerHTML = `
                <div class="chat-item-avatar" style="background:${c.color}">${c.avatar_initial}</div>
                <div class="chat-item-info">
                    <span class="chat-item-name">${c.name}</span>
                    <span class="chat-item-sub">${mood.display || c.bio.substring(0, 28)}</span>
                </div>`;
            item.addEventListener('click', () => switchCompanion(c.id));
            list.appendChild(item);
        });
    } catch (e) {
        console.error('sidebar render failed:', e);
    }
}

function switchCompanion(id) {
    selectedCompanionId = id;
    localStorage.setItem('selectedCompanion', id);
    // update active state
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });
    loadCompanion(id);
    // close sidebar on mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
}

// ── User info in sidebar ───────────────────────────────
function initUserInfo() {
    const name = currentUser.name || 'User';
    const nameEl = document.getElementById('sidebarUserName');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
}

// ── Load companion ─────────────────────────────────────
async function loadCompanion(companionId) {
    try {
        currentCompanion = await API.getCompanion(companionId);
        updateHeader();
        updateRightPanel();
        loadChatHistory();
        loadVoiceSettings();
    } catch (e) {
        console.error('loadCompanion failed:', e);
    }
}

function updateHeader() {
    if (!currentCompanion) return;
    const c = currentCompanion;
    const headerAvatar = document.getElementById('headerAvatar');
    const companionName = document.getElementById('companionName');
    if (headerAvatar) { headerAvatar.textContent = c.avatar_initial; headerAvatar.style.background = c.color; }
    if (companionName) companionName.textContent = c.name;

    // Update empty state
    const emptyAvatar = document.getElementById('chatEmptyAvatar');
    const emptyName = document.getElementById('chatEmptyName');
    const emptyBio = document.getElementById('chatEmptyBio');
    if (emptyAvatar) { emptyAvatar.textContent = c.avatar_initial; emptyAvatar.style.background = c.color; }
    if (emptyName) emptyName.textContent = `Chat with ${c.name}`;
    if (emptyBio) emptyBio.textContent = c.bio;
}

function updateRightPanel() {
    if (!currentCompanion) return;
    const c = currentCompanion;

    const avatar = document.getElementById('profileAvatar');
    if (avatar) { avatar.textContent = c.avatar_initial; avatar.style.background = c.color; }

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('profileName', c.name);
    setTxt('profileAge', c.age + ' years old');

    const mood = c.current_mood || { display: '😊 feeling cheerful' };
    setTxt('profileMood', mood.display);

    const rel = c.relationship || { level: 1, xp: 0 };
    setTxt('relLevel', 'Level ' + rel.level);
    setTxt('relXp', rel.xp + ' XP');
    const pf = document.getElementById('progressFill');
    if (pf) pf.style.width = (rel.xp % 100) + '%';

    const traits = c.personality ? c.personality.core : [];
    const tc = document.getElementById('traitsContainer');
    if (tc) tc.innerHTML = traits.map(t => `<span class="trait-chip">${t}</span>`).join('');

    updateMemoriesPanel(c.memories || []);
}

function updateMemoriesPanel(memories) {
    const ml = document.getElementById('memoriesList');
    const mc = document.getElementById('memCount');
    if (mc) mc.textContent = memories.length;
    if (!ml) return;
    if (memories.length === 0) {
        ml.innerHTML = '<div class="mem-empty">No memories yet</div>';
        return;
    }
    ml.innerHTML = memories.slice(0, 10).map(m => `
        <div class="mem-item">
            <span class="mem-tag ${m.category}">${m.category.replace('_', ' ')}</span>
            <span class="mem-text">${m.content.substring(0, 60)}</span>
            <button class="mem-delete" data-id="${m.id}" title="Delete">×</button>
        </div>`).join('');
    ml.querySelectorAll('.mem-delete').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            try { await API.deleteMemory(btn.dataset.id); loadCompanion(selectedCompanionId); } catch (err) {}
        });
    });
}

// ── Chat history ───────────────────────────────────────
async function loadChatHistory() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    try {
        const messages = await API.getChatHistory(selectedCompanionId);
        container.innerHTML = '';
        if (messages.length === 0) {
            renderEmptyState(container);
        } else {
            messages.forEach(m => addMessageToDOM(m.content, m.role === 'assistant'));
            scrollToBottom();
        }
    } catch (e) {
        console.error('loadChatHistory failed:', e);
    }
}

function renderEmptyState(container) {
    const c = currentCompanion || {};
    container.innerHTML = `
        <div class="chat-empty" id="chatEmpty">
            <div class="chat-empty-avatar" style="background:${c.color || '#8b5cf6'}">${c.avatar_initial || '?'}</div>
            <h2>Chat with ${c.name || 'your companion'}</h2>
            <p>${c.bio || 'Start a conversation!'}</p>
        </div>`;
}

function addMessageToDOM(content, isBot, imageData) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Remove empty state if present
    const empty = container.querySelector('.chat-empty');
    if (empty) empty.remove();

    const c = currentCompanion || {};
    const row = document.createElement('div');
    row.className = 'message-row ' + (isBot ? 'bot' : 'user');

    const userName = currentUser.name || 'You';
    const userInitial = userName[0].toUpperCase();

    let imageHtml = '';
    if (imageData && imageData.imageUrl) {
        imageHtml = `<div class="msg-image"><img src="${imageData.imageUrl}" alt="image" loading="lazy"></div>`;
    }

    if (isBot) {
        row.innerHTML = `
            <div class="msg-avatar" style="background:${c.color || '#8b5cf6'}">${c.avatar_initial || '?'}</div>
            <div class="msg-body">
                <div class="msg-name">${c.name || 'Companion'}</div>
                <div class="msg-bubble">${escapeHtml(content)}${imageHtml}</div>
                <div class="msg-actions">
                    <button class="msg-action-btn speak-action">🔊 Speak</button>
                </div>
            </div>`;
    } else {
        row.innerHTML = `
            <div class="msg-body">
                <div class="msg-name">${escapeHtml(userName)}</div>
                <div class="msg-bubble">${escapeHtml(content)}</div>
                <div class="msg-actions">
                    <button class="msg-action-btn speak-action">🔊 Speak</button>
                </div>
            </div>
            <div class="msg-avatar user-avatar">${userInitial}</div>`;
    }

    container.appendChild(row);
    row.querySelector('.speak-action').addEventListener('click', function() {
        speak(content, this);
    });
    scrollToBottom();
    return row;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function addTypingIndicator() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const c = currentCompanion || {};
    const row = document.createElement('div');
    row.className = 'typing-row';
    row.id = 'typingIndicator';
    row.innerHTML = `
        <div class="msg-avatar" style="background:${c.color || '#8b5cf6'}">${c.avatar_initial || '?'}</div>
        <div class="typing-dots"><span></span><span></span><span></span></div>`;
    container.appendChild(row);
    scrollToBottom();
}

function removeTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

function scrollToBottom() {
    const c = document.getElementById('chatMessages');
    if (c) c.scrollTop = c.scrollHeight;
}

// ── Send message ───────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendBtn');
    if (!input) return;
    const message = input.value.trim();
    if (!message || isTyping) return;

    addMessageToDOM(message, false);
    input.value = '';
    input.style.height = 'auto';
    if (btn) btn.disabled = true;
    isTyping = true;
    addTypingIndicator();

    try {
        const result = await API.sendMessage(selectedCompanionId, message);
        removeTypingIndicator();
        addMessageToDOM(result.response, true, result.imageData);

        if (result.memoryExtracted) {
            showToast('Memory saved ✓', 'info');
            updateMemoriesPanel((currentCompanion && currentCompanion.memories) || []);
            // refresh companion to get updated memories
            API.getCompanion(selectedCompanionId).then(c => {
                currentCompanion = c;
                updateMemoriesPanel(c.memories || []);
            }).catch(() => {});
        }
        if (result.xp && result.xp.leveledUp) {
            showToast('🎉 Level up! Now Level ' + result.xp.level, 'success');
        }
        if (result.mood) {
            const moodEl = document.getElementById('profileMood');
            if (moodEl) moodEl.textContent = result.mood.display;
        }
        if (result.xp) {
            const relLevel = document.getElementById('relLevel');
            const relXp = document.getElementById('relXp');
            const pf = document.getElementById('progressFill');
            if (relLevel) relLevel.textContent = 'Level ' + result.xp.level;
            if (relXp) relXp.textContent = result.xp.xp + ' XP';
            if (pf) pf.style.width = (result.xp.xp % 100) + '%';
        }
        // update sidebar mood
        renderSidebar();
    } catch (e) {
        removeTypingIndicator();
        showToast('Failed to send. Try again.', 'error');
    }

    isTyping = false;
    if (btn) btn.disabled = !input.value.trim();
}

// ── Event listeners ────────────────────────────────────

// Textarea auto-resize + send button enable/disable
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

if (chatInput) {
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        if (sendBtn) sendBtn.disabled = !this.value.trim();
    });
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

if (sendBtn) sendBtn.addEventListener('click', sendMessage);

// Sidebar toggle
document.getElementById('sidebarToggle') && document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
});

// Right panel toggle
document.getElementById('togglePanelBtn') && document.getElementById('togglePanelBtn').addEventListener('click', () => {
    document.getElementById('infoPanel').classList.toggle('open');
});
document.getElementById('closePanelBtn') && document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('infoPanel').classList.remove('open');
});

// Clear chat
document.getElementById('clearChatBtn') && document.getElementById('clearChatBtn').addEventListener('click', async () => {
    if (!confirm('Clear this conversation?')) return;
    try {
        await API.clearChat(selectedCompanionId);
        await loadChatHistory();
        showToast('Chat cleared', 'info');
    } catch (e) {
        showToast('Failed to clear chat', 'error');
    }
});

// Sign out
document.getElementById('signOutBtn') && document.getElementById('signOutBtn').addEventListener('click', () => {
    API.clearSession();
    window.location.href = 'index.html';
});

// New chat (clear current + stay on same companion)
document.getElementById('newChatBtn') && document.getElementById('newChatBtn').addEventListener('click', async () => {
    try {
        await API.clearChat(selectedCompanionId);
        await loadChatHistory();
    } catch (e) {}
});

// Search filter
document.getElementById('searchInput') && document.getElementById('searchInput').addEventListener('input', function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        const name = item.querySelector('.chat-item-name').textContent.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
});

// ── Voice settings ─────────────────────────────────────
function loadVoiceSettings() {
    if (!currentCompanion) return;
    const vc = currentCompanion.voice_config || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('voiceStyle', vc.style || 'neutral');
    set('voicePitch', vc.pitch || 1.0); setTxt('pitchVal', vc.pitch || 1.0);
    set('voiceRate', vc.rate || 1.0);   setTxt('rateVal', vc.rate || 1.0);
    set('voiceVolume', vc.volume || 1.0); setTxt('volVal', vc.volume || 1.0);
}

['voicePitch', 'voiceRate', 'voiceVolume'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const valId = { voicePitch: 'pitchVal', voiceRate: 'rateVal', voiceVolume: 'volVal' }[id];
    el.addEventListener('input', function() {
        const v = document.getElementById(valId);
        if (v) v.textContent = this.value;
    });
});

document.getElementById('saveVoiceBtn') && document.getElementById('saveVoiceBtn').addEventListener('click', async () => {
    if (!currentCompanion) return;
    const config = {
        style: document.getElementById('voiceStyle').value,
        pitch: parseFloat(document.getElementById('voicePitch').value),
        rate: parseFloat(document.getElementById('voiceRate').value),
        volume: parseFloat(document.getElementById('voiceVolume').value),
    };
    try {
        const result = await API.updateVoiceConfig(currentCompanion.id, config);
        if (result.voice_config) currentCompanion.voice_config = result.voice_config;
        showToast('Voice settings saved', 'success');
    } catch (e) {
        showToast('Failed to save voice settings', 'error');
    }
});

document.getElementById('testVoiceBtn') && document.getElementById('testVoiceBtn').addEventListener('click', function() {
    if (!currentCompanion) return;
    speak('Hi! I\'m ' + currentCompanion.name + '. ' + (currentCompanion.bio || '').split('.')[0] + '.', this);
});

// ── Init ───────────────────────────────────────────────
initUserInfo();
renderSidebar();
loadCompanion(selectedCompanionId);
