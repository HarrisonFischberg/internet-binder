// Links shared from other apps (TikTok, YouTube, Reddit, Bluesky, Pinterest, Threads, Facebook, Vimeo,
// Spotify, any page): what linkReader.js asks for, what it reads, and what the save becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSite, canReadLink, linkRequests, linkFollowUp, parseLink, mergeLinkRead, pageFacts, jsonAfter, junkTitle, resolvedUrl } from '../keepsake/src/shared/linkReader.js';
import { createStore, memoryBackend, memoryRecordBackend } from '../keepsake/src/shared/storage.js';
import { saveCapture } from '../keepsake/src/shared/capture.js';
import { normalizeUrl } from '../keepsake/src/shared/url.js';
import { isPostSave } from '../keepsake/src/shared/kinds.js';

const store = () => createStore(memoryBackend(), memoryRecordBackend());
const save = async (product) => (await saveCapture(store(), product)).item;
const hosts = (reqs) => reqs.map((r) => new URL(r.url).hostname);

test('every app’s link is known by its site, with the post’s id', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc', { site: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?si=xyz', { site: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtube.com/shorts/dQw4w9WgXcQ?feature=share', { site: 'youtube', id: 'dQw4w9WgXcQ', short: true }],
    ['https://m.youtube.com/live/dQw4w9WgXcQ', { site: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', { site: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://www.tiktok.com/@chef.mia/video/7301234567890123456?is_from_webapp=1', { site: 'tiktok', id: '7301234567890123456', handle: 'chef.mia' }],
    ['https://www.tiktok.com/@chef.mia/photo/7301234567890123456', { site: 'tiktok', id: '7301234567890123456', photo: true }],
    ['https://vm.tiktok.com/ZMabc123/', { site: 'tiktok', short: true }],
    ['https://www.tiktok.com/t/ZTabc123/', { site: 'tiktok', short: true }],
    ['https://www.reddit.com/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/?share_id=x', { site: 'reddit', id: '1g2h3j4', sub: 'Cooking' }],
    ['https://old.reddit.com/r/Cooking/comments/1G2H3J4/', { site: 'reddit', id: '1g2h3j4' }],
    ['https://redd.it/1g2h3j4', { site: 'reddit', id: '1g2h3j4' }],
    ['https://www.reddit.com/r/Cooking/s/AbCdEf123', { site: 'reddit', short: true }],
    ['https://bsky.app/profile/mia.bsky.social/post/3l6oveex3ii2l', { site: 'bluesky', actor: 'mia.bsky.social', rkey: '3l6oveex3ii2l' }],
    ['https://www.pinterest.com/pin/123456789012345678/', { site: 'pinterest', id: '123456789012345678' }],
    ['https://pinterest.co.uk/pin/lemon-cake--123456789012345678/', { site: 'pinterest', id: '123456789012345678' }],
    ['https://pin.it/4AbCdEf', { site: 'pinterest', short: true }],
    ['https://vimeo.com/76979871', { site: 'vimeo' }],
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1', { site: 'spotify' }],
    ['https://spotify.link/AbCd', { site: 'spotify', short: true }],
    ['https://soundcloud.com/artist/track-name', { site: 'soundcloud' }],
    ['https://www.threads.net/@mia/post/C9abcdEFgh', { site: 'threads', handle: 'mia' }],
    ['https://www.threads.com/@mia/post/C9abcdEFgh', { site: 'threads' }],
    ['https://www.facebook.com/share/p/1AbCdEf/', { site: 'facebook', post: true }],
    ['https://www.facebook.com/somebakery', { site: 'facebook', post: false }],
    ['https://fb.watch/abc123/', { site: 'facebook', post: true }],
    ['https://www.linkedin.com/posts/mia_some-post-activity-123', { site: 'linkedin' }],
    ['https://www.seriouseats.com/lasagna', { site: 'page' }],
    ['https://www.youtube.com/@somechannel', { site: 'page' }],
    ['https://www.instagram.com/p/C0ffee123/', { site: 'instagram' }],
    ['https://x.com/mia/status/1851234567890123456', { site: 'x' }],
  ];
  for (const [url, want] of cases) {
    const got = linkSite(url);
    for (const [k, v] of Object.entries(want)) assert.equal(got?.[k], v, `${url} ${k}`);
  }
  assert.equal(linkSite('not a link'), null);
  assert.equal(linkSite('ftp://example.com/x'), null);
  assert.equal(canReadLink('https://www.instagram.com/p/C0ffee123/'), false);
  assert.equal(canReadLink('https://x.com/mia/status/1851234567890123456'), false);
  assert.equal(canReadLink('https://example.com/a'), true);
});

test('the requests ask each site only for the shared post, its public data first', () => {
  assert.deepEqual(hosts(linkRequests('https://youtu.be/dQw4w9WgXcQ')), ['www.youtube.com', 'www.youtube.com']);
  assert.match(linkRequests('https://youtu.be/dQw4w9WgXcQ')[0].url, /oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ/);
  assert.deepEqual(linkRequests('https://youtu.be/dQw4w9WgXcQ')[1].keep, ['ytInitialPlayerResponse']);
  assert.deepEqual(linkRequests('https://www.tiktok.com/@chef.mia/video/7301234567890123456').map((r) => r.key), ['oembed', 'page']);
  assert.deepEqual(linkRequests('https://vm.tiktok.com/ZMabc123/').map((r) => r.key), ['page']);
  const rd = linkRequests('https://www.reddit.com/r/Cooking/comments/1g2h3j4/x/');
  assert.equal(rd[0].url, 'https://www.reddit.com/comments/1g2h3j4/.json?raw_json=1&limit=12&depth=1&sort=top');
  // Reddit's oEmbed only takes the post's full address.
  assert.equal(rd[1].url, `https://www.reddit.com/oembed?url=${encodeURIComponent('https://www.reddit.com/r/Cooking/comments/1g2h3j4/x/')}`);
  assert.deepEqual(hosts(linkRequests('https://bsky.app/profile/mia.bsky.social/post/3l6oveex3ii2l')), ['public.api.bsky.app', 'embed.bsky.app']);
  assert.deepEqual(hosts(linkRequests('https://www.pinterest.com/pin/123456789012345678/')), ['widgets.pinterest.com', 'www.pinterest.com']);
  assert.deepEqual(hosts(linkRequests('https://vimeo.com/76979871')), ['vimeo.com']);
  assert.deepEqual(linkRequests('https://example.com/a').map((r) => [r.key, r.as, r.browser]), [['page', 'html', true]]);
  assert.deepEqual(linkRequests('https://www.instagram.com/p/C0ffee123/'), []);
  assert.deepEqual(linkRequests('https://x.com/mia/status/1851234567890123456'), []);
  // Every request is https and a plain GET with no secrets in it.
  for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://redd.it/1g2h3j4', 'https://pin.it/4AbCdEf', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC']) {
    for (const r of linkRequests(u)) assert.match(r.url, /^https:\/\//);
  }
});

// --- YouTube ----------------------------------------------------------------------------------------

const ytPage = (desc) => `<html><head><title>Brown butter pasta - YouTube</title><meta property="og:title" content="Brown butter pasta"></head><body>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"dQw4w9WgXcQ","title":"Brown Butter Pasta in 20 Minutes","lengthSeconds":"634","keywords":["pasta","dinner"],"shortDescription":${JSON.stringify(desc)},"author":"Mia Cooks"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-10-30T07:00:00-07:00","category":"Howto & Style","ownerProfileUrl":"http://www.youtube.com/@miacooks"}}};var meta = {"a":"}"};</script></body></html>`;
const ytRecipe = 'Dinner in 20 minutes.\n\nIngredients\n- 350 g rigatoni\n- 90 g butter\n- 12 sage leaves\n- 40 g parmesan\n\nMethod\n1. Boil the pasta.\n2. Brown the butter with the sage.\n3. Toss with the pasta and parmesan. #pasta\n\nMy knife: https://example.com/knife';

test('a YouTube video keeps its description, channel, length and date', async () => {
  const bundle = { oembed: { title: 'Brown Butter Pasta in 20 Minutes', author_name: 'Mia Cooks', author_url: 'https://www.youtube.com/@miacooks', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }, page: ytPage(ytRecipe) };
  const r = parseLink(bundle, 'https://youtu.be/dQw4w9WgXcQ?si=abc');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(r.title, 'Brown Butter Pasta in 20 Minutes');
  assert.equal(r.name, 'Mia Cooks');
  assert.equal(r.creator, 'miacooks');
  assert.equal(r.durationSeconds, 634);
  assert.equal(r.postedAt, '2026-10-30T14:00:00.000Z');
  assert.match(r.text, /350 g rigatoni/);
  assert.deepEqual(r.links, [{ url: 'https://example.com/knife', label: 'example.com/knife' }]);
  assert.deepEqual(r.hashtags, ['pasta']);
  // The share sheet gave only the link: the save is a video with its channel and length.
  const item = await save(mergeLinkRead({ url: 'https://youtu.be/dQw4w9WgXcQ?si=abc', sparse: true }, r));
  assert.equal(item.kind, 'video');
  assert.equal(item.title, 'Brown Butter Pasta in 20 Minutes');
  assert.match(item.description, /rigatoni/);
  assert.equal(item.details.channel, 'Mia Cooks');
  assert.equal(item.details.durationSeconds, 634);
  assert.equal(item.details.publishedOn, '2026-10-30');
  // Only the embed answered (the watch page asked for consent): still the title and channel.
  const thin = parseLink({ oembed: bundle.oembed }, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(thin.ok, true);
  assert.equal(thin.postType, 'youtube-short');
  assert.equal(thin.title, 'Brown Butter Pasta in 20 Minutes');
});

test('jsonAfter reads a script’s object with braces inside its strings', () => {
  assert.deepEqual(jsonAfter('x = {"a":"}{","b":{"c":1}}; y', 'x ='), { a: '}{', b: { c: 1 } });
  assert.deepEqual(jsonAfter('x = {"a":"\\"}"}', 'x ='), { a: '"}' });
  assert.equal(jsonAfter('nothing here', 'x ='), null);
  // YouTube's phone page sets it to null first and fills it in further down.
  assert.deepEqual(jsonAfter('var ytInitialPlayerResponse = null; … var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"hi"}};', 'ytInitialPlayerResponse'), { videoDetails: { shortDescription: 'hi' } });
  assert.equal(jsonAfter('x = {"broken": }', 'x ='), null);
});

// --- TikTok ----------------------------------------------------------------------------------------

const ttData = (item) => `<html><head><meta property="og:image" content="https://p16.tiktokcdn.com/og.jpg"><link rel="canonical" href="https://www.tiktok.com/@chef.mia/video/7301234567890123456"></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: item } } } })}</script></body></html>`;
const ttItem = {
  id: '7301234567890123456', desc: 'Best cacio e pepe in Rome 📍 Da Enzo al 29 #rome #pasta', createTime: '1730300000',
  author: { uniqueId: 'chef.mia', nickname: 'Mia 🍝' }, video: { duration: 42, cover: 'https://p16.tiktokcdn.com/cover.jpg' },
  music: { title: 'original sound', original: true }, textExtra: [{ hashtagName: 'rome' }, { hashtagName: 'pasta' }],
  poi: { name: 'Da Enzo al 29', address: 'Via dei Vascellari, 29', city: 'Rome', province: 'Lazio' },
};

test('a TikTok keeps its caption, creator, date, length and tagged place, and is filed by what it says', async () => {
  const bundle = { oembed: { title: ttItem.desc, author_name: 'Mia 🍝', author_unique_id: 'chef.mia', thumbnail_url: 'https://p16.tiktokcdn.com/thumb.jpg', embed_product_id: ttItem.id }, page: ttData(ttItem) };
  const r = parseLink(bundle, 'https://www.tiktok.com/@chef.mia/video/7301234567890123456?is_from_webapp=1&sender_device=pc');
  assert.equal(r.ok, true);
  assert.equal(r.post, true);
  assert.equal(r.url, 'https://www.tiktok.com/@chef.mia/video/7301234567890123456');
  assert.equal(r.creator, 'chef.mia');
  assert.equal(r.name, 'Mia 🍝');
  assert.equal(r.durationSeconds, 42);
  assert.equal(r.postedAt, new Date(1730300000 * 1000).toISOString());
  assert.equal(r.location, 'Da Enzo al 29');
  assert.equal(r.place.city, 'Rome');
  assert.deepEqual(r.hashtags, ['rome', 'pasta']);
  assert.equal(r.title, 'Best cacio e pepe in Rome 📍 Da Enzo al 29');
  const item = await save(mergeLinkRead({ url: 'https://www.tiktok.com/@chef.mia/video/7301234567890123456?is_from_webapp=1', title: 'TikTok - Make Your Day', sparse: true }, r));
  assert.equal(item.kind, 'place');
  assert.equal(item.title.includes('TikTok - Make Your Day'), false);
  assert.equal(item.instagram.creator, 'chef.mia');
  assert.equal(item.instagram.postType, 'tiktok');
  assert.equal(isPostSave(item), true);
  // A TikTok that isn't a recipe, workout or place is still a video, as before.
  const plain = parseLink({ oembed: { title: 'my cat vs the vacuum', author_unique_id: 'catdad' } }, 'https://www.tiktok.com/@catdad/video/7301234567890123499');
  assert.equal((await save(mergeLinkRead({ url: 'https://www.tiktok.com/@catdad/video/7301234567890123499', sparse: true }, plain))).kind, 'video');
});

test('a short TikTok link is followed to the video, then its embed is asked for', () => {
  const page = ttData(ttItem);
  const next = linkFollowUp('https://vm.tiktok.com/ZMabc123/', { page });
  assert.equal(next.url, 'https://www.tiktok.com/@chef.mia/video/7301234567890123456');
  assert.deepEqual(next.requests.map((r) => r.key), ['oembed']);
  const r = parseLink({ page, resolvedUrl: next.url }, 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(r.url, 'https://www.tiktok.com/@chef.mia/video/7301234567890123456');
  assert.equal(r.text, ttItem.desc);
  // A page that points nowhere useful: nothing more is asked.
  assert.deepEqual(linkFollowUp('https://vm.tiktok.com/ZMabc123/', { page: '<html><title>TikTok</title></html>' }).requests, []);
});

test('a TikTok photo post keeps its pictures', () => {
  const item = { ...ttItem, desc: 'outfit ideas', poi: null, imagePost: { title: 'Fall layers', images: [{ imageURL: { urlList: ['https://p16.tiktokcdn.com/1.jpg'] } }, { imageURL: { urlList: ['https://p16.tiktokcdn.com/2.jpg'] } }] } };
  const r = parseLink({ page: ttData(item) }, 'https://www.tiktok.com/@chef.mia/photo/7301234567890123456');
  assert.equal(r.postType, 'tiktok-photo');
  assert.deepEqual(r.images.slice(0, 2), ['https://p16.tiktokcdn.com/1.jpg', 'https://p16.tiktokcdn.com/2.jpg']);
  assert.equal(r.text, 'Fall layers\noutfit ideas');
});

// --- Reddit ----------------------------------------------------------------------------------------

const redditJson = (over = {}, comments = []) => [
  { data: { children: [{ kind: 't3', data: { id: '1g2h3j4', title: 'My grandma’s lasagna, finally written down', selftext: '', author: 'pastaqueen', subreddit: 'Cooking', created_utc: 1730300000, permalink: '/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/', url: 'https://i.redd.it/abc.jpg', is_self: false, preview: { images: [{ source: { url: 'https://preview.redd.it/abc.jpg?width=1080' } }] }, link_flair_text: 'Recipe', ...over } }] } },
  { data: { children: comments.map((c) => ({ kind: 't1', data: c })) } },
];

test('a Reddit post keeps its title, text, subreddit, picture and the poster’s own recipe comment', async () => {
  const comments = [
    { author: 'someone', body: 'Looks amazing!' },
    { author: 'pastaqueen', body: 'Recipe:\n\nIngredients\n- 500 g ricotta\n- 12 lasagna sheets\n- 700 g passata\n- 250 g mozzarella\n\nMethod\n1. Layer it.\n2. Bake 45 minutes at 190°C.' },
  ];
  const r = parseLink({ post: redditJson({}, comments) }, 'https://www.reddit.com/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/?share_id=abc&utm_source=share');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://www.reddit.com/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/');
  assert.equal(r.title, 'My grandma’s lasagna, finally written down');
  assert.equal(r.creator, 'pastaqueen');
  assert.match(r.text, /Comment by the poster: Recipe:/);
  assert.doesNotMatch(r.text, /Looks amazing/);
  assert.match(r.text, /Posted in r\/Cooking \(Recipe\)$/);
  assert.equal(r.image, 'https://preview.redd.it/abc.jpg?width=1080');
  const item = await save(mergeLinkRead({ url: 'https://www.reddit.com/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/?share_id=abc', sparse: true }, r));
  assert.equal(item.kind, 'recipe');
  assert.ok(item.details.ingredients.some((i) => /ricotta/.test(typeof i === 'string' ? i : i.text || i.name || JSON.stringify(i))));
  assert.equal(item.instagram.postType, 'reddit');
});

test('a Reddit link post keeps where it links; a gallery keeps every picture', () => {
  const link = parseLink({ post: redditJson({ url: 'https://www.nytimes.com/2026/10/30/dining/lasagna.html', domain: 'nytimes.com', is_self: false, preview: null }) }, 'https://redd.it/1g2h3j4');
  assert.deepEqual(link.links, [{ url: 'https://www.nytimes.com/2026/10/30/dining/lasagna.html', label: 'nytimes.com' }]);
  const gallery = parseLink({ post: redditJson({ url: 'https://www.reddit.com/gallery/1g2h3j4', preview: null, media_metadata: { a: { s: { u: 'https://preview.redd.it/a.jpg' } }, b: { s: { u: 'https://preview.redd.it/b.jpg' } } }, gallery_data: { items: [{ media_id: 'b' }, { media_id: 'a' }] } }) }, 'https://redd.it/1g2h3j4');
  assert.deepEqual(gallery.images, ['https://preview.redd.it/b.jpg', 'https://preview.redd.it/a.jpg']);
});

test('Reddit blocked the data: the embed or the page still give the title', () => {
  const o = parseLink({ post: { error: 403 }, oembed: { title: 'Best ramen in Tokyo?', author_name: 'noodlefan', html: '<a href="https://www.reddit.com/r/JapanTravel/comments/1g2h3j4/">' } }, 'https://redd.it/1g2h3j4');
  assert.equal(o.ok, true);
  assert.equal(o.title, 'Best ramen in Tokyo?');
  assert.match(o.text, /r\/JapanTravel/);
  const page = '<html><head><link rel="canonical" href="https://www.reddit.com/r/JapanTravel/comments/1g2h3j4/best_ramen/"><meta property="og:title" content="Best ramen in Tokyo? : r/JapanTravel"></head><body><shreddit-post permalink="/r/JapanTravel/comments/1g2h3j4/best_ramen/" post-title="Best ramen in Tokyo?" author="noodlefan" subreddit-prefixed-name="r/JapanTravel" created-timestamp="2026-10-30T12:00:00.000000+0000"></shreddit-post></body></html>';
  // A share link (reddit.com/r/…/s/…) is followed to the post, then its data is asked for.
  const next = linkFollowUp('https://www.reddit.com/r/JapanTravel/s/AbCdEf123', { page });
  assert.equal(next.url, 'https://www.reddit.com/r/JapanTravel/comments/1g2h3j4/best_ramen/');
  assert.deepEqual(next.requests.map((r) => r.key), ['post', 'oembed']);
  const p = parseLink({ page, resolvedUrl: next.url }, 'https://www.reddit.com/r/JapanTravel/s/AbCdEf123');
  assert.equal(p.title, 'Best ramen in Tokyo?');
  assert.equal(p.creator, 'noodlefan');
  assert.equal(p.url, 'https://www.reddit.com/r/JapanTravel/comments/1g2h3j4/best_ramen/');
  // Everything turned away (Reddit blocks some networks): the address's subreddit and slug still say what it is.
  const blocked = parseLink({}, 'https://www.reddit.com/r/Cooking/comments/1xmgzdp/whats_your_favorite_use_for_the_5_costco_chicken/');
  assert.equal(blocked.title, 'Whats your favorite use for the 5 costco chicken');
  assert.match(blocked.text, /r\/Cooking/);
  assert.equal(blocked.source, 'address');
  // The embed's HTML names the post when its JSON has no title.
  assert.equal(parseLink({ oembed: { author_name: 'Eruionmel', html: '<blockquote><a href="https://www.reddit.com/r/Cooking/comments/1xmgzdp/x/">What&#39;s your favorite use for the $5 Costco chicken?</a></blockquote>' } }, 'https://redd.it/1xmgzdp').title, 'What\'s your favorite use for the $5 Costco chicken?');
  // Reddit's bot check is not the post.
  assert.equal(parseLink({ page: '<html><title>Blocked</title><body>You\'ve been blocked by network security.</body></html>' }, 'https://redd.it/1g2h3j4').ok, false);
});

// --- Bluesky, Pinterest, Threads, Facebook, Vimeo, Spotify ------------------------------------------

test('a Bluesky post keeps its whole links, pictures and the post it answers', () => {
  const text = 'New recipe up: example.com/lemon-ca… 🍋';
  const start = Buffer.byteLength('New recipe up: ');
  const thread = { thread: {
    post: { uri: 'at://did:plc:1/app.bsky.feed.post/3l6oveex3ii2l', author: { did: 'did:plc:1', handle: 'mia.bsky.social', displayName: 'Mia' },
      record: { text, createdAt: '2026-10-30T12:00:00Z', facets: [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength('example.com/lemon-ca…') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/lemon-cake' }] }] },
      embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky.app/img/1.jpg' }] } },
    parent: { post: { author: { did: 'did:plc:1', handle: 'mia.bsky.social' }, record: { text: 'Baking all weekend' } } },
  } };
  const r = parseLink({ thread }, 'https://bsky.app/profile/mia.bsky.social/post/3l6oveex3ii2l');
  assert.equal(r.ok, true);
  assert.match(r.text, /^New recipe up: https:\/\/example\.com\/lemon-cake 🍋/);
  assert.match(r.text, /Earlier in the thread: Baking all weekend/);
  assert.deepEqual(r.links, [{ url: 'https://example.com/lemon-cake', label: 'example.com/lemon-cake' }]);
  assert.equal(r.image, 'https://cdn.bsky.app/img/1.jpg');
  assert.equal(r.creator, 'mia.bsky.social');
  assert.equal(r.postType, 'bluesky');
});

test('a pin keeps its description, picture, board and the page it came from', async () => {
  const pin = { data: [{ id: '123456789012345678', description: 'Easy lemon drizzle cake, one bowl', grid_title: 'Lemon drizzle cake', link: 'https://www.bbcgoodfood.com/recipes/lemon-drizzle-cake', domain: 'bbcgoodfood.com', pinner: { username: 'bakesbymia', full_name: 'Mia' }, board: { name: 'Cakes' }, images: { '564x': { url: 'https://i.pinimg.com/564x/a.jpg' } } }] };
  const r = parseLink({ pin }, 'https://pin.it/4AbCdEf');
  // (pin.it wasn't followed here; the pin data alone is enough.)
  assert.equal(r.ok, true);
  assert.equal(r.title, 'Lemon drizzle cake');
  assert.match(r.text, /^Lemon drizzle cake\nEasy lemon drizzle cake, one bowl\n\nSaved to the board “Cakes”$/);
  assert.equal(r.image, 'https://i.pinimg.com/564x/a.jpg');
  assert.deepEqual(r.links, [{ url: 'https://www.bbcgoodfood.com/recipes/lemon-drizzle-cake', label: 'bbcgoodfood.com' }]);
  const short = linkFollowUp('https://pin.it/4AbCdEf', { page: '<html><head><link rel="canonical" href="https://www.pinterest.com/pin/123456789012345678/"></head></html>' });
  assert.deepEqual(short.requests.map((q) => q.key), ['pin']);
  const item = await save(mergeLinkRead({ url: 'https://www.pinterest.com/pin/123456789012345678/', sparse: true }, parseLink({ pin }, 'https://www.pinterest.com/pin/123456789012345678/')));
  assert.equal(item.instagram.postType, 'pinterest');
  assert.equal(item.title, 'Lemon drizzle cake');
});

test('Threads and Facebook posts are read from their link preview', () => {
  const threads = '<html><head><meta property="og:title" content="Mia (@mia) on Threads"><meta property="og:description" content="Five cafés in Lisbon worth the walk ☕️ #lisbon"><meta property="og:image" content="https://scontent.cdninstagram.com/a.jpg"></head></html>';
  const t = parseLink({ page: threads }, 'https://www.threads.net/@mia/post/C9abcdEFgh');
  assert.equal(t.ok, true);
  assert.equal(t.creator, 'mia');
  assert.equal(t.name, 'Mia');
  assert.equal(t.title, 'Five cafés in Lisbon worth the walk');
  const fb = '<html><head><meta property="og:title" content="Bakery Lumen"><meta property="og:description" content="1.2K reactions · 88 comments | New sourdough every Saturday from 8am."><link rel="canonical" href="https://www.facebook.com/bakerylumen/posts/pfbid0abc"></head></html>';
  const f = parseLink({ page: fb }, 'https://www.facebook.com/share/p/1AbCdEf/');
  assert.equal(f.text, 'New sourdough every Saturday from 8am.');
  assert.equal(f.url, 'https://www.facebook.com/bakerylumen/posts/pfbid0abc');
  // Facebook's sign-in page says nothing about the post.
  const wall = '<html><head><title>Log in or sign up to view</title></head><body><input name="email"><input name="pass"></body></html>';
  assert.equal(parseLink({ page: wall }, 'https://www.facebook.com/share/p/1AbCdEf/').ok, false);
});

test('Vimeo, SoundCloud and Spotify keep their title, maker and length', async () => {
  const v = parseLink({ oembed: { title: 'The Mountain', author_name: 'TSO Photography', description: 'A timelapse.', duration: 191, upload_date: '2011-05-26 12:00:00', thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg' } }, 'https://vimeo.com/76979871');
  assert.equal(v.title, 'The Mountain');
  assert.equal(v.durationSeconds, 191);
  const item = await save(mergeLinkRead({ url: 'https://vimeo.com/76979871', sparse: true }, v));
  assert.equal(item.kind, 'video');
  assert.equal(item.details.channel, 'TSO Photography');
  const s = parseLink({ oembed: { title: 'Bohemian Rhapsody', thumbnail_url: 'https://i.scdn.co/image/a' }, page: '<meta property="og:description" content="Queen · A Night at the Opera · Song · 1975"><meta property="og:type" content="music.song">' }, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1');
  assert.equal(s.title, 'Bohemian Rhapsody');
  assert.equal(s.text, 'Queen · A Night at the Opera · Song · 1975');
  assert.equal(s.ogType, 'music.song');
  // A song is a link, not something to buy.
  assert.equal((await save(mergeLinkRead({ url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', sparse: true }, s))).kind, 'link');
});

// --- any web page -----------------------------------------------------------------------------------

test('any page shared from an app is read from its own tags and schema.org data', async () => {
  const html = `<html><head><title>Lasagna Recipe | Serious Eats</title>
    <meta property="og:title" content="The Best Lasagna">
    <meta property="og:description" content="Layers of ricotta, ragù and pasta.">
    <meta property="og:image" content="/img/lasagna.jpg">
    <meta property="og:site_name" content="Serious Eats">
    <link rel="canonical" href="https://www.seriouseats.com/the-best-lasagna">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"The Best Lasagna","recipeIngredient":["500 g ricotta","12 lasagna sheets","700 g passata"],"recipeInstructions":[{"@type":"HowToStep","text":"Layer it."},{"@type":"HowToStep","text":"Bake."}],"totalTime":"PT1H30M"}]}</script>
    </head><body>…</body></html>`;
  const r = parseLink({ page: html }, 'https://www.seriouseats.com/the-best-lasagna?utm_source=app');
  assert.equal(r.ok, true);
  assert.equal(r.title, 'The Best Lasagna');
  assert.equal(r.image, 'https://www.seriouseats.com/img/lasagna.jpg');
  assert.equal(r.url, 'https://www.seriouseats.com/the-best-lasagna');
  const item = await save(mergeLinkRead({ url: 'https://www.seriouseats.com/the-best-lasagna?utm_source=app', sparse: true }, r));
  assert.equal(item.kind, 'recipe');
  assert.equal(item.details.ingredients.length, 3);
  assert.equal(item.title, 'The Best Lasagna');
});

test('a product page keeps its price; an article its author and date', () => {
  const shop = '<meta property="og:title" content="Linen shirt"><script type="application/ld+json">{"@type":"Product","name":"Linen shirt","offers":{"@type":"Offer","price":"89.00","priceCurrency":"USD"}}</script>';
  const f = pageFacts(shop, 'https://shop.example/linen');
  assert.equal(f.price, 89);
  assert.equal(f.currency, 'USD');
  const art = '<meta property="og:type" content="article"><meta property="og:title" content="How to rest"><script type="application/ld+json">{"@type":"NewsArticle","headline":"How to rest","author":{"@type":"Person","name":"Ana Lee"},"datePublished":"2026-10-01"}</script>';
  const a = pageFacts(art, 'https://news.example/rest');
  assert.equal(a.author, 'Ana Lee');
  assert.equal(a.published, '2026-10-01');
  assert.equal(a.ogType, 'article');
});

test('sign-in walls, bot checks and app-name titles are not what the link is about', async () => {
  for (const t of ['Log into Facebook | Facebook', 'Untitled item', 'We’re working on it. System maintenance is in progress.', 'TikTok - Make Your Day', 'Reddit - The heart of the internet', 'YouTube', 'Just a moment...', 'Log in or sign up to view', 'Instagram', 'Access Denied']) assert.equal(junkTitle(t), true, t);
  for (const t of ['Brown butter pasta', 'Reddit’s best lasagna', 'The YouTube algorithm explained']) assert.equal(junkTitle(t), false, t);
  const fbWall = '<html><head><title>Log into Facebook | Facebook</title><meta property="og:description" content="Log into Facebook to start sharing and connecting with your friends."></head></html>';
  assert.equal(parseLink({ page: fbWall }, 'https://www.facebook.com/NASA').ok, false);
  const down = '<html><head><title>Patagonia Outdoor Clothing</title><meta name="description" content="We\'re working on it. System maintenance is in progress."></head></html>';
  assert.equal(parseLink({ page: down }, 'https://www.patagonia.com/product/x/1.html').text, '');
  const cf = '<html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>';
  const r = parseLink({ page: cf }, 'https://shop.example/thing');
  assert.equal(r.ok, false);
  // Nothing came back: the save is what was shared, nothing made up.
  const p = mergeLinkRead({ url: 'https://shop.example/thing', title: 'Thing', sparse: true }, r);
  assert.equal(p.title, 'Thing');
  assert.equal(p.linkRead, 'none');
});

test('a thin page that offers oEmbed has it asked for', () => {
  const html = '<html><head><link rel="alternate" type="application/json+oembed" href="https://blog.example/wp-json/oembed/1.0/embed?url=x"></head></html>';
  assert.deepEqual(linkFollowUp('https://blog.example/post', { page: html }).requests.map((r) => r.url), ['https://blog.example/wp-json/oembed/1.0/embed?url=x']);
  const r = parseLink({ page: html, oembed: { title: 'A post', author_name: 'Ana' } }, 'https://blog.example/post');
  assert.equal(r.title, 'A post');
  assert.equal(r.ok, true);
  // A page that describes itself needs nothing more.
  assert.deepEqual(linkFollowUp('https://blog.example/post', { page: '<meta property="og:title" content="A post">' + html }).requests, []);
});

test('the same post shared from different links is one save', () => {
  const same = (a, b) => assert.equal(normalizeUrl(a), normalizeUrl(b), `${a} = ${b}`);
  same('https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  same('https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  same('https://www.tiktok.com/@chef.mia/video/7301234567890123456?is_from_webapp=1', 'https://www.tiktok.com/@_/video/7301234567890123456');
  same('https://www.reddit.com/r/Cooking/comments/1g2h3j4/my_grandmas_lasagna/?share_id=x', 'https://redd.it/1g2h3j4');
  same('https://old.reddit.com/r/Cooking/comments/1G2H3J4/', 'https://www.reddit.com/comments/1g2h3j4');
  same('https://www.pinterest.com/pin/123456789012345678/', 'https://pinterest.co.uk/pin/lemon-cake--123456789012345678/');
  assert.notEqual(normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), normalizeUrl('https://www.youtube.com/watch?v=aaaaaaaaaaa'));
});

test('a short link’s save keeps the post’s own address', async () => {
  const page = ttData(ttItem);
  const next = linkFollowUp('https://vm.tiktok.com/ZMabc123/', { page });
  const p = mergeLinkRead({ url: 'https://vm.tiktok.com/ZMabc123/', sparse: true }, parseLink({ page, resolvedUrl: next.url }, 'https://vm.tiktok.com/ZMabc123/'));
  assert.equal(p.url, 'https://www.tiktok.com/@chef.mia/video/7301234567890123456');
  assert.equal(p.sharedUrl, 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(resolvedUrl('<link rel="canonical" href="/r/x/comments/abcd12/">', 'https://www.reddit.com/r/x/s/q'), 'https://www.reddit.com/r/x/comments/abcd12/');
});

test('nothing read: the post says why only the link was saved', async () => {
  const s = store();
  const { item } = await saveCapture(s, mergeLinkRead({ url: 'https://www.tiktok.com/@a/video/7301234567890123456', isPost: true, retailer: 'TikTok', sparse: true }, parseLink({}, 'https://www.tiktok.com/@a/video/7301234567890123456')));
  assert.equal(item.url, 'https://www.tiktok.com/@a/video/7301234567890123456');
});
