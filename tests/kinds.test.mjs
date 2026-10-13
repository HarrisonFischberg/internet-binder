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

test('workouts: exercise lines in the ways people write them', async () => {
  const { parseExerciseLine, formatExercise } = await import('../keepsake/src/shared/kinds.js');
  const cases = {
    'Squats 3x12': ['Squats', 3, 12, null],
    'Push-ups — 4 sets of 10': ['Push-ups', 4, 10, null],
    '3 sets x 12 reps lunges': ['Lunges', 3, 12, null],
    '1. Goblet squat 3×10': ['Goblet squat', 3, 10, null],
    'Plank 3 x 45s': ['Plank', 3, null, 45],
    'Wall sit: 1 min': ['Wall sit', null, null, 60],
    '10 burpees': ['Burpees', null, 10, null],
    'Step-ups 3x10 (each leg)': ['Step-ups', 3, 10, null],
  };
  for (const [line, [name, sets, reps, secs]] of Object.entries(cases)) {
    const e = parseExerciseLine(line);
    assert.deepEqual([e?.name, e?.sets, e?.reps, e?.durationSeconds], [name, sets, reps, secs], line);
  }
  for (const line of ['Rest 60s', '200 g flour', '2 x 400 g tins tomatoes', 'Sets: 3']) assert.equal(parseExerciseLine(line), null, line);
  assert.equal(formatExercise({ name: 'Plank', sets: 3, durationSeconds: 60, restSeconds: 30 }), 'Plank 3×1 min rest 30s');
  assert.deepEqual(parseExerciseLine(formatExercise({ name: 'Squats', sets: 3, reps: 12 })), { name: 'Squats', sets: 3, reps: 12, durationSeconds: null, restSeconds: null }, 'what Keepsake writes, it reads back');
});

test('workouts: a caption with rounds and rest; recipe captions never become workouts', async () => {
  const { workoutFromText, looksLikeWorkout } = await import('../keepsake/src/shared/kinds.js');
  const w = workoutFromText('20 min full body HIIT workout 🔥\n4 rounds:\n10 burpees\n20 jumping jacks\nPlank 45s\nRest 60s\n#fitness');
  assert.deepEqual(w.exercises.map((e) => [e.name, e.sets, e.reps, e.durationSeconds, e.restSeconds]), [['Burpees', 4, 10, null, null], ['Jumping jacks', 4, 20, null, null], ['Plank', 4, null, 45, 60]]);
  assert.equal(w.durationMinutes, 20);
  assert.equal(workoutFromText('Squats 3x12'), null, 'one exercise is not a workout');
  const recipe = 'Pasta for two\nIngredients:\n200 g pasta\n3 eggs\n50 g parmesan\nMethod:\nBoil the pasta.';
  assert.equal(looksLikeWorkout(recipe), false);
  const item = makeItem({ url: 'https://www.instagram.com/p/abc/', type: 'instagram', instagram: { caption: recipe } });
  assert.equal(item.kind, 'recipe');
  const wItem = makeItem({ url: 'https://www.instagram.com/p/def/', type: 'instagram', instagram: { caption: 'Leg day workout\n3x12 squats\n3x10 lunges\n3x15 glute bridges' } });
  assert.equal(wItem.kind, 'workout');
  assert.equal(wItem.details.exercises.length, 3);
  assert.equal(wItem.details.source, 'caption');
  assert.equal(keyFact(wItem), '3 exercises');
});

test('workout details are sanitized: bad exercises dropped, numbers bounded', () => {
  const d = sanitizeDetails('workout', { exercises: [{ name: 'Squats', sets: 3, reps: 12 }, { name: 'x', reps: 5 }, { name: 'Plank', durationSeconds: 99999 }, 'junk', { name: 'Row', sets: 3, reps: 10, durationSeconds: 30 }], durationMinutes: 45.4, focus: 'Legs', source: 'hacked' });
  assert.deepEqual(d.exercises.map((e) => e.name), ['Squats', 'Plank', 'Row']);
  assert.equal(d.exercises[1].durationSeconds, null, 'an impossible time is dropped, the exercise kept');
  assert.equal(d.exercises[2].reps, null, 'a timed exercise has no reps');
  assert.equal(d.durationMinutes, 45);
  assert.equal(d.source, 'you');
  assert.equal(kindFromSchemaTypes(['ExercisePlan']), 'workout');
});

test('workouts: prose under a page heading names the exercise; sentences are never names', async () => {
  const { workoutFromText, parseExerciseLine } = await import('../keepsake/src/shared/kinds.js');
  const w = workoutFromText([
    '## Chair squats', 'Try to do 8 repetitions, slowly.',
    '## Heel raises', 'Repeat 10 times.',
    '## Wall plank', 'Hold for up to 20 seconds.',
    '## Band rows', 'Attempt 2 sets of 8 to 12 repetitions.',
    '## Related articles', 'Updated 3 May 2026',
  ].join('\n'), { source: 'page' });
  assert.deepEqual(w.exercises.map((e) => [e.name, e.sets, e.reps, e.durationSeconds]), [
    ['Chair squats', null, 8, null], ['Heel raises', null, 10, null], ['Wall plank', null, null, 20], ['Band rows', 2, 8, null],
  ]);
  for (const line of ['Attempt 3 sets of 5', 'This can also be done sitting. Repeat 3x5', 'Warm up for 5 minutes']) assert.equal(parseExerciseLine(line), null, line);
});

test('workouts: an Instagram caption flattened to one line, names listed once, numbers given for all', async () => {
  const { workoutFromText, exerciseName, formatExercise } = await import('../keepsake/src/shared/kinds.js');
  // Written for this test in the shape such captions take (not copied from a post).
  const caption = 'Sam on Instagram: "STRONGER BACK WITH ONE DUMBBELL 💪 Four moves for your upper back and grip. Exercises: 1. DB Bent-Over Row 2. DB Pullover 3. Renegade Row 4. DB Shrug Do it like this: ✅ 4 sets ✅ 10–15 reps per exercise ✅ 60–90 sec rest ✅ Control every rep #backworkout #homeworkout"';
  const w = workoutFromText(caption);
  assert.deepEqual(w.exercises.map((e) => [e.name, e.sets, e.reps, e.repsMax, e.restSeconds, e.restMaxSeconds]), [
    ['DB Bent-Over Row', 4, 10, 15, 60, 90], ['DB Pullover', 4, 10, 15, 60, 90], ['Renegade Row', 4, 10, 15, 60, 90], ['DB Shrug', 4, 10, 15, 60, 90],
  ], 'ranges kept as the creator wrote them');
  assert.equal(formatExercise(w.exercises[0]), 'DB Bent-Over Row 4×10–15 rest 60–90s');
  const { parseExerciseLine } = await import('../keepsake/src/shared/kinds.js');
  const back = parseExerciseLine('DB Bent-Over Row 4×10–15');
  assert.deepEqual([back.sets, back.reps, back.repsMax], [4, 10, 15], 'and read back the same from Edit details');
  // A numbered list of names with no numbers at all, under "Exercises:", is still a workout.
  const bare = workoutFromText('Mobility routine\nExercises:\nCat-cow\nWorld’s greatest stretch\nHip circles');
  assert.deepEqual(bare.exercises.map((e) => [e.name, e.sets, e.reps]), [['Cat-cow', null, null], ['World’s greatest stretch', null, null], ['Hip circles', null, null]]);
  // Without a heading or shared numbers, a numbered list of words is not.
  assert.equal(workoutFromText('My week\n1. Monday rest\n2. Groceries\n3. Laundry'), null);
  assert.equal(exerciseName('Comment PLAN: I’ll send it'), null);
  assert.equal(formatExercise({ name: 'Cat-cow' }), 'Cat-cow');
});

test('workouts: check-mark bullets with muscles in brackets, numbers in sentences, Instagram quote marks', async () => {
  const { workoutFromText, parseExerciseLine, formatExercise } = await import('../keepsake/src/shared/kinds.js');
  // Written for this test in the shape of an Instagram description (likes, handle, quoted caption, full stop).
  const desc = '120 likes, 3 comments - coach_example on October 2, 2026: "✅ goblet squats (Quads, glutes) ✅ kettlebell swings (Hamstrings, grip) ✅ halos (Shoulders) Give these a go on leg day! 12 reps each. Short rest between rounds. 3 total rounds 💪🏽 #kettlebellworkout #legday".';
  const w = workoutFromText(desc);
  assert.deepEqual(w.exercises.map((e) => [e.name, e.note, e.sets, e.reps]), [
    ['Goblet squats', 'Quads, glutes', 3, 12], ['Kettlebell swings', 'Hamstrings, grip', 3, 12], ['Halos', 'Shoulders', 3, 12],
  ]);
  assert.equal(formatExercise(w.exercises[0]), 'Goblet squats (Quads, glutes) 3×12');
  assert.deepEqual(parseExerciseLine('Goblet squats (Quads, glutes) 3×12'), { name: 'Goblet squats', sets: 3, reps: 12, durationSeconds: null, restSeconds: null, note: 'Quads, glutes' }, 'read back from Edit details');
  // Tips under "Do it like this:" are not exercises, and the workout's own title is not one either.
  const t = workoutFromText('20 min HIIT workout 🔥\nExercises:\nBurpees\nSquat jumps\nDo it like this:\n✅ 4 rounds\n✅ Control every rep\n✅ Breathe out on the way up');
  assert.deepEqual(t.exercises.map((e) => [e.name, e.sets]), [['Burpees', 4], ['Squat jumps', 4]]);
});

test('places: schema.org restaurant, opening hours, maps links read from the link itself', async () => {
  const { placeFromSchema, placeFromMapsUrl, hoursFrom, mapsLinks, addressLine } = await import('../keepsake/src/shared/kinds.js');
  const p = placeFromSchema({ '@type': ['Restaurant'], address: { streetAddress: '12 Mill Lane', addressLocality: 'Bristol', postalCode: 'BS1 4XX', addressCountry: { name: 'United Kingdom' } },
    geo: { latitude: '51.4545', longitude: '-2.5879' }, servesCuisine: ['Georgian'], priceRange: '££', telephone: '+44 117 000 0000',
    openingHoursSpecification: [{ dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday'], opens: '17:00', closes: '22:00' }, { dayOfWeek: 'https://schema.org/Friday', opens: '17:00:00', closes: '23:00:00' }, { dayOfWeek: 'Saturday', opens: '17:00', closes: '23:00' }] });
  assert.equal(p.locality, 'Bristol');
  assert.equal(p.country, 'United Kingdom');
  assert.deepEqual([p.lat, p.lng], [51.4545, -2.5879]);
  assert.deepEqual(p.hours, ['Tue–Thu 17:00–22:00', 'Fri–Sat 17:00–23:00']);
  assert.equal(p.category, 'Restaurant');
  assert.equal(addressLine(p), '12 Mill Lane, Bristol, BS1 4XX, United Kingdom');
  assert.equal(placeFromSchema({ '@type': 'Restaurant', name: 'No address' }), null, 'a place needs an address or a pin');
  assert.deepEqual(hoursFrom(null, 'Mo-Fr 08:00-18:00, Sa 09:00-14:00'), ['Mon–Fri 08:00–18:00', 'Sat 09:00–14:00']);
  assert.deepEqual(hoursFrom([{ dayOfWeek: 'Sunday', opens: '00:00', closes: '23:59' }]), ['Sun Open 24 hours']);

  const g = placeFromMapsUrl('https://www.google.com/maps/place/Little+Kitchen/@51.4,-2.5,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d51.4551!4d-2.5911');
  assert.deepEqual([g.name, g.lat, g.lng, g.source], ['Little Kitchen', 51.4551, -2.5911, 'maps-link'], 'the place’s own pin, not the map centre');
  assert.deepEqual(placeFromMapsUrl('https://maps.apple.com/?q=Little%20Kitchen&ll=51.45,-2.59').name, 'Little Kitchen');
  assert.equal(placeFromMapsUrl('https://www.google.com/search?q=maps'), null);
  assert.equal(placeFromMapsUrl('https://shop.example/maps/place/x'), null);

  const links = mapsLinks('Little Kitchen', p);
  assert.equal(new URL(links.google).searchParams.get('query'), 'Little Kitchen, 12 Mill Lane, Bristol, BS1 4XX, United Kingdom');
  assert.equal(new URL(links.apple).searchParams.get('ll'), '51.4545,-2.5879');
  assert.equal(new URL(mapsLinks('', { lat: 1.5, lng: 2.5 }).google).searchParams.get('query'), '1.5,2.5', 'a pin alone');
  assert.equal(mapsLinks('', {}), null);

  const d = sanitizeDetails('place', { ...p, lat: 999, hours: ['x'.repeat(200)], source: 'evil' });
  assert.equal(d.lat, null);
  assert.equal(d.hours[0].length, 80);
  assert.equal(d.source, 'you');
  assert.equal(keyFact({ kind: 'place', details: p }), 'Bristol · Georgian · ££');
  assert.equal(kindFromSchemaTypes(['WebPage', 'Restaurant']), 'place');
});
