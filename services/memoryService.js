const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

class MemoryService {
  create(userId, companionId, content, category, importance, sourceMessageId) {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO memories (id, user_id, companion_id, content, category, importance, source_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, companionId, content, category, importance || 5, sourceMessageId || null);
    return id;
  }

  getForUserCompanion(userId, companionId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM memories WHERE user_id = ? AND companion_id = ?
      ORDER BY importance DESC, created_at DESC
    `).all(userId, companionId);
  }

  getRelevant(userId, companionId, contextKeywords) {
    const db = getDb();
    const memories = this.getForUserCompanion(userId, companionId);
    if (!contextKeywords || contextKeywords.length === 0) {
      return memories.slice(0, 10);
    }
    const scored = memories.map(m => {
      let score = m.importance;
      const lower = m.content.toLowerCase();
      for (const kw of contextKeywords) {
        if (lower.includes(kw.toLowerCase())) score += 3;
      }
      if (m.pinned) score += 5;
      return { ...m, relevanceScore: score };
    });
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, 8);
  }

  delete(memoryId, userId) {
    const db = getDb();
    db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
  }

  update(memoryId, userId, content) {
    const db = getDb();
    db.prepare('UPDATE memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .run(content, memoryId, userId);
  }

  pin(memoryId, userId, pinned) {
    const db = getDb();
    db.prepare('UPDATE memories SET pinned = ? WHERE id = ? AND user_id = ?')
      .run(pinned ? 1 : 0, memoryId, userId);
  }

  buildMemoryContext(memories) {
    if (!memories || memories.length === 0) return '';
    return `
## Known Memories about the User
${memories.map(m => `- [${m.category}] ${m.content}`).join('\n')}
Use these memories naturally in conversation when relevant. Reference them casually, not like you are reading from a list.
If a memory is relevant to what the user is saying, bring it up naturally.
`;
  }
}

module.exports = new MemoryService();
