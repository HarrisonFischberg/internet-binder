// Topic tags: a local guess at what a save is about ("AI", "Video games", "Shoes"), from its title,
// channel or site, description and hashtags. No network and no AI; the guess is marked as a guess
// (item.topicsBy === 'guess') until you edit the tags yourself. Pure, so iOS/macOS can share it.
//
// Each topic lists phrases; a phrase in the title counts 3, in the channel or site 2, in the
// description or hashtags 1. A topic needs 3 to be kept (one title hit, or several elsewhere),
// and at most 3 topics are kept, strongest first.

export const MAX_TOPICS = 8;
const KEEP = 3;
const NEEDED = 3;

// [name, phrases]. Phrases are matched as whole words, case-insensitive, except the ones written
// in capitals (like "AI"), which must match in capitals so "ai" inside other words never counts.
export const TOPICS = [
  ['AI', ['AI', 'A.I.', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'LLM', 'LLMs', 'GPT', 'ChatGPT', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'Copilot', 'Midjourney', 'Stable Diffusion', 'prompt', 'prompts', 'prompting', 'AI agent', 'AI agents', 'vibe coding', 'generative']],
  ['Programming', ['programming', 'coding', 'developer', 'developers', 'software engineer', 'JavaScript', 'TypeScript', 'Python', 'Rust', 'Golang', 'React', 'Node.js', 'API', 'APIs', 'database', 'SQL', 'Kubernetes', 'Docker', 'DevOps', 'Linux', 'git', 'GitHub', 'open source', 'backend', 'frontend', 'web dev', 'Better Stack', 'Fireship', 'freeCodeCamp']],
  ['Tech', ['tech', 'technology', 'iPhone', 'Android', 'smartphone', 'laptop', 'MacBook', 'iPad', 'gadget', 'gadgets', 'unboxing', 'Apple', 'Samsung', 'Google Pixel', 'PC build', 'GPU', 'CPU', 'Nvidia', 'headphones', 'Marques Brownlee', 'MKBHD', 'Linus Tech Tips']],
  ['Video games', ['video game', 'video games', 'gaming', 'gamer', 'gameplay', 'playthrough', 'walkthrough', 'speedrun', 'let\'s play', 'GTA', 'GTA 5', 'GTA V', 'GTA 6', 'Minecraft', 'Fortnite', 'Call of Duty', 'Black Ops', 'Warzone', 'Zelda', 'Pokémon', 'Pokemon', 'Mario', 'Nintendo', 'Switch 2', 'PlayStation', 'PS5', 'Xbox', 'Steam', 'Elden Ring', 'Roblox', 'Valorant', 'League of Legends', 'Overwatch', 'Halo', 'Skyrim', 'Cyberpunk 2077', 'indie game', 'game dev', 'esports']],
  ['Shoes', ['shoe', 'shoes', 'sneaker', 'sneakers', 'trainers', 'boots', 'running shoes', 'Air Jordan', 'Jordans', 'Air Max', 'Air Force 1', 'Yeezy', 'New Balance', 'Adidas Samba', 'Dunk', 'Dunks', 'loafers', 'heels', 'sandals', 'on feet']],
  ['Fashion', ['fashion', 'outfit', 'outfits', 'style', 'streetwear', 'menswear', 'womenswear', 'haul', 'capsule wardrobe', 'wardrobe', 'thrift', 'thrifting', 'lookbook', 'what I wore', 'denim', 'jacket', 'hoodie']],
  ['Beauty', ['makeup', 'skincare', 'skin care', 'beauty', 'haircut', 'hairstyle', 'nails', 'fragrance', 'perfume', 'cologne', 'grooming', 'GRWM']],
  ['Fitness', ['workout', 'workouts', 'fitness', 'gym', 'strength training', 'weightlifting', 'bodybuilding', 'calisthenics', 'HIIT', 'running', 'marathon', 'yoga', 'pilates', 'mobility', 'cardio', 'kettlebell', 'squat', 'deadlift']],
  ['Food & cooking', ['recipe', 'recipes', 'cooking', 'cook', 'baking', 'bake', 'chef', 'kitchen', 'dinner', 'lunch', 'breakfast', 'meal prep', 'pasta', 'pizza', 'bread', 'sourdough', 'curry', 'ramen', 'steak', 'restaurant', 'food', 'street food', 'Gordon Ramsay', 'Joshua Weissman', 'Babish']],
  ['Coffee', ['coffee', 'espresso', 'latte', 'barista', 'pour over', 'James Hoffmann']],
  ['Music', ['music', 'song', 'songs', 'album', 'official video', 'music video', 'lyrics', 'live performance', 'concert', 'cover', 'guitar', 'piano', 'drums', 'bass', 'synth', 'producer', 'beat', 'beats', 'rap', 'hip hop', 'jazz', 'DJ set', 'Tiny Desk']],
  ['Film & TV', ['movie', 'movies', 'film', 'films', 'trailer', 'official trailer', 'TV series', 'episode', 'season', 'Netflix', 'HBO', 'Disney+', 'Marvel', 'Star Wars', 'film review', 'movie review', 'ending explained', 'box office', 'director', 'cinema']],
  ['Comedy', ['comedy', 'stand-up', 'standup', 'sketch', 'funny', 'prank', 'SNL', 'roast']],
  ['News & politics', ['news', 'politics', 'election', 'president', 'prime minister', 'parliament', 'congress', 'senate', 'government', 'policy', 'war', 'breaking', 'interview', 'debate', 'BBC News', 'CNN', 'Sky News']],
  ['Money', ['money', 'finance', 'investing', 'invest', 'stocks', 'stock market', 'ETF', 'ETFs', 'index fund', 'savings', 'budget', 'budgeting', 'mortgage', 'tax', 'taxes', 'retirement', 'pension', 'personal finance', 'crypto', 'Bitcoin', 'Ethereum']],
  ['Business', ['business', 'startup', 'startups', 'entrepreneur', 'founder', 'marketing', 'sales', 'SaaS', 'side hustle', 'ecommerce', 'Shopify', 'productivity', 'leadership', 'Y Combinator']],
  ['Science', ['science', 'physics', 'chemistry', 'biology', 'experiment', 'research', 'quantum', 'evolution', 'Veritasium', 'Kurzgesagt', 'Vsauce', 'Mark Rober']],
  ['Space', ['space', 'NASA', 'SpaceX', 'rocket', 'Mars', 'moon', 'astronaut', 'telescope', 'galaxy', 'black hole', 'Starship']],
  ['History', ['history', 'historical', 'ancient', 'medieval', 'World War', 'WWII', 'WW2', 'Roman', 'Romans', 'empire', 'documentary']],
  ['Travel', ['travel', 'trip', 'travel vlog', 'itinerary', 'things to do', 'tour', 'hotel', 'flight', 'airport', 'backpacking', 'road trip', 'city guide', 'Japan', 'Tokyo', 'Italy', 'Paris', 'London', 'New York']],
  ['Cars', ['car', 'cars', 'driving', 'drive', 'test drive', 'EV', 'electric car', 'Tesla', 'Porsche', 'BMW', 'Ferrari', 'supercar', 'F1', 'Formula 1', 'motorsport', 'Top Gear', 'engine', 'motorbike', 'motorcycle']],
  ['DIY & making', ['DIY', 'how to build', 'build', 'woodworking', 'restoration', 'restore', 'repair', 'fix', 'renovation', 'renovate', 'tools', 'workshop', 'maker', '3D print', '3D printing', 'welding', 'bushcraft', 'cabin', 'tiny house']],
  ['Home', ['home', 'house', 'interior', 'interior design', 'decor', 'apartment', 'room tour', 'house tour', 'cleaning', 'organizing', 'organisation', 'furniture', 'IKEA', 'dream home']],
  ['Garden', ['garden', 'gardening', 'plants', 'houseplants', 'vegetable garden', 'allotment', 'grow', 'growing', 'compost', 'seeds']],
  ['Outdoors', ['hiking', 'hike', 'camping', 'camp', 'outdoors', 'backpacking', 'climbing', 'fishing', 'survival', 'wild camping', 'trail', 'mountain', 'mountains', 'van life', 'vanlife', 'overlanding']],
  ['Pets', ['dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'pet', 'pets', 'animals']],
  ['Parenting', ['parenting', 'baby', 'toddler', 'kids', 'children', 'pregnancy', 'mum', 'mom', 'dad', 'family']],
  ['Health', ['health', 'sleep', 'nutrition', 'diet', 'mental health', 'anxiety', 'longevity', 'doctor', 'medical', 'Huberman', 'meditation', 'therapy']],
  ['Sports', ['football', 'soccer', 'Premier League', 'Champions League', 'NFL', 'NBA', 'basketball', 'baseball', 'MLB', 'tennis', 'golf', 'cricket', 'rugby', 'boxing', 'UFC', 'MMA', 'highlights', 'Olympics', 'cycling', 'Tour de France']],
  ['Photo & video', ['photography', 'photographer', 'camera', 'cameras', 'lens', 'lenses', 'Sony', 'Canon', 'Fujifilm', 'Lightroom', 'filmmaking', 'cinematography', 'editing', 'drone', 'GoPro']],
  ['Art & design', ['art', 'artist', 'drawing', 'painting', 'illustration', 'design', 'designer', 'graphic design', 'typography', 'Figma', 'animation', 'sculpture', 'pottery', 'ceramics']],
  ['Learning', ['tutorial', 'explained', 'how to', 'learn', 'lesson', 'course', 'beginner', 'beginners', 'crash course', 'lecture', 'study', 'language learning']],
  ['Books', ['book', 'books', 'reading', 'novel', 'author', 'book review', 'BookTok', 'library']],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match that also works next to accented letters and punctuation.
const MATCHERS = TOPICS.map(([name, phrases]) => {
  const caps = phrases.filter((p) => /^[A-Z0-9][A-Z0-9.+&-]*$/.test(p) && /[A-Z]/.test(p));
  const rest = phrases.filter((p) => !caps.includes(p));
  const re = (list, flags) => (list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}])`, `gu${flags}`) : null);
  return { name, caps: re(caps, ''), rest: re(rest, 'i') };
});

function hits(m, text) {
  if (!text) return 0;
  const found = new Set();
  for (const re of [m.caps, m.rest]) {
    if (!re) continue;
    re.lastIndex = 0;
    for (const x of text.matchAll(re)) found.add(x[0].toLowerCase());
  }
  return found.size;
}

// { title, channel, description, hashtags } -> up to 3 topic names, strongest first.
export function guessTopics({ title = '', channel = '', description = '', hashtags = [] } = {}) {
  const tags = (Array.isArray(hashtags) ? hashtags : []).map((h) => String(h).replace(/^#/, '').replace(/([a-z])([A-Z])/g, '$1 $2')).join(' ');
  const desc = `${String(description).slice(0, 2000)} ${tags}`;
  const scored = MATCHERS.map((m) => ({ name: m.name, score: hits(m, title) * 3 + hits(m, channel) * 2 + Math.min(hits(m, desc), 3) }))
    .filter((t) => t.score >= NEEDED)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, KEEP).map((t) => t.name);
}

// Tags as a person types them: trimmed, de-duplicated (any case), short, at most MAX_TOPICS.
export function cleanTopics(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(',')) {
    const t = String(raw ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}
