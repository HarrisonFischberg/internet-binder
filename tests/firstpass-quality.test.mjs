// First-pass sorting of shared posts: what kind a post is and which of your collections it goes to,
// before any AI. Each case is a pattern from real saves that went to the wrong place (tools/qa has the
// measured eval; these pin the rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfCapture } from '../keepsake/src/shared/capture.js';
import { classify, learnFromCorrection, emptyPrefs } from '../keepsake/src/shared/categorizer.js';
import { recipeFromText, isRecipePost, looksLikeWorkout, placeFromText } from '../keepsake/src/shared/kinds.js';

const post = (caption, extra = {}) => ({ isInstagram: true, url: 'https://www.instagram.com/p/x/', title: caption.split('\n')[0], description: caption, ...extra });
const cols = [
  { id: 'ai', name: 'AI' }, { id: 'tech', name: 'Technology', taxonomyKey: 'tech' }, { id: 'int', name: 'Interesting' },
  { id: 'food', name: 'Food' }, { id: 'trip', name: 'Roadtrip' }, { id: 'art', name: 'Art', taxonomyKey: 'crafts' },
];
const fileOf = (caption, prefs = {}) => classify({ title: caption.split('\n')[0], description: caption, host: 'www.instagram.com', instagram: { caption } }, { collections: cols, prefs, settings: { autoCreateCollections: false } });

test('a numbered list of AI tools is not a recipe', () => {
  const caption = 'Build your first AI agent this weekend\nIngredients:\n1. An LLM API key\n2. A vector database\n3. 3 tools it can call\nSave this for later';
  assert.equal(recipeFromText(caption), null);
  assert.equal(kindOfCapture(post(caption)), 'link');
});

test('a kettlebell workout ending in "📌 Save this" is a workout, not a place', () => {
  const caption = 'BUILD A STRONGER BACK WITH 1 KETTLEBELL\n1️⃣ KB Row — back + biceps\n2️⃣ KB Pullover — lats + core\n✅ 3–4 sets per exercise\n✅ 8–12 reps\n📌 Save this for your next back workout.';
  assert.equal(placeFromText(caption), null);
  assert.equal(kindOfCapture(post(caption)), 'workout');
});

test('a recipe that is a comment away is a recipe; a cafe post with 📍 is still a place', () => {
  const caption = '🍏APPLE FRITTER COFFEE CAKE🍏\nMy most popular fall recipe!! Comment RECIPE and I’ll send it to you!';
  assert.equal(isRecipePost(caption), true);
  assert.equal(kindOfCapture(post(caption)), 'recipe');
  assert.equal(kindOfCapture(post('Best coffee cake in town ☕️\n📍 Maman, 239 Centre St, New York, NY')), 'place');
  // Food words alone (a protein shake after the gym) aren't a recipe.
  assert.equal(isRecipePost('Grabbed a banana and a coffee after the gym'), false);
});

test('a location tag on a post about AI tools does not make it a place', () => {
  const caption = '16 free repos for Claude Code: Superpowers, claude-mem, GitHub MCP, Playwright MCP. Open-source and free.';
  assert.equal(kindOfCapture(post(caption, { igLocation: { name: 'Amity University Gurugram' } })), 'link');
  assert.equal(kindOfCapture(post('Sunset dinner here was unreal', { igLocation: { name: 'Nobu Malibu' } })), 'place');
});

test('"training a model" is not a workout', () => {
  assert.equal(looksLikeWorkout('Training a model on your own dataset with a free GPU notebook'), false);
  assert.equal(looksLikeWorkout('Full body kettlebell training, 3 sets'), true);
});

test('a collection named for a topic gets that topic’s posts, and Technology doesn’t take them', () => {
  const r = fileOf('I checked 60 days of my Claude Code logs. The AI agent setup that saved me hours, plus my prompts.');
  assert.equal(r.collectionId, 'ai');
  assert.ok(r.confidence >= 0.75, `confident enough to file at once (${r.confidence})`);
  // One AI word is a lead, not proof: it waits in Review rather than being guessed.
  assert.notEqual(fileOf('Stop shipping websites that look the same #vibecoding').collectionId, 'tech');
});

test('moves on Instagram saves never teach "everything from instagram.com goes here"', () => {
  let prefs = emptyPrefs();
  for (let i = 0; i < 5; i++) prefs = learnFromCorrection({ id: `p${i}`, title: `Post ${i}`, host: 'www.instagram.com', retailer: 'instagram.com' }, null, 'int', prefs);
  assert.deepEqual(prefs.retailerPrefs['www.instagram.com'] || {}, {});
  assert.deepEqual(prefs.retailerPrefs['instagram.com'] || {}, {});
  assert.notEqual(fileOf('Our 6 week roadtrip through Utah and Arizona. Zion, Bryce, Sedona.', prefs).collectionId, 'int');
});
