const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const companionService = require('./companionService');

class ImageService {
  constructor() {
    this.provider = process.env.IMAGE_PROVIDER || 'placeholder';
  }

  async generate(userId, companionId, conversationContext, requestedScene) {
    const companion = companionService.getById(companionId);
    if (!companion) throw new Error('Companion not found');

    const appearance = companion.appearance;
    const imgConfig = companion.image_config;

    const prompt = this.buildPrompt(companion, requestedScene, conversationContext);

    let imageUrl;
    if (this.provider === 'openai' && process.env.OPENAI_API_KEY) {
      imageUrl = await this.generateWithDALL_E(prompt);
    } else {
      imageUrl = this.generatePlaceholder(companion, requestedScene);
    }

    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO generated_images (id, user_id, companion_id, prompt, image_url, context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, companionId, prompt, imageUrl, requestedScene || 'conversation');

    return { id, imageUrl, prompt };
  }

  buildPrompt(companion, requestedScene, context) {
    const app = companion.appearance;
    const cfg = companion.image_config;

    let prompt = cfg.base_prompt || `anime style portrait of ${companion.name}`;
    if (requestedScene) {
      prompt += `, ${requestedScene}`;
    }
    prompt += `, ${cfg.style || 'anime illustration'}`;
    return prompt;
  }

  async generateWithDALL_E(prompt) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        quality: 'standard',
        n: 1
      });
      return response.data[0].url;
    } catch (error) {
      console.error('Image generation error:', error.message);
      return null;
    }
  }

  generatePlaceholder(companion, scene) {
    const colors = {
      'Luna': '#8B5CF6', 'Aria': '#EC4899', 'Rex': '#F59E0B', 'Nyx': '#6366F1', 'Mochi': '#10B981'
    };
    const color = colors[companion.name] || '#8B5CF6';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:0.3"/>
          <stop offset="100%" style="stop-color:${color};stop-opacity:0.1"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill="url(#bg)" rx="16"/>
      <circle cx="256" cy="200" r="80" fill="${color}" opacity="0.6"/>
      <text x="256" y="215" text-anchor="middle" fill="white" font-size="72" font-family="sans-serif" font-weight="600">${companion.avatar_initial}</text>
      <text x="256" y="340" text-anchor="middle" fill="white" font-size="24" font-family="sans-serif" opacity="0.8">${companion.name}</text>
      <text x="256" y="380" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" opacity="0.5">${scene || '✨'}</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }

  getByConversation(userId, companionId, conversationId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM generated_images
      WHERE user_id = ? AND companion_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(userId, companionId);
  }
}

module.exports = new ImageService();
