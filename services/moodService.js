const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

const MOOD_EMOJIS = {
  cheerful: '😊', happy: '😄', calm: '😌', curious: '🤔', playful: '😜',
  shy: '😊', thoughtful: '🌙', excited: '🔥', cozy: '☕', concerned: '😟',
  tired: '😴', confident: '💪', melancholic: '🌧️', serene: '🕊️', energetic: '⚡'
};

const MOOD_TRANSITIONS = {
  cheerful: ['happy', 'playful', 'excited', 'curious'],
  happy: ['cheerful', 'playful', 'excited', 'calm'],
  calm: ['cheerful', 'thoughtful', 'serene', 'cozy'],
  curious: ['excited', 'thoughtful', 'playful', 'cheerful'],
  playful: ['cheerful', 'excited', 'happy', 'curious'],
  shy: ['calm', 'cozy', 'thoughtful', 'cheerful'],
  thoughtful: ['calm', 'curious', 'melancholic', 'serene'],
  excited: ['cheerful', 'playful', 'happy', 'curious'],
  cozy: ['calm', 'cheerful', 'shy', 'happy'],
  concerned: ['calm', 'thoughtful', 'cheerful'],
  tired: ['calm', 'cozy', 'serene'],
  confident: ['cheerful', 'playful', 'excited', 'curious'],
  melancholic: ['thoughtful', 'calm', 'serene', 'cheerful'],
  serene: ['calm', 'thoughtful', 'cheerful', 'cozy'],
  energetic: ['excited', 'playful', 'cheerful', 'confident']
};

class MoodService {
  getCurrent(userId, companionId) {
    const db = getDb();
    let mood = db.prepare(`
      SELECT * FROM mood_states WHERE user_id = ? AND companion_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, companionId);
    if (!mood) {
      const companion = db.prepare('SELECT emotional_baseline FROM companions WHERE id = ?').get(companionId);
      const baseline = companion ? companion.emotional_baseline : 'cheerful';
      const id = uuidv4();
      db.prepare(`
        INSERT INTO mood_states (id, user_id, companion_id, mood, intensity)
        VALUES (?, ?, ?, ?, 0.7)
      `).run(id, userId, companionId, baseline);
      mood = db.prepare('SELECT * FROM mood_states WHERE id = ?').get(id);
    }
    return {
      mood: mood.mood,
      emoji: MOOD_EMOJIS[mood.mood] || '😐',
      intensity: mood.intensity,
      display: `${MOOD_EMOJIS[mood.mood] || '😐'} feeling ${mood.mood}`
    };
  }

  updateMood(userId, companionId, newMood, intensity, triggerContext) {
    const db = getDb();
    const current = this.getCurrent(userId, companionId);
    if (current.mood === newMood) return current;

    const allowed = MOOD_TRANSITIONS[current.mood] || [];
    if (!allowed.includes(newMood) && Math.random() > 0.3) {
      return current;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO mood_states (id, user_id, companion_id, mood, intensity, trigger_context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, companionId, newMood, intensity || 0.6, triggerContext || null);

    return {
      mood: newMood,
      emoji: MOOD_EMOJIS[newMood] || '😐',
      intensity: intensity || 0.6,
      display: `${MOOD_EMOJIS[newMood] || '😐'} feeling ${newMood}`
    };
  }

  analyzeMessage(messageText, currentMood) {
    const lower = messageText.toLowerCase();
    if (lower.includes('funny') || lower.includes('joke') || lower.includes('lol') || lower.includes('haha')) return 'playful';
    if (lower.includes('love') || lower.includes('thank') || lower.includes('sweet')) return 'happy';
    if (lower.includes('sad') || lower.includes('lonely') || lower.includes('miss')) return 'concerned';
    if (lower.includes('amazing') || lower.includes('awesome') || lower.includes('excited')) return 'excited';
    if (lower.includes('deep') || lower.includes('meaning') || lower.includes('why')) return 'thoughtful';
    if (lower.includes('cozy') || lower.includes('comfort') || lower.includes('relax')) return 'cozy';
    if (lower.includes('tired') || lower.includes('exhausted')) return 'tired';
    if (lower.includes('nature') || lower.includes('peace') || lower.includes('calm')) return 'serene';
    if (lower.includes('adventure') || lower.includes('let') || lower.includes('go')) return 'energetic';
    return null;
  }

  buildMoodContext(moodData) {
    return `
## Current Mood
You are currently feeling ${moodData.mood}.
Let this influence your tone and word choice naturally.
`;
  }
}

module.exports = new MoodService();
