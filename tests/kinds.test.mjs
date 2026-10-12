// Kinds and recipe details (src/shared/kinds.js), recipe extraction from pages, and how saves get a kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { minutesFrom, formatMinutes, recipeFromSchema, recipeFromText, kindFromSchemaTypes, kindOf, keyFact, sanitizeDetails } from '../keepsake/src/shared/kinds.js';
import { makeItem } from '../keepsake/src/shared/storage.js';

test('durations: ISO 8601 and plain text', () => {
  assert.equal(minutesFrom('PT1H30M'), 90);
  assert.equal(minutesFrom('P0DT45M'), 45);
  assert.equal(minutesFrom('PT20M30S'), 21);
  assert.equal(minutesFrom('25 min'), 25);
  assert.equal(minutesFrom('1 hr 10 mins'), 70);
  assert.equal(minutesFrom('soon'), null);
  assert.equal(minutesFrom(''), null);
  assert.equal(formatMinutes(90), '1 hr 30 min');
  assert.equal(formatMinutes(25), '25 min');
});

test('recipe from schema.org: ingredients, HowToStep and HowToSection steps, yield and times', () => {
  const r = recipeFromSchema({
    '@type': 'Recipe', name: 'Brown butter pasta', recipeIngredient: ['200 g pasta', '50 g butter', '<b>sage</b> leaves'],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Boil the pasta.' }] },
      { '@type': 'HowToStep', text: 'Brown the butter with sage.' },
      'Toss and serve.',
    ],
    recipeYield: ['2', '2 servings'], prepTime: 'PT10M', cookTime: 'PT15M', recipeCuisine: 'Italian', author: { '@type': 'Person', name: 'Sam' },
  });
  assert.deepEqual(r.ingredients, ['200 g pasta', '50 g butter', 'sage leaves']);
  assert.deepEqual(r.steps, ['Boil the pasta.', 'Brown the butter with sage.', 'Toss and serve.']);
  assert.equal(r.yield, '2 servings');
  assert.equal(r.totalMinutes, 25);
  assert.equal(r.cuisine, 'Italian');
  assert.equal(r.author, 'Sam');
  assert.equal(r.source, 'page');
  assert.equal(recipeFromSchema({ '@type': 'Recipe', name: 'empty' }), null);
});

test('recipe from a caption with headings', () => {
  const r = recipeFromText(`15-minute miso butter noodles 🍜
Ingredients:
- 200g udon noodles
- 2 tbsp white miso
- 30g butter
- 2 spring onions
Method:
1. Cook the noodles.
2. Melt butter with miso.
3. Toss and top with spring onion.
#noodles #easydinner`);
  assert.deepEqual(r.ingredients, ['200g udon noodles', '2 tbsp white miso', '30g butter', '2 spring onions']);
  assert.deepEqual(r.steps, ['Cook the noodles.', 'Melt butter with miso.', 'Toss and top with spring onion.']);
  assert.equal(r.source, 'caption');
});

test('recipe from a caption without headings (quantity-led lines)', () => {
  const r = recipeFromText('Best pancakes\n1 cup flour\n2 eggs\n1 cup milk\n1 tbsp sugar\nMix and fry!');
  assert.equal(r.ingredients.length, 4);
});

test('ordinary captions are not recipes', () => {
  assert.equal(recipeFromText('Morning light in the kitchen corner ✨\n#home #decor'), null);
  assert.equal(recipeFromText('New drop! 3 colours, 2 fits.\nShop the link in bio'), null);
  assert.equal(recipeFromText(''), null);
});

test('kind from structured-data types', () => {
  assert.equal(kindFromSchemaTypes(['WebPage', 'Recipe']), 'recipe');
  assert.equal(kindFromSchemaTypes(['Product']), 'product');
  assert.equal(kindFromSchemaTypes(['Restaurant']), 'place');
  assert.equal(kindFromSchemaTypes(['NewsArticle']), 'article');
  assert.equal(kindFromSchemaTypes(['VideoObject']), 'video');
  assert.equal(kindFromSchemaTypes(['Movie']), 'media');
  assert.equal(kindFromSchemaTypes(['Book']), 'book');
  assert.equal(kindFromSchemaTypes(['WebSite']), null);
});

test('older saves get a kind; an Instagram caption with ingredients becomes a recipe', () => {
  assert.equal(kindOf({ type: 'product' }), 'product');
  assert.equal(kindOf({ type: 'instagram' }), 'link');
  assert.equal(makeItem({ title: 'Tent', url: 'https://a.example/t' }).kind, 'product');
  const ig = makeItem({ url: 'https://www.instagram.com/p/AbCdE1/', instagram: { caption: 'Ingredients:\n2 eggs\n1 cup milk\n1 cup flour\nMethod:\nWhisk and fry.' } });
  assert.equal(ig.kind, 'recipe');
  assert.equal(ig.details.ingredients.length, 3);
  assert.equal(ig.details.source, 'caption');
  const kept = makeItem({ ...ig, kind: 'link' });
  assert.equal(kept.kind, 'link', 'a kind the person chose is kept');
  assert.equal(makeItem({ title: 'x', status: 'nonsense' }).status, 'saved');
});

test('key facts and sanitizing', () => {
  assert.equal(keyFact({ kind: 'recipe', details: { ingredients: ['a', 'b'], totalMinutes: 25 } }), '2 ingredients · 25 min');
  const d = sanitizeDetails('recipe', { ingredients: ['<script>x</script>ok'], steps: 'one step', totalMinutes: -5, source: 'evil' });
  assert.deepEqual(d.ingredients, ['x ok']);
  assert.deepEqual(d.steps, ['one step']);
  assert.equal(d.totalMinutes, null);
  assert.equal(d.source, 'you');
});

// --- extraction ---------------------------------------------------------------------------------
const EXTRACT = readFileSync(new URL('../keepsake/src/extract/extract.js', import.meta.url), 'utf8');
const extractFrom = (html, url = 'https://cook.example/recipes/pasta') => {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__keepsakeHints = {};
  // Plain copy: arrays made inside jsdom belong to another realm, which strict deep-equal rejects.
  return JSON.parse(JSON.stringify(dom.window.eval(EXTRACT)));
};

test('extract: a JSON-LD recipe page', () => {
  const p = extractFrom(`<html><head><title>Pasta | Cook</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Brown butter pasta","image":"https://cdn.cook.example/p.jpg","recipeIngredient":["200 g pasta","50 g butter"],"recipeInstructions":[{"@type":"HowToStep","text":"Boil."},{"@type":"HowToStep","text":"Toss."}],"totalTime":"PT25M","recipeYield":"2"}]}</script>
    </head><body><p>Our cookbook $29.99</p></body></html>`);
  assert.equal(p.title, 'Brown butter pasta');
  assert.ok(p.schemaTypes.includes('recipe'));
  assert.deepEqual(p.recipe.recipeIngredient, ['200 g pasta', '50 g butter']);
  assert.equal(recipeFromSchema(p.recipe).totalMinutes, 25);
  assert.equal(p.image, 'https://cdn.cook.example/p.jpg');
});

test('extract: a microdata recipe page', () => {
  const p = extractFrom(`<html><head><title>Soup</title></head><body>
    <div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Tomato soup</h1>
    <ul><li itemprop="recipeIngredient">4 tomatoes</li><li itemprop="recipeIngredient">1 onion</li></ul>
    <ol itemprop="recipeInstructions"><li>Chop.</li><li>Simmer 20 minutes.</li></ol>
    <meta itemprop="totalTime" content="PT30M"></div></body></html>`);
  assert.equal(p.title, 'Tomato soup');
  const r = recipeFromSchema(p.recipe);
  assert.deepEqual(r.ingredients, ['4 tomatoes', '1 onion']);
  assert.deepEqual(r.steps, ['Chop.', 'Simmer 20 minutes.']);
  assert.equal(r.totalMinutes, 30);
});

test('imported recipe text: HTML entities decoded (also double-encoded), words left alone', async () => {
  const { decodeEntities, tidyImportedText } = await import('../keepsake/src/shared/util.js');
  assert.equal(decodeEntities('roll the dough out in a 14&#215;8-inch (36&#215;20-cm) rectangle'), 'roll the dough out in a 14×8-inch (36×20-cm) rectangle');
  assert.equal(decodeEntities('Ben &amp;amp; Jerry&#x27;s'), "Ben & Jerry's");
  assert.equal(decodeEntities('&frac12; cup &ndash; heaped, 180&deg;C'), '½ cup – heaped, 180°C');
  assert.equal(decodeEntities('&notathing; &#0; AT&T'), '&notathing; &#0; AT&T', 'unknown names, NUL and bare ampersands stay');
  assert.equal(tidyImportedText('Add salt , pepper and <b>stir</b> .'), 'Add salt, pepper and stir.');
  assert.equal(tidyImportedText('Bake at 200&deg;C ( 180&deg;C fan )'), 'Bake at 200°C (180°C fan)');
  assert.equal(tidyImportedText('Recieve the dough'), 'Recieve the dough', 'spelling is never changed');

  const r = recipeFromSchema({
    recipeIngredient: ['1 &frac12; cups flour', 'Salt &amp; pepper'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'After 10 minutes, roll the dough out in a 14&#215;8-inch (36&#215;20-cm) rectangle' }],
    author: { name: 'Jos&eacute; Andr&eacute;s' },
  });
  assert.deepEqual(r.ingredients, ['1 ½ cups flour', 'Salt & pepper']);
  assert.equal(r.steps[0], 'After 10 minutes, roll the dough out in a 14×8-inch (36×20-cm) rectangle');
  assert.equal(r.author, 'José Andrés');
  assert.equal(makeItem({ url: 'https://example.com/r', title: 'Mac &amp; cheese' }).title, 'Mac & cheese');
});
