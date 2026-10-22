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

test('Instagram spacer lines are not steps', () => {
  const r = recipeFromText('Marshmallows\n\nIngredients:\n- 60g gelatin\n- 1/2 tsp salt\n\nInstructions:\n1. Bloom the gelatin\n2. Whisk until fluffy\n.\n.\n.\n⬇️\n#lowcalorierecipes');
  assert.deepEqual(r.steps, ['Bloom the gelatin', 'Whisk until fluffy']);
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

test('videos and articles: platform from the link, lengths, reading time, and an article with a video stays an article', async () => {
  const { videoPlatform, secondsFrom, formatDuration, videoFromCapture, articleFromCapture } = await import('../keepsake/src/shared/kinds.js');
  assert.equal(videoPlatform('https://www.youtube.com/watch?v=abc123'), 'YouTube');
  assert.equal(videoPlatform('https://m.youtube.com/shorts/abc123'), 'YouTube');
  assert.equal(videoPlatform('https://youtu.be/abc123xyz'), 'YouTube');
  assert.equal(videoPlatform('https://vimeo.com/76979871'), 'Vimeo');
  assert.equal(videoPlatform('https://www.youtube.com/@somechannel'), '', 'a channel page is not a video');
  assert.equal(videoPlatform('not a url'), '');
  assert.deepEqual([secondsFrom('PT1H2M3S'), secondsFrom('12:03'), secondsFrom('1:02:03'), secondsFrom(754), secondsFrom('754'), secondsFrom('soon')], [3723, 723, 3723, 754, 754, null]);
  assert.deepEqual([formatDuration(59), formatDuration(723), formatDuration(3723)], ['0:59', '12:03', '1:02:03']);
  assert.deepEqual(videoFromCapture({ duration: 'PT12M3S', channel: 'Example Channel', published: '2026-09-30T10:00:00Z' }, 'https://www.youtube.com/watch?v=x'),
    { durationSeconds: 723, channel: 'Example Channel', platform: 'YouTube', publishedOn: '2026-09-30', source: 'page' });
  const a = articleFromCapture({ author: 'A. Writer', wordCount: 1840, published: '2026-10-01', siteName: 'The Example' });
  assert.equal(a.readingMinutes, 8);
  assert.equal(articleFromCapture({ wordCount: 40 }).readingMinutes, 1, 'never 0 minutes');
  assert.equal(keyFact({ kind: 'article', details: a }), 'The Example · 8 min read');
  assert.equal(keyFact({ kind: 'video', details: { channel: 'Example Channel', durationSeconds: 723 } }), 'Example Channel · 12:03');
  assert.equal(kindFromSchemaTypes(['NewsArticle', 'VideoObject']), 'article');
  assert.equal(kindFromSchemaTypes(['VideoObject']), 'video');
  assert.equal(kindFromSchemaTypes(['Recipe', 'VideoObject']), 'recipe');
  assert.equal(sanitizeDetails('video', { durationSeconds: '12:03', publishedOn: 'yesterday', source: 'x' }).publishedOn, '');
  assert.equal(sanitizeDetails('video', { durationSeconds: '12:03' }).durationSeconds, 723);
});

test('topics: guessed from title, channel and description; whole words only; tags cleaned', async () => {
  const { guessTopics, cleanTopics } = await import('../keepsake/src/shared/topics.js');
  assert.deepEqual(guessTopics({ title: 'I Put Black Ops 3 Zombies in GTA 5 With One Prompt', channel: 'Better Stack' }), ['Video games', 'AI']);
  assert.deepEqual(guessTopics({ title: 'Nike Air Max 1 on feet review' }), ['Shoes']);
  assert.deepEqual(guessTopics({ title: 'Me at the zoo', channel: 'jawed' }), [], 'nothing to go on: no tags rather than a wrong one');
  assert.deepEqual(guessTopics({ title: 'The said waiter explains the main dish' }), [], '"ai" inside words never counts as AI');
  assert.deepEqual(guessTopics({ title: 'Weekend vlog', description: '', hashtags: ['#streetFood', 'ramen', '#sourdough'] }), ['Food & cooking'], 'hashtags count, camelCase split');
  assert.equal(guessTopics({ title: 'x', description: 'gaming gameplay speedrun' }).length, 1, 'several description hits add up');
  assert.deepEqual(cleanTopics(' AI, video games ,#Tech, ai, , Very long tag name that goes on and on and on'), ['AI', 'video games', 'Tech', 'Very long tag name that goes o']);
  assert.equal(cleanTopics(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 8);
  assert.deepEqual(makeItem({ url: 'https://a.example', topics: ['AI', 'ai', 'Tech'], topicsBy: 'nonsense' }).topics, ['AI', 'Tech']);
});

test('films, shows and books from schema.org; numbers and ISBNs checked', async () => {
  const { mediaFromSchema, bookFromSchema } = await import('../keepsake/src/shared/kinds.js');
  assert.deepEqual(mediaFromSchema({ '@type': 'Movie', datePublished: '2023-07-21', director: [{ '@type': 'Person', name: 'A. Director' }], duration: 'PT3H', genre: ['Drama', 'History'] }),
    { format: 'film', year: 2023, director: 'A. Director', runtimeMinutes: 180, seasons: null, genres: ['Drama', 'History'], source: 'page' });
  const s = mediaFromSchema({ '@type': 'TVSeries', startDate: '2008-01-20', creator: [{ name: 'A. Creator' }], numberOfSeasons: '5', duration: 'PT47M' });
  assert.deepEqual([s.format, s.year, s.director, s.seasons, s.runtimeMinutes], ['series', 2008, 'A. Creator', 5, null]);
  const b = bookFromSchema({ '@type': 'Book', author: [{ name: 'A. Author' }, { name: 'B. Author' }], numberOfPages: '387', isbn: '978-0-441-47812-5', datePublished: 'March 1969' });
  assert.deepEqual([b.author, b.year, b.pages, b.isbn], ['A. Author, B. Author', 1969, 387, '9780441478125']);
  assert.equal(bookFromSchema({ '@type': 'Book', isbn: '12345' }).isbn, '', 'not an ISBN');
  assert.equal(bookFromSchema({ '@type': 'Book', workExample: [{ numberOfPages: 212, isbn: '0441478123' }] }).pages, 212, 'from the edition');
  assert.equal(keyFact({ kind: 'media', details: s }), '2008 · Series · 5 seasons');
  assert.equal(keyFact({ kind: 'book', details: b }), 'A. Author, B. Author · 1969');
  assert.equal(sanitizeDetails('book', { year: 12, pages: -4, isbn: 'x' }).year, null);
});

test('search: every word must match; title beats note beats text; one typo forgiven', async () => {
  const { searchItems, editDistance, correctQuery, searchFields } = await import('../keepsake/src/shared/search.js');
  const items = [
    { id: 'a', title: 'Ceramic bedside lamp with linen shade', retailer: 'Studio Fenne', createdAt: '2026-01-01' },
    { id: 'b', title: 'Lemon tart', note: 'for the linen party', createdAt: '2026-01-02' },
    { id: 'c', title: 'Brass desk lamp', price: 89, createdAt: '2026-01-03' },
    { id: 'd', title: 'Leg day', details: { exercises: [{ name: 'Goblet squats' }] }, createdAt: '2026-01-04' },
    { id: 'e', title: 'Café crème', topics: ['Coffee'], createdAt: '2026-01-05' },
  ];
  const ids = (q) => searchItems(items, q).results.map((r) => r.item.id);
  assert.deepEqual(ids('linen'), ['a', 'b'], 'title before note');
  assert.deepEqual(ids('lamp linen'), ['a'], 'every word must match');
  assert.deepEqual(ids('squats'), ['d'], 'exercise names are searched');
  assert.deepEqual(ids('cafe creme'), ['e'], 'accents ignored');
  assert.deepEqual(ids('coffee'), ['e'], 'tags');
  assert.deepEqual(ids('89'), ['c'], 'prices');
  const fixed = searchItems(items, 'linnen lamp');
  assert.deepEqual([fixed.query, fixed.corrected, fixed.results.map((r) => r.item.id)], ['linen lamp', true, ['a']]);
  assert.equal(searchItems(items, 'zzzz').results.length, 0);
  assert.equal(editDistance('linnen', 'linen'), 1);
  assert.equal(editDistance('lmap', 'lamp'), 1, 'a swap is one edit');
  assert.equal(correctQuery('cat', [searchFields({ title: 'car' })]), null, 'short words are never "corrected"');
});

test('film and book sites: a title page is a film/show or a book; home, lists and reviews are not', async () => {
  const { titleSite } = await import('../keepsake/src/shared/kinds.js');
  const yes = {
    'https://letterboxd.com/film/the-matrix/': ['media', ''],
    'https://www.imdb.com/title/tt0133093/': ['media', ''],
    'https://m.imdb.com/title/tt0903747': ['media', ''],
    'https://www.rottentomatoes.com/m/the_matrix': ['media', 'film'],
    'https://www.rottentomatoes.com/tv/severance/s02': ['media', 'series'],
    'https://www.themoviedb.org/movie/603-the-matrix': ['media', 'film'],
    'https://www.themoviedb.org/tv/95396-severance': ['media', 'series'],
    'https://www.justwatch.com/us/movie/the-matrix': ['media', 'film'],
    'https://www.justwatch.com/uk/tv-show/severance': ['media', 'series'],
    'https://trakt.tv/shows/severance': ['media', 'series'],
    'https://www.goodreads.com/book/show/13642.A_Wizard_of_Earthsea': ['book', ''],
    'https://app.thestorygraph.com/books/0a1b2c3d': ['book', ''],
    'https://openlibrary.org/works/OL59863W/A_Wizard_of_Earthsea': ['book', ''],
    'https://hardcover.app/books/a-wizard-of-earthsea': ['book', ''],
  };
  for (const [url, [kind, format]] of Object.entries(yes)) assert.deepEqual(titleSite(url), { kind, format }, url);
  for (const url of ['https://letterboxd.com/', 'https://letterboxd.com/film/the-matrix/reviews/', 'https://letterboxd.com/someone/list/favourites/', 'https://www.imdb.com/chart/top/',
    'https://www.goodreads.com/review/list/1', 'https://www.goodreads.com/', 'https://shop.example/film/x', 'nonsense']) assert.equal(titleSite(url), null, url);
});

test('places from captions: "📍 Name" with the address on the next line, or glued on when line breaks are lost', async () => {
  const { placeFromText, detailsForKind } = await import('../keepsake/src/shared/kinds.js');
  // In the shape of a real NYC food post (wording written for the test).
  const cap = '🚨 New spot alert 🚨 Example Donuts just opened in NYC 🍩\n\n🍩 What I tried:\n🍩 Pink\n🍩 Glazed\n\n📍 Example Donuts\n186 Bleecker St, New York, NY';
  const want = { name: 'Example Donuts', address: '186 Bleecker St', locality: 'New York', region: 'NY' };
  assert.deepEqual(placeFromText(cap), want);
  assert.deepEqual(placeFromText(cap.replace(/\s+/g, ' ')), want);
  assert.deepEqual(placeFromText('📍 Example Donuts, 186 Bleecker St, New York, NY'), want);
  assert.equal(placeFromText('🍩 Pink\n🍩 Glazed'), null, 'food emoji lines are not places');
  const d = detailsForKind('place', { title: 'Instagram', instagram: { caption: cap }, url: 'https://www.instagram.com/reel/abc/' });
  assert.deepEqual([d.title, d.details.address, d.details.locality, d.details.region], ['Example Donuts', '186 Bleecker St', 'New York', 'NY']);
});

test('places: an "Address:" line is the address, never the name; the place’s @handle nearby names it', async () => {
  const { placeFromText, detailsForKind, nameFromHandle } = await import('../keepsake/src/shared/kinds.js');
  const cap = 'NYC’s newest viral donuts! @example_nyc\nAddress: 23 Cleveland Place, New York, NY\n.\n.\n.\n#newyork #nyc';
  const want = { name: 'Example NYC', address: '23 Cleveland Place', locality: 'New York', region: 'NY', handle: 'example_nyc' };
  assert.deepEqual(placeFromText(cap), want);
  assert.deepEqual(placeFromText(cap.replace(/\s+/g, ' ')), want, 'line breaks lost: the same');
  assert.deepEqual(placeFromText('Address: 23 Cleveland Place, New York, NY'), { name: '', address: '23 Cleveland Place', locality: 'New York', region: 'NY' });
  const d = detailsForKind('place', { title: 'Instagram', instagram: { caption: 'Address: 23 Cleveland Place, New York, NY', creator: 'someone' } });
  assert.deepEqual([d.title, d.details.address], ['23 Cleveland Place', '23 Cleveland Place'], 'no name: the address stands in as the title');
  assert.equal(nameFromHandle('joes.pizza'), 'Joes Pizza');
});

test('maps search links with the address in them: name, street, city and state', async () => {
  const { placeFromMapsUrl } = await import('../keepsake/src/shared/kinds.js');
  const p = placeFromMapsUrl('https://www.google.com/maps/search/?api=1&query=Example+Doughnuts+2124+5th+Ave+Seattle+WA');
  assert.deepEqual([p.name, p.address, p.locality, p.region], ['Example Doughnuts', '2124 5th Ave', 'Seattle', 'WA']);
  const q = placeFromMapsUrl("https://www.google.com/maps/search/?api=1&query=Ken%27s+Bakery%2C+338+NW+21st+Ave%2C+Portland%2C+OR+97209");
  assert.deepEqual([q.name, q.address, q.locality, q.region], ["Ken's Bakery", '338 NW 21st Ave', 'Portland', 'OR']);
  assert.equal(placeFromMapsUrl('https://www.google.com/maps/search/?api=1&query=pizza+near+me').address, '', 'no address: just the search');
});

test('addressFromLine: a street with its city run on, an address with the country, or an area alone', async () => {
  const { addressFromLine } = await import('../keepsake/src/shared/kinds.js');
  assert.deepEqual(addressFromLine('2309 2nd avenue New York, NY 10035'), { address: '2309 2nd avenue', locality: 'New York', region: 'NY', postalCode: '10035', country: '' });
  assert.deepEqual(addressFromLine('19 East Main Street, Rexburg, ID, United States, Idaho'), { address: '19 East Main Street', locality: 'Rexburg', region: 'ID', postalCode: '', country: 'United States' });
  assert.deepEqual(addressFromLine('Oklahoma City, OK, United States, Oklahoma'), { address: '', locality: 'Oklahoma City', region: 'OK', postalCode: '', country: 'United States' });
  assert.equal(addressFromLine('21 St Marks Pl, New York, NY').address, '21 St Marks Pl');
  assert.equal(addressFromLine('Hand-Cut Donuts'), null);
  assert.equal(addressFromLine('Peanut & Tree Nut-Free | Vegan Options'), null);
});

test('placeFromProfile: business profiles are places (name, address or area); bloggers and bands are not', async () => {
  const { placeFromProfile } = await import('../keepsake/src/shared/kinds.js');
  const pub = placeFromProfile({ platform: 'instagram', handle: 'thedonutpub', name: 'The Donut Pub NYC', bio: 'Hand-Cut Donuts\nOpen 24/7 Since 1964' });
  assert.deepEqual([pub.name, pub.address, pub.locality], ['The Donut Pub NYC', '', ''], 'nothing guessed');
  assert.equal(placeFromProfile({ platform: 'instagram', handle: 'imdonut.nyc', name: '', bio: 'Handmade daily in Times Square 🍩 donuts\nOpen: Sunday-Wednesday 10 am-10 pm' }).name, 'Imdonut NYC', 'named from its handle');
  assert.equal(placeFromProfile({ platform: 'instagram', handle: 'nyceats', name: 'NYC Eats', bio: 'NYC food reviews 🍕 Open to collabs\nBest donuts daily' }), null);
  assert.equal(placeFromProfile({ platform: 'instagram', handle: 'jane', name: 'Jane', bio: 'Mom of 2. Coffee lover.' }), null);
  const rise = placeFromProfile({ platform: 'facebook', handle: 'riseokc', name: 'Rise Bakery', about: 'Rise Bakery, Oklahoma City. 294 followers.', intro: ['Page · Entrepreneur', 'Oklahoma City, OK, United States, Oklahoma', '(405) 201-3982'] });
  assert.deepEqual([rise.name, rise.locality, rise.region, rise.phone], ['Rise Bakery', 'Oklahoma City', 'OK', '(405) 201-3982']);
  const chain = placeFromProfile({ platform: 'facebook', handle: 'chain', name: 'Example Rolls', about: '40,713 followers', intro: ['100% plant-based bakery', 'Page · Brand', 'Price Range · $$', '96% recommend (47 reviews)'] });
  assert.deepEqual([chain.name, chain.locality], ['Example Rolls', '']);
  assert.equal(placeFromProfile({ platform: 'facebook', handle: 'band', name: 'A Band', about: '', intro: ['Page · Musician/band'] }), null);
});

test('placeFromHome: says what it is (a bakery, a skate shop) and where (a city, a phone, a locations link)', async () => {
  const { placeFromHome } = await import('../keepsake/src/shared/kinds.js');
  assert.deepEqual(placeFromHome({ name: "Ken's Example", about: "<p>Ken's Example Bakery | Portland, Oregon</p>", siteName: '', title: '', phone: '', visitLink: false }),
    { name: "Ken's Example", address: '', locality: 'Portland', region: 'Oregon', postalCode: '', phone: '', source: 'page' });
  assert.equal(placeFromHome({ name: '', about: 'Voted best skate shop', siteName: 'EXAMPLEWELL - Los Feliz', title: '', phone: '323.555.3028', visitLink: false }).name, 'EXAMPLEWELL');
  assert.equal(placeFromHome({ name: 'Example Donuts', about: 'Organic donut shop', siteName: '', title: '', phone: '', visitLink: false }), null, 'no city, phone or locations link');
  assert.equal(placeFromHome({ name: 'Example Shoes', about: 'Shoes made from wool', siteName: '', title: '', phone: '', visitLink: true }), null, 'a brand');
});

test('kindForCollectionName: an Instagram collection named for a Lifestyle view goes there', async () => {
  const { kindForCollectionName } = await import('../keepsake/src/shared/kinds.js');
  assert.deepEqual(['Restaurant', 'Restaurants', 'NYC eats', 'Coffee shops', 'Date night', 'Brunch recipes', 'Workouts', 'Movies to watch', 'Home decor', 'Outfits', 'All posts'].map(kindForCollectionName),
    ['place', 'place', 'place', 'place', 'place', 'recipe', 'workout', 'media', null, null, null]);
});

test('placeFromPost: the caption names the place, the location tag gives its street, city and pin; a city-only tag is the area', async () => {
  const { placeFromPost } = await import('../keepsake/src/shared/kinds.js');
  const tag = { name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', lat: 40.7305, lng: -74.0021 };
  const a = placeFromPost({ caption: 'Best slice', location: 'Example Pizza', place: tag });
  assert.deepEqual([a.name, a.details.address, a.details.locality, a.details.region, a.details.lat], ['Example Pizza', '7 Carmine St', 'New York', 'New York', 40.7305]);
  const b = placeFromPost({ caption: '📍 Other Place, SoHo', location: 'Example Pizza', place: tag });
  assert.deepEqual([b.name, b.details.locality, b.details.address, b.details.lat], ['Other Place', 'SoHo', '', null], 'another place’s tag is not used');
  const c = placeFromPost({ caption: 'so good', location: 'Brooklyn, New York' });
  assert.deepEqual([c.name, c.details.locality, c.details.region], ['', 'Brooklyn', 'New York']);
  assert.equal(placeFromPost({ caption: 'yum' }), null);
});

test('moving an imported Instagram post into Places: named from its location tag, with the tag’s street, city and pin', async () => {
  const { kindChangePatch } = await import('../keepsake/src/shared/kinds.js');
  const post = { type: 'instagram', kind: 'link', title: 'Best slice in the city', url: 'https://www.instagram.com/p/MOVE1/',
    instagram: { caption: 'Best slice in the city', location: 'Example Pizza', place: { name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', lat: 40.7305, lng: -74.0021 } } };
  const p = kindChangePatch(post, 'place');
  assert.deepEqual([p.kind, p.title, p.details.address, p.details.locality, p.details.lat, p.details.lng], ['place', 'Example Pizza', '7 Carmine St', 'New York', 40.7305, -74.0021]);
  assert.equal(kindChangePatch({ ...post, userFields: ['title'] }, 'place').title, undefined, 'a title you wrote stays');
  const noTag = kindChangePatch({ ...post, instagram: { caption: 'Best slice in the city' } }, 'place');
  assert.equal(noTag.title, undefined, 'nothing names it: the caption title stays until AI names it');
});

test('tidyStreet: a number written after the street, or with a slash, is put where it belongs', async () => {
  const { tidyStreet, sanitizeDetails } = await import('../keepsake/src/shared/kinds.js');
  assert.deepEqual(['Rogers Ave, 570', '108/ San Pedro St.', '23 Cleveland Place', 'Suite 4, 12'].map(tidyStreet), ['570 Rogers Ave', '108 San Pedro St.', '23 Cleveland Place', 'Suite 4, 12']);
  assert.deepEqual(sanitizeDetails('place', { lookup: { source: 'OpenStreetMap', url: 'https://www.openstreetmap.org/way/9', approximate: true } }).lookup, { source: 'OpenStreetMap', url: 'https://www.openstreetmap.org/way/9', approximate: true });
});

// Instagram workouts (owner's saves, 2026-10-16): a routine with no ingredient heading, and reels whose
// routine is only in the video.
test('Instagram: a listed kettlebell complex is a workout, not a recipe', async () => {
  const { kindOfCapture } = await import('../keepsake/src/shared/capture.js');
  const { workoutFromText } = await import('../keepsake/src/shared/kinds.js');
  const caption = 'Try this simple upper-body kettlebell complex.\n\nAll you need is one kettlebell.\n\n10 Upright Rows\n10 Horn Curls\n10 Tricep Extensions\n10 Weighted Presses — Right\n10 Weighted Presses — Left\n10 Weighted Curls\n\nRest for 1 minute.\n\nRepeat for 5–6 rounds.';
  assert.equal(kindOfCapture({ isInstagram: true, title: 'Instagram', description: caption, url: 'https://www.instagram.com/reel/abc12/' }), 'workout');
  const w = workoutFromText(caption);
  assert.deepEqual(w.exercises.map((e) => e.name), ['Upright Rows', 'Horn Curls', 'Tricep Extensions', 'Weighted Presses — Right', 'Weighted Presses — Left', 'Weighted Curls']);
  assert.equal(w.exercises[0].sets, 5);
  assert.equal(w.exercises[5].restSeconds, 60);
});

test('Instagram: a routine that is only in the video is still a workout, with no exercises made up', async () => {
  const { kindOfCapture } = await import('../keepsake/src/shared/capture.js');
  const { detailsForKind } = await import('../keepsake/src/shared/kinds.js');
  const ig = (description) => ({ isInstagram: true, title: 'Instagram', description, url: 'https://www.instagram.com/reel/abc12/' });
  for (const caption of [
    'Meet the GORILLA LOADER. 🦍\nSquat → clean → curl → press.\n10 minutes. At home.\n\n#Kettlebell #homeworkout #hometraining',
    'Yoga routine for men who are sitting at a desk all day 🤍✨',
    'THE SIMPLEST BRUTAL ROUTINE YOU CAN DO.\n\n1 kettlebell.\n1 rep each side — as shown in the video.\n60 seconds NON-STOP.\nRest 30 seconds.\nRepeat for 5–6 rounds.',
  ]) {
    assert.equal(kindOfCapture(ig(caption)), 'workout', caption.slice(0, 30));
    assert.deepEqual(detailsForKind('workout', { ...ig(caption), kind: 'link', details: {} }).details.exercises, []);
  }
});

test('Instagram: recipes and other posts with a workout word stay what they are', async () => {
  const { kindOfCapture } = await import('../keepsake/src/shared/capture.js');
  const ig = (description) => ({ isInstagram: true, title: 'Instagram', description, url: 'https://www.instagram.com/reel/abc12/' });
  assert.equal(kindOfCapture(ig('Marshmallows\n\nIngredients:\n- 60g gelatin\n- 400g allulose\n\nInstructions:\n1. Bloom\n2. Fridge until it sets')), 'recipe');
  assert.equal(kindOfCapture(ig('High protein oats 💪 #fitness #gym\n1 cup oats\n2 scoops protein\n1 cup milk\n1 tbsp honey')), 'recipe');
  assert.equal(kindOfCapture(ig('My morning routine ☕️ slow mornings only')), 'link');
});
