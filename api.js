const API = {
  baseUrl: window.location.hostname === '' || window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : '',  // Same domain on Netlify — no separate backend URL needed
  sessionId: localStorage.getItem('lumaSessionId') || null,

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.sessionId) headers['X-Session-Id'] = this.sessionId;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.baseUrl + path, opts);
    if (res.status === 401) {
      this.sessionId = null;
      localStorage.removeItem('lumaSessionId');
      window.location.href = 'index.html';
      return null;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  setSession(id) {
    this.sessionId = id;
    localStorage.setItem('lumaSessionId', id);
  },

  clearSession() {
    this.sessionId = null;
    localStorage.removeItem('lumaSessionId');
    localStorage.removeItem('lumaCurrentUser');
  },

  isAuthenticated() {
    return !!this.sessionId;
  },

  // Auth
  signup(name, email, password) {
    return this.request('POST', '/api/auth/signup', { name, email, password });
  },

  signin(email, password) {
    return this.request('POST', '/api/auth/signin', { email, password });
  },

  // Preferences
  getPreferences() {
    return this.request('GET', '/api/preferences');
  },

  savePreferences(prefs) {
    return this.request('PUT', '/api/preferences', prefs);
  },

  // Companions
  getCompanions() {
    return this.request('GET', '/api/companions');
  },

  getCompanion(id) {
    return this.request('GET', '/api/companions/' + id);
  },

  // Chats
  getChats() {
    return this.request('GET', '/api/chats');
  },

  getChatHistory(companionId) {
    return this.request('GET', '/api/chats/' + companionId);
  },

  sendMessage(companionId, message) {
    return this.request('POST', '/api/chats/' + companionId, { message });
  },

  clearChat(companionId) {
    return this.request('DELETE', '/api/chats/' + companionId);
  },

  // Memories
  getMemories(companionId) {
    return this.request('GET', '/api/memories/' + companionId);
  },

  deleteMemory(memoryId) {
    return this.request('DELETE', '/api/memories/' + memoryId);
  },

  updateMemory(memoryId, content) {
    return this.request('PUT', '/api/memories/' + memoryId, { content });
  },

  pinMemory(memoryId, pinned) {
    return this.request('PUT', '/api/memories/' + memoryId + '/pin', { pinned });
  },

  // Relationship
  getRelationship(companionId) {
    return this.request('GET', '/api/relationship/' + companionId);
  },

  // Image
  generateImage(companionId, scene, context) {
    return this.request('POST', '/api/images/' + companionId, { scene, context });
  },

  // Voice
  getVoiceConfig(companionId) {
    return this.request('GET', '/api/voice/config/' + companionId);
  },

  updateVoiceConfig(companionId, config) {
    return this.request('PUT', '/api/voice/config/' + companionId, config);
  },

  synthesizeVoice(companionId, text) {
    return this.request('POST', '/api/voice/synthesize/' + companionId, { text });
  }
};
