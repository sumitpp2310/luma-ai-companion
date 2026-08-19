const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

const LEVEL_THRESHOLDS = [0, 50, 150, 350, 600, 1000];
const LEVEL_NAMES = ['Stranger', 'Acquaintance', 'Friend', 'Close Friend', 'Very Close', 'Soul Bond'];

const MILESTONES = {
  2: { name: 'First Conversation', description: 'You had your first real conversation' },
  3: { name: 'Getting to Know You', description: 'You learned something new about each other' },
  4: { name: 'Close Friends', description: 'Your bond has grown significantly' },
  5: { name: 'Inseparable', description: 'You share a deep connection' }
};

class RelationshipService {
  getOrCreate(userId, companionId) {
    const db = getDb();
    let rel = db.prepare('SELECT * FROM user_companion_relationships WHERE user_id = ? AND companion_id = ?')
      .get(userId, companionId);
    if (!rel) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO user_companion_relationships (id, user_id, companion_id, level, xp, affection, milestones, unlocked_features)
        VALUES (?, ?, ?, 1, 0, 0, '[]', '[]')
      `).run(id, userId, companionId);
      rel = db.prepare('SELECT * FROM user_companion_relationships WHERE id = ?').get(id);
    }
    return this.format(rel);
  }

  format(rel) {
    return {
      ...rel,
      milestones: JSON.parse(rel.milestones || '[]'),
      unlocked_features: JSON.parse(rel.unlocked_features || '[]')
    };
  }

  addXP(userId, companionId, amount, eventType, eventData) {
    const db = getDb();
    const rel = this.getOrCreate(userId, companionId);
    const newXp = rel.xp + amount;
    let newLevel = rel.level;

    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 1; i--) {
      if (newXp >= LEVEL_THRESHOLDS[i]) {
        newLevel = i + 1;
        break;
      }
    }

    const leveledUp = newLevel > rel.level;
    const milestones = [...rel.milestones];
    if (leveledUp && MILESTONES[newLevel] && !milestones.find(m => m.level === newLevel)) {
      milestones.push({ level: newLevel, ...MILESTONES[newLevel], at: new Date().toISOString() });
    }

    const unlocked = [...rel.unlocked_features];
    if (newLevel >= 3 && !unlocked.includes('memories_access')) unlocked.push('memories_access');
    if (newLevel >= 4 && !unlocked.includes('proactive_chat')) unlocked.push('proactive_chat');
    if (newLevel >= 5 && !unlocked.includes('deep_context')) unlocked.push('deep_context');

    db.prepare(`
      UPDATE user_companion_relationships
      SET xp = ?, level = ?, affection = MIN(affection + ?, 100), milestones = ?, unlocked_features = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND companion_id = ?
    `).run(newXp, newLevel, Math.min(amount, 5), JSON.stringify(milestones), JSON.stringify(unlocked), userId, companionId);

    if (eventType) {
      const eventId = uuidv4();
      db.prepare(`
        INSERT INTO relationship_events (id, user_id, companion_id, event_type, event_data, xp_awarded)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId, userId, companionId, eventType, JSON.stringify(eventData || {}), amount);
    }

    return {
      level: newLevel,
      xp: newXp,
      leveledUp,
      milestones,
      unlocked_features: unlocked
    };
  }

  calculateXpGain(messageType, sentiment, isPersonal, isQuestion, companionPreferenceMatch) {
    let xp = 1;
    if (isPersonal) xp += 2;
    if (isQuestion) xp += 1;
    if (companionPreferenceMatch) xp += 2;
    if (sentiment === 'positive') xp += 1;
    if (messageType === 'meaningful') xp += 3;
    return Math.min(xp, 10);
  }

  getLevelInfo(level) {
    return {
      level,
      name: LEVEL_NAMES[level - 1] || 'Unknown',
      currentThreshold: LEVEL_THRESHOLDS[level - 1] || 0,
      nextThreshold: LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
    };
  }
}

module.exports = new RelationshipService();
