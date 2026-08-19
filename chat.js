if (!API.isAuthenticated()) window.location.href = 'index.html';

const currentUser = JSON.parse(localStorage.getItem('lumaCurrentUser') || '{}');
let selectedCompanionId = localStorage.getItem('selectedCompanion') || 'aria';
let currentCompanion = null;
let isTyping = false;

const MOOD_EMOJIS = {
  cheerful:'😊',happy:'😄',calm:'😌',curious:'🤔',playful:'😜',shy:'😊',thoughtful:'🌙',
  excited:'🔥',cozy:'☕',concerned:'😟',tired:'😴',confident:'💪',melancholic:'🌧️',serene:'🕊️',energetic:'⚡'
};

function showToast(msg, type) {
  var isMemory = type === 'info';
  var cls = isMemory ? 'memory-toast' : 'toast';
  var existing = document.querySelector(isMemory ? '.memory-toast' : '.toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.className = cls + (type && !isMemory ? ' ' + type : '') + ' show';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.remove('show'); setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300); }, 3000);
}

// Voice
function findBestVoice(companionConfig) {
  if (!window.speechSynthesis) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  const targetLang = companionConfig.language || 'en-US';
  const targetGender = companionConfig.gender || 'female';
  const targetStyle = companionConfig.style || 'neutral';

  let candidates = voices.filter(function(v) { return v.lang && v.lang.startsWith(targetLang.split('-')[0]); });
  if (!candidates.length) candidates = voices;

  const genderHints = {
    female: ['female', 'samantha', 'karen', 'moira', 'tessa', 'zira', 'hazel', 'google uk english female', 'google us english', 'microsoft zira', 'microsoft hazel'],
    male: ['male', 'daniel', 'tom', 'aaron', 'matthew', 'google uk english male', 'microsoft mark', 'microsoft david', 'microsoft james']
  };

  const styleHints = {
    cheerful: ['samantha', 'tessa', 'karen'],
    gentle: ['moira', 'karen', 'hazel'],
    energetic: ['daniel', 'aaron', 'matthew'],
    contemplative: ['moira', 'hazel', 'zira'],
    cute: ['samantha', 'tessa', 'zira'],
    playful: ['samantha', 'tessa'],
    mysterious: ['moira', 'hazel']
  };

  var styleNames = styleHints[targetStyle] || [];
  var genderNames = genderHints[targetGender] || [];

  var best = null;
  var bestScore = -1;

  candidates.forEach(function(v) {
    var score = 0;
    var nameLower = (v.name || '').toLowerCase();

    if (targetGender === 'female' && v.name && !v.name.toLowerCase().match(/male|daniel|tom|matthew|aaron|david|james|mark/)) score += 3;
    if (targetGender === 'male' && v.name && v.name.toLowerCase().match(/male|daniel|tom|matthew|aaron|david|james|mark/)) score += 3;

    styleNames.forEach(function(sn) { if (nameLower.includes(sn.toLowerCase())) score += 5; });
    genderNames.forEach(function(gn) { if (nameLower.includes(gn.toLowerCase())) score += 2; });

    if (v.lang && v.lang.startsWith(targetLang)) score += 1;

    if (score > bestScore) { bestScore = score; best = v; }
  });

  return best;
}

function speak(text, btn) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  var cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  if (!cleanText) return;
  if (btn) btn.classList.add('speaking');

  var vc = (currentCompanion && currentCompanion.voice_config) || {};
  var utterance = new SpeechSynthesisUtterance(cleanText);

  var voice = findBestVoice(vc);
  if (voice) utterance.voice = voice;

  utterance.pitch = vc.pitch || 1.0;
  utterance.rate = vc.rate || 1.0;
  utterance.volume = vc.volume || 1.0;
  utterance.lang = vc.language || 'en-US';

  utterance.onend = function() { if (btn) btn.classList.remove('speaking'); };
  utterance.onerror = function() { if (btn) btn.classList.remove('speaking'); };
  speechSynthesis.speak(utterance);
}
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = function() {};

// Chat list
async function renderChatList() {
  const list = document.getElementById('chatList');
  if (!list) return;
  try {
    const companions = await API.getCompanions();
    list.innerHTML = '<div class="chat-list-label">CHATS</div>';
    companions.forEach(function(c) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (c.id === selectedCompanionId ? ' active' : '');
      item.dataset.companion = c.id;
      const mood = c.current_mood || {};
      item.innerHTML = '<div class="chat-item-avatar" style="background-color:' + c.color + ';">' + c.avatar_initial + '</div><div class="chat-item-info"><span class="chat-item-name">' + c.name + '</span><span class="chat-item-preview">' + (mood.display || c.bio.substring(0, 30)) + '</span></div>';
      item.addEventListener('click', function() {
        selectedCompanionId = c.id;
        localStorage.setItem('selectedCompanion', c.id);
        loadCompanion(c.id);
        renderChatList();
      });
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load chat list:', err);
  }
}

// Load companion
async function loadCompanion(companionId) {
  try {
    currentCompanion = await API.getCompanion(companionId);
    updateCompanionUI();
    loadChatHistory();
    loadVoiceSettings();
  } catch (err) {
    console.error('Failed to load companion:', err);
  }
}

function updateCompanionUI() {
  if (!currentCompanion) return;
  const c = currentCompanion;
  const el = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  const compName = document.getElementById('companionName'); if (compName) compName.textContent = c.name;
  el('profileName', c.name);
  el('profileAge', c.age + ' years old');
  const mood = c.current_mood || { display: '😊 feeling cheerful' };
  el('profileMood', mood.display);
  const avatar = document.getElementById('profileAvatar'); if (avatar) { avatar.textContent = c.avatar_initial; avatar.style.backgroundColor = c.color; }
  const traits = c.personality ? c.personality.core : [];
  const tc = document.getElementById('traitsContainer');
  if (tc) tc.innerHTML = traits.map(function(t) { return '<span class="trait-tag">' + t + '</span>'; }).join('');
  const memories = c.memories || [];
  const ml = document.getElementById('memoriesList');
  if (ml) {
    if (memories.length === 0) {
      ml.innerHTML = '<div class="memory-item"><span class="memory-text" style="color:#555;">No memories yet</span></div>';
    } else {
      ml.innerHTML = memories.slice(0, 10).map(function(m) {
        return '<div class="memory-item"><span class="memory-type ' + m.category + '">' + m.category.replace('_', ' ') + '</span><span class="memory-text">' + m.content.substring(0, 50) + '</span><button class="delete-memory-btn" data-id="' + m.id + '">×</button></div>';
      }).join('');
      ml.querySelectorAll('.delete-memory-btn').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          try { await API.deleteMemory(this.dataset.id); loadCompanion(selectedCompanionId); } catch (err) {}
        });
      });
    }
  }
  const rel = c.relationship || { level: 1, xp: 0 };
  const lvl = document.querySelector('.level'); if (lvl) lvl.textContent = 'Level ' + rel.level;
  const xpEl = document.querySelector('.xp'); if (xpEl) xpEl.textContent = rel.xp + ' XP';
  const pf = document.getElementById('progressFill'); if (pf) pf.style.width = (rel.xp % 100) + '%';
  const header = document.querySelector('.chat-header');
  if (header) header.style.borderBottomColor = c.color;
  const welcomeMsg = document.getElementById('welcomeMessage');
  if (welcomeMsg) {
    const userName = currentUser.name || 'there';
    welcomeMsg.textContent = 'Hey ' + userName + '! I\'m ' + c.name + ', your AI companion. How can I help you today?';
  }
}

// Load chat history
async function loadChatHistory() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  try {
    const messages = await API.getChatHistory(selectedCompanionId);
    chatMessages.innerHTML = '';
    if (messages.length === 0) {
      addMessageToDOM('Hey ' + (currentUser.name || 'there') + '! I\'m ' + (currentCompanion ? currentCompanion.name : 'your companion') + '. How can I help you today?', true);
    } else {
      messages.forEach(function(msg) { addMessageToDOM(msg.content, msg.role === 'assistant'); });
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function addMessageToDOM(content, isBot, imageData) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = 'message ' + (isBot ? 'bot-message' : 'user-message');
  const color = currentCompanion ? currentCompanion.color : '#8B5CF6';
  const initial = currentCompanion ? currentCompanion.avatar_initial : '?';
  let imageHtml = '';
  if (imageData && imageData.imageUrl) {
    imageHtml = '<div class="message-image"><img src="' + imageData.imageUrl + '" alt="Generated image"></div>';
  }
  if (isBot) {
    div.innerHTML = '<div class="message-avatar" style="background-color:' + color + ';">' + initial + '</div><div class="message-content"><p>' + content + '</p>' + imageHtml + '<button class="msg-speak-btn">🔊</button></div>';
  } else {
    div.innerHTML = '<div class="message-content"><p>' + content + '</p>' + imageHtml + '<button class="msg-speak-btn">🔊</button></div>';
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  div.querySelector('.msg-speak-btn').addEventListener('click', function() { speak(content, this); });
}

function addTypingIndicator() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = 'message bot-message typing-indicator';
  div.id = 'typingIndicator';
  const color = currentCompanion ? currentCompanion.color : '#8B5CF6';
  div.innerHTML = '<div class="message-avatar" style="background-color:' + color + ';">' + (currentCompanion ? currentCompanion.avatar_initial : '?') + '</div><div class="message-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// Send message
async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const message = input.value.trim();
  if (!message || isTyping) return;
  addMessageToDOM(message, false);
  input.value = '';
  isTyping = true;
  addTypingIndicator();
  try {
    const result = await API.sendMessage(selectedCompanionId, message);
    removeTypingIndicator();
    addMessageToDOM(result.response, true, result.imageData);
    if (result.memoryExtracted) {
      showToast('I\'ll remember that!', 'info');
      loadCompanion(selectedCompanionId);
    }
    if (result.xp && result.xp.leveledUp) {
      showToast('Level up! Now Level ' + result.xp.level + '!', 'success');
    }
    if (result.mood) {
      const moodEl = document.getElementById('profileMood');
      if (moodEl) moodEl.textContent = result.mood.display;
    }
  } catch (err) {
    removeTypingIndicator();
    showToast('Failed to send message. Please try again.', 'error');
  }
  isTyping = false;
}

// Event listeners
document.getElementById('sendBtn') && document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput') && document.getElementById('chatInput').addEventListener('keypress', function(e) { if (e.key === 'Enter') sendMessage(); });

document.getElementById('togglePanelBtn') && document.getElementById('togglePanelBtn').addEventListener('click', function() {
  document.getElementById('infoPanel').classList.toggle('open');
});
document.getElementById('closePanelBtn') && document.getElementById('closePanelBtn').addEventListener('click', function() {
  document.getElementById('infoPanel').classList.remove('open');
});

document.getElementById('newChatBtn') && document.getElementById('newChatBtn').addEventListener('click', async function() {
  try {
    await API.clearChat(selectedCompanionId);
    loadChatHistory();
  } catch (err) {}
});

document.querySelector('.sidebar-search input') && document.querySelector('.sidebar-search input').addEventListener('input', function() {
  var search = this.value.toLowerCase();
  document.querySelectorAll('.chat-item').forEach(function(item) {
    var name = item.querySelector('.chat-item-name').textContent.toLowerCase();
    item.style.display = name.includes(search) ? 'flex' : 'none';
  });
});

// Init
renderChatList();
loadCompanion(selectedCompanionId);

// Voice settings
function loadVoiceSettings() {
  if (!currentCompanion) return;
  var vc = currentCompanion.voice_config || {};
  var styleEl = document.getElementById('voiceStyle');
  var pitchEl = document.getElementById('voicePitch');
  var rateEl = document.getElementById('voiceRate');
  var volEl = document.getElementById('voiceVolume');
  var langEl = document.getElementById('voiceLanguage');
  if (styleEl) styleEl.value = vc.style || 'neutral';
  if (pitchEl) { pitchEl.value = vc.pitch || 1.0; document.getElementById('pitchVal').textContent = vc.pitch || 1.0; }
  if (rateEl) { rateEl.value = vc.rate || 1.0; document.getElementById('rateVal').textContent = vc.rate || 1.0; }
  if (volEl) { volEl.value = vc.volume || 1.0; document.getElementById('volVal').textContent = vc.volume || 1.0; }
  if (langEl) langEl.value = vc.language || 'en-US';
}

['voicePitch', 'voiceRate', 'voiceVolume'].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var valId = id === 'voicePitch' ? 'pitchVal' : id === 'voiceRate' ? 'rateVal' : 'volVal';
  el.addEventListener('input', function() {
    document.getElementById(valId).textContent = this.value;
  });
});

var saveBtn = document.getElementById('saveVoiceBtn');
if (saveBtn) {
  saveBtn.addEventListener('click', async function() {
    if (!currentCompanion) return;
    var config = {
      style: document.getElementById('voiceStyle').value,
      pitch: parseFloat(document.getElementById('voicePitch').value),
      rate: parseFloat(document.getElementById('voiceRate').value),
      volume: parseFloat(document.getElementById('voiceVolume').value),
      language: document.getElementById('voiceLanguage').value
    };
    try {
      var result = await API.updateVoiceConfig(currentCompanion.id, config);
      if (result.voice_config) currentCompanion.voice_config = result.voice_config;
      showToast('Voice settings saved!', 'success');
    } catch (err) {
      showToast('Failed to save voice settings', 'error');
    }
  });
}

var testBtn = document.getElementById('testVoiceBtn');
if (testBtn) {
  testBtn.addEventListener('click', function() {
    if (!currentCompanion) return;
    var greeting = 'Hi! I\'m ' + currentCompanion.name + '. ' + (currentCompanion.bio || '').split('.')[0] + '.';
    speak(greeting, this);
  });
}
