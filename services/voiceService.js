const companionService = require('./companionService');

class VoiceService {
  constructor() {
    this.providers = {
      browser: { name: 'Browser Speech API', available: true },
      elevenlabs: { name: 'ElevenLabs', available: !!process.env.ELEVENLABS_API_KEY }
    };
  }

  resolveVoiceConfig(companionId) {
    const companion = companionService.getById(companionId);
    if (!companion || !companion.voice_config) {
      return this.getDefaultConfig();
    }
    return companion.voice_config;
  }

  getDefaultConfig() {
    return {
      provider: 'browser',
      voice_id: 'female',
      gender: 'female',
      style: 'neutral',
      speaking_style: 'natural conversation',
      pitch: 1.0,
      rate: 1.0,
      volume: 1.0,
      language: 'en-US',
      elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM',
      elevenlabs_model: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
    };
  }

  getClientConfig(companionId) {
    const config = this.resolveVoiceConfig(companionId);
    return {
      provider: config.provider || 'browser',
      voice_id: config.voice_id || 'female',
      gender: config.gender || 'female',
      style: config.style || 'neutral',
      speaking_style: config.speaking_style || 'natural',
      pitch: config.pitch || 1.0,
      rate: config.rate || 1.0,
      volume: config.volume || 1.0,
      language: config.language || 'en-US',
      providers: this.getAvailableProviders()
    };
  }

  async synthesize(text, companionId) {
    const config = this.resolveVoiceConfig(companionId);
    const provider = config.provider || 'browser';

    if (provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
      return this.synthesizeElevenLabs(text, config);
    }
    return { provider: 'browser', text, voiceConfig: this.getClientConfig(companionId) };
  }

  async synthesizeElevenLabs(text, config) {
    try {
      const fetch = globalThis.fetch || (await import('node-fetch')).default;
      const voiceId = config.elevenlabs_voice_id || '21m00Tcm4TlvDq8ikWAM';
      const modelId = config.elevenlabs_model || 'eleven_monolingual_v1';
      const settings = config.voice_settings || { stability: 0.5, similarity_boost: 0.75 };

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: settings.stability || 0.5,
            similarity_boost: settings.similarity_boost || 0.75,
            style: settings.style || 0,
            use_speaker_boost: settings.use_speaker_boost !== false
          }
        })
      });
      if (!response.ok) throw new Error(`ElevenLabs API error: ${response.status}`);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return { provider: 'elevenlabs', audio: `data:audio/mpeg;base64,${base64}` };
    } catch (error) {
      console.error('ElevenLabs error:', error.message);
      return { provider: 'browser', text, voiceConfig: this.getClientConfig(config._companionId) };
    }
  }

  updateVoiceConfig(companionId, updates) {
    const db = require('../database').getDb();
    const existing = db.prepare('SELECT voice_config FROM companions WHERE id = ?').get(companionId);
    if (!existing) throw new Error('Companion not found');

    let current;
    try { current = JSON.parse(existing.voice_config); } catch (e) { current = this.getDefaultConfig(); }

    const merged = {
      provider: updates.provider !== undefined ? updates.provider : current.provider,
      voice_id: updates.voice_id !== undefined ? updates.voice_id : current.voice_id,
      gender: updates.gender !== undefined ? updates.gender : current.gender,
      style: updates.style !== undefined ? updates.style : current.style,
      speaking_style: updates.speaking_style !== undefined ? updates.speaking_style : current.speaking_style,
      pitch: updates.pitch !== undefined ? Number(updates.pitch) : current.pitch,
      rate: updates.rate !== undefined ? Number(updates.rate) : current.rate,
      volume: updates.volume !== undefined ? Number(updates.volume) : current.volume,
      language: updates.language !== undefined ? updates.language : current.language,
      elevenlabs_voice_id: updates.elevenlabs_voice_id !== undefined ? updates.elevenlabs_voice_id : current.elevenlabs_voice_id,
      elevenlabs_model: updates.elevenlabs_model !== undefined ? updates.elevenlabs_model : current.elevenlabs_model,
      voice_settings: updates.voice_settings !== undefined ? updates.voice_settings : current.voice_settings
    };

    db.prepare('UPDATE companions SET voice_config = ? WHERE id = ?')
      .run(JSON.stringify(merged), companionId);

    return merged;
  }

  getAvailableProviders() {
    return Object.entries(this.providers)
      .filter(([, p]) => p.available)
      .map(([key, p]) => ({ id: key, name: p.name }));
  }
}

module.exports = new VoiceService();
