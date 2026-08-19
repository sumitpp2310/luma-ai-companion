const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

class ConversationService {
  getOrCreate(userId, companionId) {
    const db = getDb();
    let conv = db.prepare(`
      SELECT * FROM conversations WHERE user_id = ? AND companion_id = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(userId, companionId);

    if (!conv) {
      const id = uuidv4();
      db.prepare('INSERT INTO conversations (id, user_id, companion_id) VALUES (?, ?, ?)')
        .run(id, userId, companionId);
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }
    return conv;
  }

  addMessage(conversationId, role, content, messageType, metadata) {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, role, content, messageType || 'text', JSON.stringify(metadata || {}));
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
    return id;
  }

  getMessages(conversationId, limit) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ?
      ORDER BY created_at ASC LIMIT ?
    `).all(conversationId, limit || 50);
  }

  getHistory(userId, companionId, limit) {
    const conv = this.getOrCreate(userId, companionId);
    return this.getMessages(conv.id, limit);
  }

  getUserChats(userId) {
    const db = getDb();
    return db.prepare(`
      SELECT c.*, comp.name as companion_name, comp.color as companion_color,
        comp.avatar_initial, comp.id as comp_id,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
      FROM conversations c
      JOIN companions comp ON c.companion_id = comp.id
      WHERE c.user_id = ?
      ORDER BY last_message_at DESC
    `).all(userId);
  }

  clearConversation(userId, companionId) {
    const db = getDb();
    const conv = this.getOrCreate(userId, companionId);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
  }
}

module.exports = new ConversationService();
