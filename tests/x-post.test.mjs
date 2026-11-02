// Posts on X shared from the X app: what xPost.js reads from X's embed data, and what the save becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xStatusId, isXPost, xPostUrl, xToken, xPostRequests, parseXPost, xTitle } from '../keepsake/src/shared/xPost.js';
import { createStore, memoryBackend, memoryRecordBackend } from '../keepsake/src/shared/storage.js';
import { saveCapture } from '../keepsake/src/shared/capture.js';
import { normalizeUrl } from '../keepsake/src/shared/url.js';
import { contextFor, pagesToRead } from '../keepsake/src/shared/understand.js';
import { genericTitle, isPostSave } from '../keepsake/src/shared/kinds.js';

const SHARED = 'https://x.com/miachen/status/1851234567890123456?s=46&t=AbCdEfGh';
const user = { screen_name: 'miachen', name: 'Mia Chen &amp; Co' };

// The shape cdn.syndication.twimg.com/tweet-result answers with (trimmed to what is read).
const tweet = (over = {}) => ({
  __typename: 'Tweet', id_str: '1851234567890123456', created_at: '2026-10-30T14:05:00.000Z', lang: 'en', user,
  display_text_range: [0, 999], entities: { hashtags: [], urls: [], media: [] }, ...over,
});

const recipeText = 'Brown butter pasta, 20 minutes\n\nIngredients\n- 350 g rigatoni\n- 90 g butter\n- 12 sage leaves\n- 40 g parmesan\n\nMethod\n1. Boil the pasta.\n2. Brown the butter with the sage.\n3. Toss with the pasta and parmesan. #pasta https://t.co/pic123';

test('the post id is read from every address X uses, and the link has no tracking', () => {
  for (const u of [SHARED, 'https://twitter.com/miachen/status/1851234567890123456', 'https://mobile.twitter.com/miachen/statuses/1851234567890123456/', 'https://x.com/i/status/1851234567890123456', 'https://x.com/i/web/status/1851234567890123456', 'https://www.x.com/miachen/status/1851234567890123456/photo/1']) {
    assert.equal(xStatusId(u), '1851234567890123456', u);
  }
  for (const u of ['https://x.com/miachen', 'https://x.com/home', 'https://example.com/a/status/1851234567890123456', 'https://x.com/search?q=status']) assert.equal(isXPost(u), false, u);
  assert.equal(xPostUrl(SHARED), 'https://x.com/miachen/status/1851234567890123456');
  // The same post at x.com, twitter.com, with or without the handle, is one save.
  assert.equal(normalizeUrl(SHARED), normalizeUrl('https://twitter.com/i/status/1851234567890123456'));
  assert.equal(normalizeUrl(SHARED), 'x.com/status/1851234567890123456');
});

test('the requests ask X for this post only, embed data first', () => {
  const r = xPostRequests(SHARED);
  assert.deepEqual(r.map((x) => new URL(x.url).hostname), ['cdn.syndication.twimg.com', 'publish.twitter.com']);
  assert.match(r[0].url, /id=1851234567890123456&/);
  assert.match(r[0].url, new RegExp(`token=${xToken('1851234567890123456')}$`));
  assert.match(xToken('20'), /^[0-9a-z]+$/);
  assert.deepEqual(xPostRequests('https://x.com/miachen'), []);
});

test('a text post: its words with links written out, creator, date and hashtags', () => {
  const p = parseXPost({ tweet: tweet({ text: 'Best ramen in the East Village is still Raku. Go early https://t.co/abc #ramen', entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://rakunyc.com/', display_url: 'rakunyc.com' }], hashtags: [] } }) }, SHARED);
  assert.equal(p.ok, true);
  assert.equal(p.text, 'Best ramen in the East Village is still Raku. Go early https://rakunyc.com/ #ramen');
  assert.equal(p.creator, 'miachen');
  assert.equal(p.name, 'Mia Chen & Co');
  assert.equal(p.postedAt, '2026-10-30T14:05:00.000Z');
  assert.deepEqual(p.hashtags, ['ramen']);
  assert.deepEqual(p.links, [{ url: 'https://rakunyc.com/', label: 'rakunyc.com' }]);
  assert.equal(p.title, 'Best ramen in the East Village is still Raku');
  assert.equal(p.type, 'post');
});

test('pictures and a video: every photo kept, the video poster as the picture', () => {
  const photos = parseXPost({ tweet: tweet({ text: 'Two looks https://t.co/pic', entities: { urls: [], media: [{ url: 'https://t.co/pic' }] }, mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' }, { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/b.jpg' }] }) }, SHARED);
  assert.equal(photos.text, 'Two looks');
  assert.deepEqual(photos.images, ['https://pbs.twimg.com/media/a.jpg', 'https://pbs.twimg.com/media/b.jpg']);
  assert.equal(photos.type, 'photo');
  const video = parseXPost({ tweet: tweet({ text: '10 minute mobility flow', mediaDetails: [{ type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg', video_info: { duration_millis: 61000, variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/v.m3u8' }, { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/lo.mp4' }, { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/hi.mp4' }] } }] }) }, SHARED);
  assert.equal(video.type, 'video');
  assert.equal(video.image, 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg');
  assert.equal(video.video.url, 'https://video.twimg.com/hi.mp4');
  assert.equal(video.video.seconds, 61);
});

test('a quote and a thread: the quoted post and the earlier post are part of what it says', () => {
  const quote = parseXPost({ tweet: tweet({ text: 'Making this tonight', quoted_tweet: { text: 'Miso butter salmon: 4 fillets, 2 tbsp white miso, 30 g butter', user: { screen_name: 'nytcooking', name: 'NYT Cooking' }, entities: { urls: [] } } }) }, SHARED);
  assert.match(quote.caption, /^Making this tonight\n\nQuoting @nytcooking: Miso butter salmon/);
  assert.equal(quote.thread, false);
  const thread = parseXPost({ tweet: tweet({ text: '2/ Then the cooldown: 5 min walk', parent: { text: '1/ Leg day: 4x8 squats, 3x10 lunges', user }, in_reply_to_screen_name: 'miachen' }) }, SHARED);
  assert.equal(thread.thread, true);
  assert.match(thread.caption, /Earlier in the thread: 1\/ Leg day/);
  const reply = parseXPost({ tweet: tweet({ text: 'Agreed', parent: { text: 'Raku is the best ramen', user: { screen_name: 'someone' } } }) }, SHARED);
  assert.equal(reply.thread, false);
  assert.match(reply.caption, /Replying to @someone: Raku/);
});

test('a long post reads its full text, and a link card names the page', () => {
  const long = 'A'.repeat(10) + ' ' + 'word '.repeat(80);
  const p = parseXPost({ tweet: tweet({ text: 'short version…', note_tweet: { note_tweet_results: { result: { text: long, entity_set: { urls: [] } } } }, card: { binding_values: { card_url: { string_value: 'https://www.seriouseats.com/pho' }, title: { string_value: 'Pho recipe' }, thumbnail_image_large: { image_value: { url: 'https://pbs.twimg.com/card/pho.jpg' } } } } }) }, SHARED);
  assert.equal(p.text, long.trim());
  assert.deepEqual(p.links, [{ url: 'https://www.seriouseats.com/pho', label: 'Pho recipe' }]);
  assert.equal(p.image, 'https://pbs.twimg.com/card/pho.jpg');
});

test('the oEmbed answer is enough when the embed data is missing; a removed post says nothing', () => {
  const oembed = { author_name: 'Mia Chen', author_url: 'https://twitter.com/miachen', html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Best croissant in Paris: Du Pain et des Idées <a href="https://twitter.com/hashtag/paris?src=hash">#paris</a> <a href="https://t.co/xyz">pic.twitter.com/xyz</a></p>&mdash; Mia Chen (@miachen) <a href="https://twitter.com/miachen/status/1851234567890123456?ref_src=twsrc%5Etfw">October 30, 2026</a></blockquote>\n' };
  const p = parseXPost({ tweet: { __typename: 'TweetTombstone' }, oembed }, SHARED);
  assert.equal(p.ok, true);
  assert.equal(p.text, 'Best croissant in Paris: Du Pain et des Idées #paris');
  assert.equal(p.creator, 'miachen');
  assert.equal(p.postedAt, 'October 30, 2026');
  assert.equal(p.source, 'oembed');
  assert.equal(parseXPost({ tweet: { __typename: 'TweetTombstone' } }, SHARED).ok, false);
  assert.equal(parseXPost({}, SHARED).ok, false);
});

test('a title is the first line that says something, else who posted it', () => {
  assert.equal(xTitle('🔥🔥\nThe only granola recipe you need. Seriously.'), 'The only granola recipe you need');
  assert.equal(xTitle('https://t.co/abc', 'miachen'), 'Post by @miachen on X');
  assert.equal(xTitle('', '', 'video'), 'Video on X');
  assert.equal(genericTitle('Mia Chen on X: "Best ramen" / X'), true);
  assert.equal(genericTitle('Post on X'), true);
});

const store = () => createStore(memoryBackend(), memoryRecordBackend());
const share = (bundle, url = SHARED) => ({ sparse: true, url, canonicalUrl: url, isXPost: true, xBundle: bundle });

test('a recipe posted on X saves as a Recipe with its ingredients, picture and post record', async () => {
  const s = store();
  const r = await saveCapture(s, share({ tweet: tweet({ text: recipeText, entities: { urls: [], media: [{ url: 'https://t.co/pic123' }] }, mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/pasta.jpg' }] }) }), { source: 'share-sheet', instant: true });
  const item = await s.getItem(r.item.id);
  assert.equal(item.kind, 'recipe');
  assert.ok(item.details.ingredients.length >= 4);
  assert.equal(item.title, 'Brown butter pasta, 20 minutes');
  assert.equal(item.image, 'https://pbs.twimg.com/media/pasta.jpg');
  assert.equal(item.retailer, 'X');
  assert.equal(item.url, 'https://x.com/miachen/status/1851234567890123456');
  assert.equal(item.instagram.creator, 'miachen');
  assert.equal(item.instagram.postType, 'x-post');
  assert.equal(isPostSave(item), true);
  // The same post shared again from twitter.com is a duplicate.
  const again = await saveCapture(s, share({}, 'https://twitter.com/i/status/1851234567890123456'), { source: 'share-sheet', instant: true });
  assert.equal(again.duplicate, true);
});

test('a place named with 📍 on X is a Place; a workout thread is a Workout', async () => {
  const s = store();
  const place = await saveCapture(s, share({ tweet: tweet({ text: 'Cutest bakery 🥐\n📍 Du Pain et des Idées, Paris' }) }), { source: 'share-sheet', instant: true });
  assert.equal(place.item.kind, 'place');
  const workout = await saveCapture(s, share({ tweet: tweet({ id_str: '1851234567890123999', text: '2/ Then finish strong: 3x12 lunges, 3x15 glute bridges, 60s plank', parent: { text: '1/ My leg day workout: 4x8 squats, 3x10 Romanian deadlifts', user } }) }, 'https://x.com/miachen/status/1851234567890123999'), { source: 'share-sheet', instant: true });
  assert.equal(workout.item.kind, 'workout');
  assert.equal(workout.item.instagram.postType, 'x-thread');
});

test('only the link (X did not answer): Review, named for what it is, saying why', async () => {
  const s = store();
  const r = await saveCapture(s, { sparse: true, url: SHARED, canonicalUrl: SHARED }, { source: 'share-sheet', instant: true });
  assert.equal(r.item.title, 'Post on X');
  assert.equal(r.item.kind, 'link');
  assert.equal(r.item.needsReview, true);
  assert.match(r.item.categorizationReason, /X didn’t share the post’s text/);
});

test('the AI reads the post: caption, creator, hashtags, and the page it links to', async () => {
  const s = store();
  const r = await saveCapture(s, share({ tweet: tweet({ text: 'This changed how I make pho https://t.co/l #pho', entities: { urls: [{ url: 'https://t.co/l', expanded_url: 'https://www.seriouseats.com/pho', display_url: 'seriouseats.com/pho' }] } }) }), { source: 'share-sheet', instant: true });
  const item = await s.getItem(r.item.id);
  const ctx = contextFor(item);
  assert.match(ctx.caption, /This changed how I make pho/);
  assert.equal(ctx.creator, 'miachen');
  assert.deepEqual(ctx.hashtags, ['pho']);
  assert.deepEqual(pagesToRead(item), ['https://www.seriouseats.com/pho']);
});

test('a post on X opened in Safari: X’s own page title is replaced by the post’s', async () => {
  const s = store();
  const r = await saveCapture(s, { url: SHARED, title: 'Mia Chen on X: "Best ramen in the East Village" / X', xBundle: { tweet: tweet({ text: 'Best ramen in the East Village is still Raku' }) } }, { source: 'share-sheet', instant: true });
  assert.equal(r.item.title, 'Best ramen in the East Village is still Raku');
});
