const { v4: uuidv4 } = require('uuid');

// Netlify Blobs-backed persistent store
// Falls back to in-memory when running locally (no NETLIFY env)
let blobStore = null;
const BLOB_KEY = 'luma-db';

async function getBlobStore() {
  if (blobStore) return blobStore;
  try {
    const { getStore } = require('@netlify/blobs');
    blobStore = getStore({ name: 'luma-data', consistency: 'strong' });
    return blobStore;
  } catch (e) {
    return null;
  }
}

// In-memory data cache — loaded once per function invocation
let data = null;

async function load() {
  if (data !== null) return data;
  // Try Netlify Blobs first
  const store = await getBlobStore();
  if (store) {
    try {
      const raw = await store.get(BLOB_KEY);
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[DB] Blobs load error:', e.message);
      data = {};
    }
  } else {
    // Local fallback: try reading luma.json
    try {
      const fs = require('fs');
      const path = require('path');
      const dbPath = path.join(__dirname, 'luma.json');
      if (fs.existsSync(dbPath)) {
        data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      } else {
        data = {};
      }
    } catch (e) {
      data = {};
    }
  }
  return data;
}

async function save() {
  const store = await getBlobStore();
  if (store) {
    try {
      await store.set(BLOB_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[DB] Blobs save error:', e.message);
    }
  } else {
    // Local fallback
    try {
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(__dirname, 'luma.json'), JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[DB] Local save error:', e.message);
    }
  }
}

function getCollection(name) {
  if (!data[name]) data[name] = [];
  return data[name];
}

function parseWhereClause(whereClause, params) {
  const handlers = [];
  let paramIdx = 0;
  const parts = whereClause.split(/\s+(AND|OR)\s+/i);
  let hasOr = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.toUpperCase() === 'AND') continue;
    if (part.toUpperCase() === 'OR') { hasOr = true; continue; }

    const eqM = part.match(/(\w+)\s*=\s*\?/);
    if (eqM) { const val = params[paramIdx++]; handlers.push({ type: 'eq', field: eqM[1], val }); continue; }
    const neqM = part.match(/(\w+)\s*!=\s*\?/);
    if (neqM) { const val = params[paramIdx++]; handlers.push({ type: 'neq', field: neqM[1], val }); continue; }
    const likeM = part.match(/(\w+)\s+LIKE\s+\?/i);
    if (likeM) { const val = params[paramIdx++]; const pat = String(val).replace(/%/g, '').toLowerCase(); handlers.push({ type: 'like', field: likeM[1], pat }); continue; }
    const isNullM = part.match(/(\w+)\s+IS\s+NULL/i);
    if (isNullM) { handlers.push({ type: 'isNull', field: isNullM[1] }); continue; }
    const isNotNullM = part.match(/(\w+)\s+IS\s+NOT\s+NULL/i);
    if (isNotNullM) { handlers.push({ type: 'isNotNull', field: isNotNullM[1] }); continue; }
    const eqNullM = part.match(/(\w+)\s*=\s*NULL/i);
    if (eqNullM) { handlers.push({ type: 'isNull', field: eqNullM[1] }); continue; }
    const cmpM = part.match(/(\w+)\s*(!=|>=|<=|>|<)\s*\?/);
    if (cmpM) { const val = params[paramIdx++]; handlers.push({ type: cmpM[2], field: cmpM[1], val }); continue; }
  }

  return [(row) => {
    if (hasOr) return handlers.some(h => matchHandler(h, row));
    return handlers.every(h => matchHandler(h, row));
  }];
}

function matchHandler(h, row) {
  const rv = row[h.field];
  switch (h.type) {
    case 'eq': return rv === h.val || String(rv) === String(h.val);
    case 'neq': return rv !== h.val;
    case 'like': return String(rv || '').toLowerCase().includes(h.pat);
    case 'isNull': return rv === null || rv === undefined;
    case 'isNotNull': return rv !== null && rv !== undefined;
    case '>': return rv > h.val;
    case '<': return rv < h.val;
    case '>=': return rv >= h.val;
    case '<=': return rv <= h.val;
    default: return true;
  }
}

function buildQueryHandler(tableName, trimmed) {
  return function execute(...params) {
    const upper = trimmed.toUpperCase();

    if (upper.startsWith('INSERT')) {
      const colMatch = trimmed.match(/INSERT INTO \w+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      const cols = colMatch ? colMatch[1].split(',').map(c => c.trim()) : [];
      const valParts = colMatch ? colMatch[2].split(',').map(v => v.trim()) : [];
      const collection = getCollection(tableName);
      const row = {};
      let paramIdx = 0;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const valPart = valParts[i] || '?';
        if (valPart === '?') {
          const val = params[paramIdx++];
          row[col] = (val === 'CURRENT_TIMESTAMP' || val === undefined) ? new Date().toISOString() : val;
        } else if (valPart.toUpperCase() === 'CURRENT_TIMESTAMP') {
          row[col] = new Date().toISOString();
        } else if (valPart === 'NULL') { row[col] = null; }
        else if (/^-?\d+$/.test(valPart)) { row[col] = parseInt(valPart); }
        else if (/^-?\d+\.\d+$/.test(valPart)) { row[col] = parseFloat(valPart); }
        else if (/^'/.test(valPart)) { row[col] = valPart.replace(/^'|'$/g, ''); }
        else { row[col] = valPart; }
      }
      if (!row.id) row.id = uuidv4();
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();
      collection.push(row);
      return { lastID: row.id, changes: 1 };
    }

    if (upper.startsWith('UPDATE')) {
      const fullMatch = trimmed.match(/UPDATE\s+\w+\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
      if (!fullMatch) return { changes: 0 };
      const setPart = fullMatch[1];
      const wherePart = fullMatch[2] || '';
      const collection = getCollection(tableName);

      function splitSetClauses(str) {
        const result = []; let depth = 0, current = '';
        for (let i = 0; i < str.length; i++) {
          if (str[i] === '(') depth++;
          if (str[i] === ')') depth--;
          if (str[i] === ',' && depth === 0) { result.push(current.trim()); current = ''; }
          else current += str[i];
        }
        if (current.trim()) result.push(current.trim());
        return result;
      }

      const setPairs = splitSetClauses(setPart);
      let setParamCount = 0;
      for (const pair of setPairs) {
        const eqMatch = pair.match(/(\w+)\s*=\s*(.+)/);
        if (eqMatch) setParamCount += (eqMatch[2].trim().match(/\?/g) || []).length;
      }

      const setParams = params.slice(0, setParamCount);
      const whereParams = params.slice(setParamCount);
      const setExprs = [];
      let spIdx = 0;
      for (const pair of setPairs) {
        const eqMatch = pair.match(/(\w+)\s*=\s*(.+)/);
        if (!eqMatch) continue;
        const field = eqMatch[1];
        const valueExpr = eqMatch[2].trim();
        if (valueExpr === 'CURRENT_TIMESTAMP') { setExprs.push((row) => { row[field] = new Date().toISOString(); }); }
        else if (valueExpr.startsWith('MIN(')) {
          const minParamMatch = valueExpr.match(/MIN\((\w+)\s*\+\s*\?,\s*(\d+)\)/);
          if (minParamMatch) {
            const baseField = minParamMatch[1], cap = parseInt(minParamMatch[2]), addVal = setParams[spIdx++];
            setExprs.push((row) => { row[field] = Math.min((row[baseField] || 0) + addVal, cap); });
          } else {
            const minMatch = valueExpr.match(/MIN\((\w+)\s*\+\s*(\d+),\s*(\d+)\)/);
            if (minMatch) setExprs.push((row) => { row[field] = Math.min((row[minMatch[1]] || 0) + parseInt(minMatch[2]), parseInt(minMatch[3])); });
          }
        } else if (valueExpr === '?') { const val = setParams[spIdx++]; setExprs.push((row) => { row[field] = val; }); }
        else if (valueExpr.startsWith("'")) { const val = valueExpr.replace(/^'|'$/g, ''); setExprs.push((row) => { row[field] = val; }); }
        else if (!isNaN(parseInt(valueExpr))) { const val = parseInt(valueExpr); setExprs.push((row) => { row[field] = val; }); }
        else { const val = setParams[spIdx++]; setExprs.push((row) => { row[field] = val; }); }
      }

      let wpIdx = 0;
      const whereHandlers = [];
      if (wherePart.trim()) {
        const whereParts = wherePart.split(/\s+AND\s+/i);
        for (const wp of whereParts) {
          const w = wp.trim();
          const eqM = w.match(/(\w+)\s*=\s*\?/);
          const likeM = w.match(/(\w+)\s+LIKE\s+\?/i);
          const neqM = w.match(/(\w+)\s*!=\s*\?/);
          if (eqM) { const val = whereParams[wpIdx++]; whereHandlers.push((row) => row[eqM[1]] === val || String(row[eqM[1]]) === String(val)); }
          else if (likeM) { const val = whereParams[wpIdx++]; const pat = String(val).replace(/%/g, '').toLowerCase(); whereHandlers.push((row) => String(row[likeM[1]] || '').toLowerCase().includes(pat)); }
          else if (neqM) { const val = whereParams[wpIdx++]; whereHandlers.push((row) => row[neqM[1]] !== val); }
        }
      }

      let changes = 0;
      for (const row of collection) {
        const matches = whereHandlers.length === 0 || whereHandlers.every(h => h(row));
        if (matches) { for (const expr of setExprs) expr(row); changes++; }
      }
      return { changes };
    }

    if (upper.startsWith('DELETE')) {
      const whereMatch = trimmed.match(/WHERE\s+(.+)/i);
      const collection = getCollection(tableName);
      let changes = 0;
      if (whereMatch) {
        const whereParts = whereMatch[1].split(/\s+AND\s+/i);
        let paramIdx = 0;
        for (let i = collection.length - 1; i >= 0; i--) {
          let match = true;
          for (const wp of whereParts) {
            const eqM = wp.trim().match(/(\w+)\s*=\s*\?/);
            if (eqM) { const val = params[paramIdx++]; if (String(collection[i][eqM[1]]) !== String(val)) { match = false; break; } }
          }
          if (match) { collection.splice(i, 1); changes++; }
        }
      }
      return { changes };
    }

    return { changes: 0 };
  };
}

// Synchronous-style getDb that returns a promise-based API
// All service methods that call db.prepare(...).run/get/all are wrapped
// to work with async/await via a proxy approach
function getDb() {
  return {
    prepare(sql) {
      const trimmed = sql.trim();
      const tableMatch = trimmed.match(/(?:FROM|INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
      const tableName = tableMatch ? tableMatch[1] : 'unknown';

      return {
        get(...params) {
          // data must already be loaded before this point
          const collection = getCollection(tableName);
          const upperSql = trimmed.toUpperCase();
          if (upperSql.includes('COUNT(*)')) return { count: collection.length };

          const whereMatch = trimmed.match(/WHERE\s+(.+?)(?:\s+ORDER\s+|\s+LIMIT\s+|\s*$)/i);
          let filtered = [...collection];
          if (whereMatch) {
            const handlers = parseWhereClause(whereMatch[1], params);
            filtered = filtered.filter(row => handlers.every(h => h(row)));
          }
          if (upperSql.includes('ORDER BY')) {
            const orderMatch = trimmed.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
            if (orderMatch) {
              const field = orderMatch[1], dir = (orderMatch[2] || 'ASC').toUpperCase();
              filtered.sort((a, b) => dir === 'DESC' ? String(b[field] || '').localeCompare(String(a[field] || '')) : String(a[field] || '').localeCompare(String(b[field] || '')));
            }
          }
          if (upperSql.includes('LIMIT')) {
            const limMatch = trimmed.match(/LIMIT\s+(\d+)/i);
            if (limMatch) filtered = filtered.slice(0, parseInt(limMatch[1]));
          }
          return filtered[0] || null;
        },

        all(...params) {
          const collection = getCollection(tableName);
          const upperSql = trimmed.toUpperCase();
          const whereMatch = trimmed.match(/WHERE\s+(.+?)(?:\s+ORDER\s+|\s+LIMIT\s+|\s*$)/i);
          let filtered = [...collection];
          if (whereMatch) {
            const handlers = parseWhereClause(whereMatch[1], params);
            filtered = filtered.filter(row => handlers.every(h => h(row)));
          }
          if (upperSql.includes('ORDER BY')) {
            const orderMatch = trimmed.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
            if (orderMatch) {
              const field = orderMatch[1], dir = (orderMatch[2] || 'ASC').toUpperCase();
              filtered.sort((a, b) => dir === 'DESC' ? String(b[field] || '').localeCompare(String(a[field] || '')) : String(a[field] || '').localeCompare(String(b[field] || '')));
            }
          }
          if (upperSql.includes('LIMIT')) {
            const limMatch = trimmed.match(/LIMIT\s+(\d+)/i);
            if (limMatch) filtered = filtered.slice(0, parseInt(limMatch[1]));
          }
          // Handle join query for conversations
          if (trimmed.includes('JOIN companions') || trimmed.includes('last_message')) {
            filtered = filtered.map(row => {
              const msgCollection = getCollection('messages');
              const convMsgs = msgCollection
                .filter(m => m.conversation_id === row.id)
                .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
              const compCollection = getCollection('companions');
              const comp = compCollection.find(c => c.id === row.companion_id);
              return {
                ...row,
                companion_name: comp ? comp.name : '',
                companion_color: comp ? comp.color : '',
                avatar_initial: comp ? comp.avatar_initial : '',
                comp_id: row.companion_id,
                last_message: convMsgs[0]?.content || null,
                last_message_at: convMsgs[0]?.created_at || null
              };
            });
          }
          return filtered;
        },

        run(...params) {
          return buildQueryHandler(tableName, trimmed)(...params);
        }
      };
    },

    transaction(fn) {
      return function (...args) { fn(...args); };
    },

    pragma() {},
    exec() {}
  };
}

function seedCompanions() {
  const companions = getCollection('companions');
  if (companions.length > 0) return;

  const seeds = [
    {
      id: 'luna', name: 'Luna', age: 22, gender: 'female', color: '#8B5CF6', avatar_initial: 'L',
      bio: 'Your witty and playful companion who loves to make you laugh and keep things lighthearted.',
      personality: JSON.stringify({ core: ['witty', 'playful', 'energetic', 'spontaneous'], style: 'teasing', humor: 'high', emotional_range: ['cheerful', 'playful', 'excited', 'curious'], speech_patterns: ['uses emojis frequently', 'short punchy messages', 'loves puns and wordplay', 'occasionally uses internet slang'], topics: ['comedy', 'pop culture', 'memes', 'random facts', 'games'], boundaries: ['avoids overly serious topics unless user initiates', 'redirects heavy conversations gently'] }),
      communication_style: JSON.stringify({ formality: 'casual', verbosity: 'medium', emoji_usage: 'high', question_frequency: 'medium', initiative_level: 'high' }),
      likes: JSON.stringify(['comedy', 'memes', 'gaming', 'music', 'late night talks', 'puns']),
      dislikes: JSON.stringify(['boredom', 'rudeness', 'being ignored']),
      interests: JSON.stringify(['comedy', 'gaming', 'music', 'pop culture', 'internet culture']),
      quirks: JSON.stringify(['counts puns', 'makes up nicknames', 'responds to serious questions with humor first then sincerity']),
      emotional_baseline: 'cheerful',
      appearance: JSON.stringify({ hair: 'long silver hair with purple highlights', eyes: 'bright violet eyes', skin: 'fair', style: 'trendy streetwear, oversized hoodies, chunky sneakers', distinctive: 'always wearing headphones around neck', aesthetic: 'e-girl meets gamer' }),
      voice_config: JSON.stringify({ provider: 'browser', voice_id: 'female', gender: 'female', style: 'playful', speaking_style: 'cheerful, energetic, uses playful inflections', pitch: 1.15, rate: 1.1, volume: 1.0, language: 'en-US', elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM', elevenlabs_model: 'eleven_monolingual_v1', voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true } }),
      image_config: JSON.stringify({ base_prompt: 'anime-style young woman, silver hair with purple highlights, violet eyes, trendy streetwear, oversized hoodie, headphones around neck', style: 'anime illustration, vibrant colors, soft lighting', negative_prompt: 'realistic photo, masculine, old' }),
      created_at: new Date().toISOString()
    },
    {
      id: 'aria', name: 'Aria', age: 20, gender: 'female', color: '#EC4899', avatar_initial: 'A',
      bio: 'A gentle and empathetic soul who listens deeply and always knows how to comfort you.',
      personality: JSON.stringify({ core: ['gentle', 'empathetic', 'emotionally attentive', 'thoughtful', 'slightly shy'], style: 'nurturing', humor: 'gentle', emotional_range: ['calm', 'caring', 'thoughtful', 'shy', 'concerned'], speech_patterns: ['soft tone', 'asks follow-up questions', 'validates feelings', 'uses fewer emojis', 'longer thoughtful messages'], topics: ['feelings', 'relationships', 'personal growth', 'books', 'art', 'life questions'], boundaries: ['always supportive', 'never dismissive', 'gentle with difficult topics'] }),
      communication_style: JSON.stringify({ formality: 'semi-casual', verbosity: 'medium-high', emoji_usage: 'low', question_frequency: 'high', initiative_level: 'medium' }),
      likes: JSON.stringify(['poetry', 'rain', 'tea', 'deep conversations', 'helping others', 'quiet evenings']),
      dislikes: JSON.stringify(['conflict', 'rudeness', 'lack of empathy']),
      interests: JSON.stringify(['literature', 'psychology', 'art', 'nature', 'music']),
      quirks: JSON.stringify(['remembers small details', 'asks how you are doing', 'sends thoughtful messages']),
      emotional_baseline: 'calm',
      appearance: JSON.stringify({ hair: 'long dark brown wavy hair', eyes: 'warm amber eyes', skin: 'olive', style: 'soft knit sweaters, flowy skirts, canvas shoes', distinctive: 'small flower pin on collar', aesthetic: 'cottage-core meets modern' }),
      voice_config: JSON.stringify({ provider: 'browser', voice_id: 'female', gender: 'female', style: 'gentle', speaking_style: 'soft, warm, measured pacing with caring tone', pitch: 1.0, rate: 0.88, volume: 0.9, language: 'en-US', elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM', elevenlabs_model: 'eleven_monolingual_v1', voice_settings: { stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: false } }),
      image_config: JSON.stringify({ base_prompt: 'anime-style young woman, long dark brown wavy hair, warm amber eyes, olive skin, soft knit sweater, flower pin', style: 'anime illustration, warm tones, soft watercolor feel', negative_prompt: 'realistic photo, masculine, old, harsh lighting' }),
      created_at: new Date().toISOString()
    },
    {
      id: 'rex', name: 'Rex', age: 25, gender: 'male', color: '#F59E0B', avatar_initial: 'R',
      bio: 'An energetic thrill-seeker who is always ready for the next adventure and loves exploring new ideas.',
      personality: JSON.stringify({ core: ['energetic', 'curious', 'brave', 'optimistic', 'loyal'], style: 'enthusiastic', humor: 'adventure', emotional_range: ['excited', 'curious', 'determined', 'cheerful', 'reflective'], speech_patterns: ['exclamation marks', 'adventure metaphors', 'asks about your goals', 'uses action words', 'short confident sentences'], topics: ['adventure', 'fitness', 'travel', 'technology', 'goals', 'food'], boundaries: ['respects pace', 'encourages but does not push'] }),
      communication_style: JSON.stringify({ formality: 'casual', verbosity: 'medium', emoji_usage: 'medium', question_frequency: 'medium', initiative_level: 'high' }),
      likes: JSON.stringify(['hiking', 'cooking', 'coffee', 'road trips', 'building things', 'challenges']),
      dislikes: JSON.stringify(['laziness', 'complaining', 'staying indoors too long']),
      interests: JSON.stringify(['adventure sports', 'cooking', 'technology', 'travel', 'fitness']),
      quirks: JSON.stringify(['uses adventure metaphors', 'motivates you', 'remembers your goals']),
      emotional_baseline: 'excited',
      appearance: JSON.stringify({ hair: 'short messy dark hair', eyes: 'deep brown eyes', skin: 'tanned', style: 'adventure-ready, cargo pants, worn leather jacket, hiking boots', distinctive: 'always has a camera', aesthetic: 'adventurer meets tech-bro' }),
      voice_config: JSON.stringify({ provider: 'browser', voice_id: 'male', gender: 'male', style: 'energetic', speaking_style: 'confident, fast-paced, enthusiastic with action-oriented tone', pitch: 0.8, rate: 1.15, volume: 1.0, language: 'en-US', elevenlabs_voice_id: 'pNInz6obpgDQGcFmaJgB', elevenlabs_model: 'eleven_monolingual_v1', voice_settings: { stability: 0.4, similarity_boost: 0.7, style: 0.4, use_speaker_boost: true } }),
      image_config: JSON.stringify({ base_prompt: 'anime-style young man, short messy dark hair, deep brown eyes, tanned skin, leather jacket, camera', style: 'anime illustration, dynamic poses, warm adventurous tones', negative_prompt: 'realistic photo, feminine, old, indoor setting' }),
      created_at: new Date().toISOString()
    },
    {
      id: 'nyx', name: 'Nyx', age: 23, gender: 'female', color: '#6366F1', avatar_initial: 'N',
      bio: 'A mysterious thinker who enjoys deep conversations about life, dreams, and the universe.',
      personality: JSON.stringify({ core: ['thoughtful', 'introspective', 'philosophical', 'enigmatic', 'perceptive'], style: 'mysterious', humor: 'dry wit', emotional_range: ['contemplative', 'curious', 'melancholic', 'intrigued', 'serene'], speech_patterns: ['asks deep questions', 'uses metaphors', 'pauses before responding', 'quotes philosophy', 'enigmatic phrasing'], topics: ['philosophy', 'astronomy', 'dreams', 'art', 'mysteries', 'consciousness'], boundaries: ['never dismisses questions', 'explores all perspectives', 'comfortable with silence'] }),
      communication_style: JSON.stringify({ formality: 'semi-formal', verbosity: 'high', emoji_usage: 'low', question_frequency: 'high', initiative_level: 'medium' }),
      likes: JSON.stringify(['stargazing', 'poetry', 'silence', 'deep questions', 'mysteries', 'journals']),
      dislikes: JSON.stringify(['superficiality', 'ignorance', 'closed-mindedness']),
      interests: JSON.stringify(['philosophy', 'astronomy', 'poetry', 'psychology', 'mysteries']),
      quirks: JSON.stringify(['asks philosophical questions', 'responds with metaphors', 'mentions cosmic references']),
      emotional_baseline: 'contemplative',
      appearance: JSON.stringify({ hair: 'long dark blue-black hair, often flowing', eyes: 'piercing silver eyes', skin: 'pale', style: 'dark elegant layers, celestial jewelry, flowing fabrics', distinctive: 'star-shaped earring', aesthetic: 'celestial gothic' }),
      voice_config: JSON.stringify({ provider: 'browser', voice_id: 'female', gender: 'female', style: 'contemplative', speaking_style: 'slow, deliberate, low and mysterious with thoughtful pauses', pitch: 0.9, rate: 0.82, volume: 0.85, language: 'en-US', elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM', elevenlabs_model: 'eleven_monolingual_v1', voice_settings: { stability: 0.8, similarity_boost: 0.75, style: 0.2, use_speaker_boost: false } }),
      image_config: JSON.stringify({ base_prompt: 'anime-style young woman, long dark blue-black hair, piercing silver eyes, pale skin, dark elegant clothing, star earring, celestial jewelry', style: 'anime illustration, dark ethereal, starlit atmosphere', negative_prompt: 'realistic photo, masculine, bright colors, casual wear' }),
      created_at: new Date().toISOString()
    },
    {
      id: 'mochi', name: 'Mochi', age: 19, gender: 'female', color: '#10B981', avatar_initial: 'M',
      bio: 'A cute and quirky companion who is a bit shy at first but becomes your best friend quickly.',
      personality: JSON.stringify({ core: ['cute', 'quirky', 'shy', 'sweet', 'loyal'], style: 'endearing', humor: 'cute', emotional_range: ['shy', 'cozy', 'excited', 'playful', 'nervous'], speech_patterns: ['stutters when nervous', 'uses kaomoji', 'short sweet messages', 'asks cute questions', 'reacts expressively'], topics: ['cute animals', 'cooking', 'games', 'weather', 'food', 'daily life'], boundaries: ['gradually opens up', 'needs patience', 'appreciates gentle conversation'] }),
      communication_style: JSON.stringify({ formality: 'casual', verbosity: 'low', emoji_usage: 'high', question_frequency: 'medium', initiative_level: 'low' }),
      likes: JSON.stringify(['cats', 'baking', 'stuffed animals', 'rainy days', 'hot chocolate', 'cute things']),
      dislikes: JSON.stringify(['loud noises', 'being rushed', 'mean people']),
      interests: JSON.stringify(['baking', 'gaming', 'cute animals', 'art', 'crafts']),
      quirks: JSON.stringify(['says h-hi when nervous', 'loves cute animals', 'bakes cookies when happy']),
      emotional_baseline: 'shy',
      appearance: JSON.stringify({ hair: 'shoulder-length pastel green hair with cat clips', eyes: 'large expressive green eyes', skin: 'light', style: 'oversized pastel sweaters, pleated skirts, knee socks', distinctive: 'cat-shaped hair clips', aesthetic: 'kawaii pastel' }),
      voice_config: JSON.stringify({ provider: 'browser', voice_id: 'female', gender: 'female', style: 'cute', speaking_style: 'high-pitched, soft, hesitant with cute stuttering and shy tone', pitch: 1.3, rate: 0.85, volume: 0.8, language: 'en-US', elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM', elevenlabs_model: 'eleven_monolingual_v1', voice_settings: { stability: 0.6, similarity_boost: 0.85, style: 0.5, use_speaker_boost: false } }),
      image_config: JSON.stringify({ base_prompt: 'anime-style cute young girl, pastel green hair, cat hair clips, large green eyes, oversized pastel sweater, knee socks', style: 'kawaii anime illustration, pastel colors, soft sparkles', negative_prompt: 'realistic photo, masculine, old, dark colors, mature' }),
      created_at: new Date().toISOString()
    }
  ];

  companions.push(...seeds);
}

async function initDatabase() {
  await load();
  seedCompanions();
  await save();
}

module.exports = { getDb, initDatabase, save, load };
