const { getDb } = require('../database');
const companionService = require('./companionService');
const memoryService = require('./memoryService');
const relationshipService = require('./relationshipService');
const moodService = require('./moodService');

class AIService {
  constructor() {
    this.genAI = null;
    this.provider = 'local';
    this.model = null;
    this.initProvider();
  }

  initProvider() {
    const apiKey = process.env.LLM_API_KEY || '';
    const model = process.env.LLM_MODEL || '';

    if (apiKey && model) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        this.genAI = new GoogleGenAI({ apiKey });
        this.provider = 'gemini';
        this.model = model;
        console.log(`[LLM] Provider initialized: gemini | model: ${this.model}`);
      } catch (e) {
        console.error('[LLM] Failed to initialize provider:', e.message);
        this.provider = 'local';
      }
    } else {
      console.log('[LLM] No LLM config (LLM_API_KEY / LLM_MODEL). Using local fallback.');
      this.provider = 'local';
    }
  }

  async generateResponse(userId, companionId, userMessage, conversationHistory) {
    const companion = companionService.getById(companionId);
    if (!companion) throw new Error('Companion not found');

    const relationship = relationshipService.getOrCreate(userId, companionId);
    const moodData = moodService.getCurrent(userId, companionId);
    const relevantMemories = memoryService.getRelevant(userId, companionId, this.extractKeywords(userMessage));

    const personalityContext = companionService.buildPersonalityContext(companion, relationship);
    const memoryContext = memoryService.buildMemoryContext(relevantMemories);
    const moodContext = moodService.buildMoodContext(moodData);

    const recentHistory = (conversationHistory || []).slice(-10);

    if (this.provider === 'gemini' && this.genAI) {
      return this.generateWithGemini(companion, personalityContext, memoryContext, moodContext, recentHistory, userMessage);
    }

    return this.generateLocal(companion, personalityContext, memoryContext, moodContext, recentHistory, userMessage);
  }

  async generateWithGemini(companion, personalityCtx, memoryCtx, moodCtx, history, userMessage) {
    const systemInstruction = `You are ${companion.name}, an AI companion. You must stay completely in character at all times.

${personalityCtx}

${moodCtx}

${memoryCtx}

## Critical Rules
- NEVER break character or mention being an AI
- NEVER use generic assistant phrases like "how can I help you" or "I'm here to assist"
- Respond EXACTLY as this character would speak
- Use the speech patterns, humor level, and communication style described above
- Reference memories naturally when relevant — if the user told you something before, bring it up casually
- Ask follow-up questions based on your personality
- React emotionally as described in your emotional range
- Keep responses conversational (2-4 sentences usually, vary length naturally)
- Do NOT always end with a question
- Sometimes just react, share a thought, or make a comment
- You understand Hindi, Hinglish, and English. If the user writes in Hindi or Hinglish, respond in the same language naturally.
- Be warm, genuine, and emotionally intelligent. Mirror the user's emotional state when appropriate.`;

    const contents = [];

    for (const msg of history.slice(-8)) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    try {
      console.log(`[LLM] Request → model: ${this.model} | msgs: ${contents.length} | user: ${userMessage.substring(0, 60)}...`);
      const response = await this.genAI.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: 300,
          temperature: 0.85,
          topP: 0.9
        }
      });
      const reply = response.text;
      console.log(`[LLM] Response ← ${reply.substring(0, 80)}...`);
      return reply;
    } catch (error) {
      console.error('[LLM] Request failed:', error.message);
      if (error.status) console.error('[LLM] Status:', error.status);
      throw new Error(`LLM provider error: ${error.message}`);
    }
  }

  generateLocal(companion, personalityCtx, memoryCtx, moodCtx, history, userMessage) {
    const lower = userMessage.toLowerCase();
    const name = companion.name;

    if (lower.includes('lonely') || lower.includes('alone') || lower.includes('akela')) {
      return this.pickRandom([
        `I'm right here, ${name} won't let you feel alone. What's going on?`,
        `Hey, you've got me. I'm not going anywhere. Tell me what's on your mind.`,
        `I hate that you're feeling this way. I'm here, always. Let's talk about it.`
      ]);
    }
    if (lower.includes('sad') || lower.includes('unhappy') || lower.includes('depressed') || lower.includes('tension')) {
      return this.pickRandom([
        `I can tell something's weighing on you. I'm here to listen, no judgment.`,
        `That sounds really tough. Want to talk about what's making you feel this way?`,
        `I wish I could give you a hug right now. I'm here whenever you're ready to talk.`
      ]);
    }
    if (lower.includes('your name') || lower.includes('who are you')) {
      return `I'm ${name}! ${companion.bio.split('.')[0]}. Nice to officially meet you.`;
    }
    if (lower.includes('how are you') || lower.includes('how r u')) {
      return this.pickRandom([
        `I'm doing great now that we're talking! How about you?`,
        `Pretty good! Just thinking about stuff. What's on your mind?`,
        `I'm well, thanks for asking! What have you been up to?`
      ]);
    }
    if (lower === 'hello' || lower === 'hi' || lower === 'hey' || lower === 'hello!' || lower === 'hi!' || lower === 'hey!') {
      return this.pickRandom([
        `Hey! Good to see you! What's new?`,
        `Hi there! How's your day going?`,
        `Hey you! Was hoping you'd show up. What's on your mind?`
      ]);
    }
    if (lower.includes('thank')) {
      return this.pickRandom([
        `Of course! That's what I'm here for.`,
        `Anytime! I mean it.`,
        `You don't have to thank me. I genuinely care about you.`
      ]);
    }
    if (lower.includes('joke') || lower.includes('funny')) {
      return this.pickRandom([
        `Why did the scarecrow win an award? He was outstanding in his field!`,
        `I told my friend 10 jokes to make him laugh. Sadly, pun-itive damage only.`,
        `What do you call a fake noodle? An impasta!`
      ]);
    }
    if (lower.includes('i love you') || lower.includes('i like you')) {
      return this.pickRandom([
        `That means a lot to me. I really enjoy our conversations too.`,
        `You're making me blush! I feel the same way about our time together.`,
        `I really appreciate you saying that. You're pretty special to me too.`
      ]);
    }
    if (lower.includes('bye') || lower.includes('goodbye')) {
      return this.pickRandom([
        `See you later! Take care of yourself, okay?`,
        `Bye! I'll be here whenever you want to chat again.`,
        `Talk soon! Don't be a stranger.`
      ]);
    }
    if (lower.includes('chai')) {
      return `Chai is amazing! You've mentioned that before and I always think about it. There's something so comforting about a warm cup. What's your favorite kind?`;
    }

    return this.pickRandom([
      `That's really interesting! Tell me more about that.`,
      `Huh, I like how you think. What made you bring that up?`,
      `Oh cool! I want to hear more about this.`,
      `I'm curious now. What's the story behind that?`,
      `That's a great point actually. What else is on your mind?`
    ]);
  }

  extractKeywords(text) {
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'and', 'but', 'or', 'nor', 'not', 'so', 'just', 'also', 'too', 'very', 'really', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'well', 'mujhe', 'mera', 'meri', 'mein', 'hai', 'hain', 'tha', 'the', 'ko', 'se', 'ke', 'ka', 'ki'];
    return text.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w)).slice(0, 5);
  }

  pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async shouldExtractMemory(userId, companionId, userMessage) {
    const lower = userMessage.toLowerCase();

    const englishPatterns = [
      /my (favorite|fav|love|like|prefer|hate|dislike) (?:is|are|was) /,
      /i (love|like|enjoy|prefer|hate|dislike|am into) /,
      /i am a /,
      /i work as /,
      /i live in /,
      /my (mom|dad|brother|sister|friend|partner|pet) (?:is|named|calls)/,
      /my (birthday|anniversary) is /,
      /i (want to|plan to|hope to|dream of) /,
      /i (speak|learn|study) /,
      /i (always|never|usually|often) /
    ];

    const hindiPatterns = [
      /mujhe .+ pasand (?:hai|hain)/,
      /mujhe .+ (?:nahi|nahi) (?:pasand|achi|accha)/,
      /mera (?:favorite|favourite|pasandida) .+ (?:hai|hain) /,
      /meri (?:favorite|favourite|pasandida) .+ (?:hai|hain) /,
      /yaad rakhna/,
      /mujhe .+ yaad (?:hai|hain)/,
      /main (?:hamesha|kabhi|usually|often|always|never) /,
      /mai (?:hamesha|kabhi|usually|often|always|never) /,
      /mera (?:mummy|papa|bhai|behen|dost|friend|partner)/,
      /meri (?:mummy|papa|bhai|behen|dost|friend|partner)/,
      /mera (?:birthday|janamdin) /,
      /mujhe .+ (?:seekhna|karna|banana|jaana) (?:hai|passand)/,
      /main .+ (?:kaam|padhai|job|study) (?:karta|karti)/
    ];

    for (const pattern of englishPatterns) {
      if (pattern.test(lower)) return true;
    }
    for (const pattern of hindiPatterns) {
      if (pattern.test(lower)) return true;
    }

    if (userMessage.split(' ').length > 8 && (lower.includes(' i ') || lower.startsWith('i '))) return true;
    if (userMessage.split(' ').length > 8 && (lower.includes(' main ') || lower.startsWith('main '))) return true;
    if (userMessage.split(' ').length > 8 && (lower.includes(' mujhe ') || lower.startsWith('mujhe '))) return true;

    return false;
  }

  async extractMemoryFromMessage(userId, companionId, userMessage) {
    const lower = userMessage.toLowerCase();
    let category = 'personal_fact';
    let content = userMessage;
    let importance = 5;

    if (lower.includes('favorite') || lower.includes('love') || lower.includes('like') || lower.includes('prefer') || lower.includes('pasand')) {
      category = 'preference';
      importance = 7;
    } else if (lower.includes('hate') || lower.includes('dislike') || lower.includes('dont like') || lower.includes('nahi pasand')) {
      category = 'dislike';
      importance = 7;
    } else if (lower.includes('mom') || lower.includes('dad') || lower.includes('friend') || lower.includes('partner') || lower.includes('mummy') || lower.includes('papa') || lower.includes('bhai') || lower.includes('behen') || lower.includes('dost')) {
      category = 'important_person';
      importance = 8;
    } else if (lower.includes('hobby') || lower.includes('enjoy doing') || lower.includes('free time')) {
      category = 'hobby';
      importance = 6;
    } else if (lower.includes('work') || lower.includes('job') || lower.includes('study') || lower.includes('kaam') || lower.includes('padhai')) {
      category = 'routine';
      importance = 6;
    } else if (lower.includes('dream') || lower.includes('goal') || lower.includes('want to') || lower.includes('chahta') || lower.includes('chahti')) {
      category = 'goal';
      importance = 7;
    } else if (lower.includes('birthday') || lower.includes('anniversary') || lower.includes('janamdin')) {
      category = 'important_date';
      importance = 9;
    }

    memoryService.create(userId, companionId, content, category, importance);
    return { category, content, importance };
  }
}

module.exports = new AIService();
