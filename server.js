require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { initDatabase, getDb, save, load } = require('./database');
const companionService = require('./services/companionService');
const conversationService = require('./services/conversationService');
const memoryService = require('./services/memoryService');
const relationshipService = require('./services/relationshipService');
const moodService = require('./services/moodService');
const aiService = require('./services/aiService');
const imageService = require('./services/imageService');
const voiceService = require('./services/voiceService');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'luma-secret-key-change-in-production';

const allowedOrigins = [
  'http://localhost:3000',
  'https://lumo-the-ai-companion.netlify.app',
  'https://luma-the-ai-companion.netlify.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true); // Allow all origins in production for flexibility
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// DB init middleware — ensures data is loaded for every request
app.use(async (req, res, next) => {
  try {
    await load();
    next();
  } catch (e) {
    next(e);
  }
});

// JWT auth middleware
function auth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(sessionId, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Helper to persist after writes
async function persist(res, fn) {
  try {
    const result = fn();
    await save();
    return result;
  } catch (e) {
    console.error('[PERSIST]', e.message);
    throw e;
  }
}

// AUTH ROUTES
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(id, name, email, password);
  db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(id);
  await save();
  const sessionId = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ sessionId, user: { id, name, email } });
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?').get(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const sessionId = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ sessionId, user: { id: user.id, name: user.name, email: user.email } });
});

// PREFERENCES ROUTES
app.get('/api/preferences', auth, (req, res) => {
  const db = getDb();
  const prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.userId);
  if (!prefs) return res.json(null);
  res.json({
    ...prefs,
    topics: typeof prefs.topics === 'string' ? JSON.parse(prefs.topics || '[]') : prefs.topics || [],
    notifications: typeof prefs.notifications === 'string' ? JSON.parse(prefs.notifications || '{}') : prefs.notifications || {}
  });
});

app.put('/api/preferences', auth, async (req, res) => {
  const { tone, topics, depth, notifications, proactive_enabled, voice_enabled, theme } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.userId);
  if (existing) {
    db.prepare('UPDATE user_preferences SET tone = ?, topics = ?, depth = ?, notifications = ?, proactive_enabled = ?, voice_enabled = ?, theme = ? WHERE user_id = ?')
      .run(tone || 'friendly', JSON.stringify(topics || []), depth || 'balanced', JSON.stringify(notifications || {}), proactive_enabled ? 1 : 0, voice_enabled !== false ? 1 : 0, theme || 'dark', req.userId);
  } else {
    db.prepare('INSERT INTO user_preferences (user_id, tone, topics, depth, notifications, proactive_enabled, voice_enabled, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.userId, tone || 'friendly', JSON.stringify(topics || []), depth || 'balanced', JSON.stringify(notifications || {}), proactive_enabled ? 1 : 0, voice_enabled !== false ? 1 : 0, theme || 'dark');
  }
  await save();
  res.json({ success: true });
});

// COMPANION ROUTES
app.get('/api/companions', auth, (req, res) => {
  const companions = companionService.getAll();
  const db = getDb();
  const result = companions.map(c => {
    const rel = db.prepare('SELECT * FROM user_companion_relationships WHERE user_id = ? AND companion_id = ?')
      .get(req.userId, c.id);
    const mood = moodService.getCurrent(req.userId, c.id);
    return {
      ...c,
      relationship: rel ? relationshipService.format(rel) : null,
      current_mood: mood
    };
  });
  res.json(result);
});

app.get('/api/companions/:id', auth, async (req, res) => {
  const comp = companionService.getById(req.params.id);
  if (!comp) return res.status(404).json({ error: 'Not found' });
  const rel = relationshipService.getOrCreate(req.userId, comp.id);
  const mood = moodService.getCurrent(req.userId, comp.id);
  const memories = memoryService.getForUserCompanion(req.userId, comp.id);
  await save();
  res.json({ ...comp, relationship: rel, current_mood: mood, memories });
});

// CONVERSATION ROUTES
app.get('/api/chats', auth, (req, res) => {
  const chats = conversationService.getUserChats(req.userId);
  res.json(chats);
});

app.get('/api/chats/:companionId', auth, (req, res) => {
  const messages = conversationService.getHistory(req.userId, req.params.companionId, 50);
  res.json(messages);
});

app.post('/api/chats/:companionId', auth, async (req, res) => {
  const { message } = req.body;
  const companionId = req.params.companionId;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const conv = conversationService.getOrCreate(req.userId, companionId);
    conversationService.addMessage(conv.id, 'user', message);

    const history = conversationService.getMessages(conv.id, 20);
    const historyFormatted = history.map(m => ({ role: m.role, content: m.content }));

    const response = await aiService.generateResponse(req.userId, companionId, message, historyFormatted);
    conversationService.addMessage(conv.id, 'assistant', response);

    let memoryExtracted = false;
    const shouldExtract = await aiService.shouldExtractMemory(req.userId, companionId, message);
    if (shouldExtract) {
      await aiService.extractMemoryFromMessage(req.userId, companionId, message);
      memoryExtracted = true;
    }

    const moodChange = moodService.analyzeMessage(message);
    let moodData = moodService.getCurrent(req.userId, companionId);
    if (moodChange && moodChange !== moodData.mood) {
      moodData = moodService.updateMood(req.userId, companionId, moodChange, 0.6, message);
    }

    const isPersonal = message.split(' ').length > 5;
    const isQuestion = message.includes('?');
    const xpGain = relationshipService.calculateXpGain('message', 'neutral', isPersonal, isQuestion, false);
    const xpResult = relationshipService.addXP(req.userId, companionId, xpGain, 'chat_message', { message: message.substring(0, 100) });

    const lower = message.toLowerCase();
    const imageKeywords = ['picture', 'photo', 'selfie', 'image', 'send me a pic', 'show me', 'what are you wearing'];
    let imageData = null;
    if (imageKeywords.some(kw => lower.includes(kw))) {
      const scene = lower.includes('wearing') ? 'casual outfit portrait' :
                    lower.includes('selfie') ? 'selfie close-up' :
                    lower.includes('beach') ? 'at the beach' :
                    lower.includes('cafe') ? 'at a cafe' : 'portrait';
      imageData = await imageService.generate(req.userId, companionId, message, scene);
    }

    await save();

    res.json({ response, mood: moodData, xp: xpResult, memoryExtracted, imageData });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

app.delete('/api/chats/:companionId', auth, async (req, res) => {
  conversationService.clearConversation(req.userId, req.params.companionId);
  await save();
  res.json({ success: true });
});

// MEMORY ROUTES
app.get('/api/memories/:companionId', auth, (req, res) => {
  const memories = memoryService.getForUserCompanion(req.userId, req.params.companionId);
  res.json(memories);
});

app.delete('/api/memories/:memoryId', auth, async (req, res) => {
  memoryService.delete(req.params.memoryId, req.userId);
  await save();
  res.json({ success: true });
});

app.put('/api/memories/:memoryId', auth, async (req, res) => {
  const { content } = req.body;
  memoryService.update(req.params.memoryId, req.userId, content);
  await save();
  res.json({ success: true });
});

app.put('/api/memories/:memoryId/pin', auth, async (req, res) => {
  const { pinned } = req.body;
  memoryService.pin(req.params.memoryId, req.userId, pinned);
  await save();
  res.json({ success: true });
});

// RELATIONSHIP ROUTES
app.get('/api/relationship/:companionId', auth, async (req, res) => {
  const rel = relationshipService.getOrCreate(req.userId, req.params.companionId);
  await save();
  const levelInfo = relationshipService.getLevelInfo(rel.level);
  res.json({ ...rel, levelInfo });
});

// IMAGE ROUTES
app.post('/api/images/:companionId', auth, async (req, res) => {
  const { scene, context } = req.body;
  try {
    const result = await imageService.generate(req.userId, req.params.companionId, context, scene);
    await save();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// VOICE ROUTES
app.get('/api/voice/config/:companionId', auth, (req, res) => {
  const config = voiceService.getClientConfig(req.params.companionId);
  res.json(config);
});

app.put('/api/voice/config/:companionId', auth, async (req, res) => {
  try {
    const updated = voiceService.updateVoiceConfig(req.params.companionId, req.body);
    await save();
    res.json({ success: true, voice_config: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/voice/synthesize/:companionId', auth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    const result = await voiceService.synthesize(text, req.params.companionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Voice synthesis failed' });
  }
});

// Catch all - serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Export app for serverless use
module.exports = app;

// Start server only when run directly (not when imported by serverless function)
if (require.main === module) {
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`Luma server running on http://localhost:${PORT}`);
    });
  });
}
