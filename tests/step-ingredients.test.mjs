import test from 'node:test';
import assert from 'node:assert/strict';
import { stepIngredients, splitIngredient } from '../keepsake/src/shared/stepIngredients.js';

const carbonara = stepIngredients(
  ['Cook the guanciale slowly until crisp; keep the fat.', 'Whisk the yolks, egg and pecorino with lots of pepper.',
    'Boil the spaghetti in salted water until just al dente.',
    'Toss the pasta in the pan off the heat, then stir in the egg mix with a splash of pasta water until glossy.'],
  ['200 g spaghetti', '100 g guanciale', '3 egg yolks', '1 whole egg', '50 g pecorino romano, grated', 'Black pepper'],
);

test('ingredient lines split into amount and name', () => {
  assert.deepEqual(splitIngredient('200 g spaghetti'), { amount: '200 g', name: 'spaghetti' });
  assert.deepEqual(splitIngredient('3 cloves garlic'), { amount: '3 cloves', name: 'garlic' });
  assert.deepEqual(splitIngredient('Pinch of salt'), { amount: 'Pinch', name: 'salt' });
  assert.deepEqual(splitIngredient('Black pepper'), { amount: '', name: 'Black pepper' });
  assert.deepEqual(splitIngredient('1 onion, sliced'), { amount: '1', name: 'onion, sliced' });
  assert.deepEqual(splitIngredient('2 portions fresh ramen noodles'), { amount: '2 portions', name: 'fresh ramen noodles' });
  assert.deepEqual(splitIngredient('½ tsp salt'), { amount: '½ tsp', name: 'salt' });
  assert.deepEqual(splitIngredient('250g flour'), { amount: '250g', name: 'flour' });
  assert.deepEqual(splitIngredient('1 cup (150 g) fine cornmeal (fubá)'), { amount: '1 cup (150 g)', name: 'fine cornmeal (fubá)' });
  assert.deepEqual(splitIngredient('(395 g) sweetened condensed milk'), { amount: '(395 g)', name: 'sweetened condensed milk' });
});

test('each step gets the ingredients it names', () => {
  assert.deepEqual(carbonara.steps.map((s) => s.items), [[1], [2, 3, 4, 5], [0], []]);
  assert.deepEqual(carbonara.unmatched, []);
});

test('later steps carry earlier ones', () => {
  assert.deepEqual(carbonara.steps[3].carried, [{ fromStep: 2, items: [0] }, { fromStep: 1, items: [2, 3] }]);
});

test('group words, and ingredients no step names', () => {
  const s = stepIngredients(['Boil the pasta.', 'Add garlic and spices.', 'Toss.'], ['350 g rigatoni', '3 cloves garlic', '1 tsp cumin', '12 sage leaves']);
  assert.deepEqual(s.steps.map((x) => x.items), [[0], [1, 2], []]);
  assert.deepEqual(s.unmatched, [3]);
});

test('highlights mark the words that name an ingredient', () => {
  const text = 'Whisk the yolks, egg and pecorino with lots of pepper.';
  assert.deepEqual(carbonara.highlights(text, 1).map((r) => text.slice(r.start, r.end)), ['yolks', 'egg', 'pecorino', 'pepper']);
});
