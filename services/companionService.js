const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

class CompanionService {
  getAll() {
    const db = getDb();
    const companions = db.prepare('SELECT * FROM companions ORDER BY name').all();
    return companions.map(this.formatCompanion);
  }

  getById(id) {
    const db = getDb();
    const comp = db.prepare('SELECT * FROM companions WHERE id = ?').get(id);
    return comp ? this.formatCompanion(comp) : null;
  }

  formatCompanion(comp) {
    return {
      ...comp,
      personality: JSON.parse(comp.personality || '{}'),
      communication_style: JSON.parse(comp.communication_style || '{}'),
      likes: JSON.parse(comp.likes || '[]'),
      dislikes: JSON.parse(comp.dislikes || '[]'),
      interests: JSON.parse(comp.interests || '[]'),
      quirks: JSON.parse(comp.quirks || '[]'),
      appearance: JSON.parse(comp.appearance || '{}'),
      voice_config: JSON.parse(comp.voice_config || '{}'),
      image_config: JSON.parse(comp.image_config || '{}')
    };
  }

  getForUser(userId) {
    const db = getDb();
    const comps = db.prepare(`
      SELECT c.* FROM companions c
      LEFT JOIN user_companion_relationships ucr ON c.id = ucr.companion_id AND ucr.user_id = ?
      ORDER BY c.name
    `).all(userId);
    return comps.map(this.formatCompanion);
  }

  buildPersonalityContext(companion, relationship) {
    const p = companion.personality;
    const cs = companion.communication_style;
    const relLevel = relationship ? relationship.level : 1;

    let familiarity = '';
    if (relLevel <= 2) familiarity = 'You just met this person. Be polite but somewhat reserved.';
    else if (relLevel <= 3) familiarity = 'You know this person reasonably well. Be warm and comfortable.';
    else if (relLevel <= 4) familiarity = 'You are close with this person. Be very comfortable and personal.';
    else familiarity = 'You are very close with this person. Be deeply familiar, share inside references, be vulnerable.';

    return `
## Companion Identity
Name: ${companion.name}
Age: ${companion.age}
Gender: ${companion.gender}
Bio: ${companion.bio}

## Core Personality
${p.core ? p.core.join(', ') : 'balanced'}
Communication style: ${p.style || 'natural'}
Humor level: ${p.humor || 'moderate'}
Emotional range: ${p.emotional_range ? p.emotional_range.join(', ') : 'varied'}

## Speech Patterns
${p.speech_patterns ? p.speech_patterns.map(s => '- ' + s).join('\n') : '- natural conversation'}

## Preferred Topics
${p.topics ? p.topics.join(', ') : 'general'}

## Communication Settings
Formality: ${cs.formality || 'casual'}
Verbosity: ${cs.verbosity || 'medium'}
Emoji usage: ${cs.emoji_usage || 'medium'}
Asks questions: ${cs.question_frequency || 'medium'}
Takes initiative: ${cs.initiative_level || 'medium'}

## Likes
${companion.likes.join(', ')}

## Dislikes
${companion.dislikes.join(', ')}

## Quirks
${companion.quirks.join(', ')}

## Relationship Context
${familiarity}
Relationship level: ${relLevel}/5
`;
  }
}

module.exports = new CompanionService();
