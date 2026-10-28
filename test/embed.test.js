'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const embed = require('../src/embed');

const ok = (url, platform, sourceId, orientation) => {
  const r = embed.parseVideoUrl(url);
  assert.equal(r.platform, platform, url);
  assert.equal(r.sourceId, sourceId, url);
  if (orientation) assert.equal(r.orientation, orientation, url);
};
const bad = (url) => assert.throws(() => embed.parseVideoUrl(url), embed.UrlError, String(url));

test('parses YouTube videos and Shorts', () => {
  ok('https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ', 'landscape');
  ok('https://youtube.com/watch?v=aqz-KE-bpKQ&t=30s&list=abc', 'youtube', 'aqz-KE-bpKQ');
  ok('https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ');
  ok('https://youtu.be/aqz-KE-bpKQ?si=xyz', 'youtube', 'aqz-KE-bpKQ');
  ok('www.youtube.com/embed/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ');
  ok('https://www.youtube.com/live/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ');
  ok('https://www.youtube.com/shorts/aqz-KE-bpKQ', 'youtube_short', 'aqz-KE-bpKQ', 'portrait');
  ok('https://youtube.com/shorts/aqz-KE-bpKQ?feature=share', 'youtube_short', 'aqz-KE-bpKQ');
});

test('parses Instagram, TikTok and Vimeo', () => {
  ok('https://www.instagram.com/reel/C1a2B3c4D5e/', 'instagram', 'C1a2B3c4D5e', 'portrait');
  ok('https://www.instagram.com/reels/C1a2B3c4D5e', 'instagram', 'C1a2B3c4D5e');
  ok('https://www.instagram.com/someuser/reel/C1a2B3c4D5e/?igsh=abc', 'instagram', 'C1a2B3c4D5e');
  ok('https://instagram.com/p/C1a2B3c4D5e/', 'instagram', 'C1a2B3c4D5e', 'square');
  ok('https://www.tiktok.com/@scout2015/video/6718335390845095173', 'tiktok', '6718335390845095173', 'portrait');
  ok('https://www.tiktok.com/@some.user_1/video/7311111111111111111?lang=en', 'tiktok', '7311111111111111111');
  ok('https://www.tiktok.com/embed/v2/7311111111111111111', 'tiktok', '7311111111111111111');
  ok('https://m.tiktok.com/v/7311111111111111111.html', 'tiktok', '7311111111111111111');
  ok('https://vimeo.com/76979871', 'vimeo', '76979871');
  ok('https://vimeo.com/76979871/abcdef1234', 'vimeo', '76979871:abcdef1234');
  ok('https://player.vimeo.com/video/76979871?h=abcdef1234', 'vimeo', '76979871:abcdef1234');
  ok('https://vimeo.com/channels/staffpicks/76979871', 'vimeo', '76979871');
});

test('rejects unsupported, malformed and malicious links', () => {
  bad('');
  bad(null);
  bad({});
  bad('javascript:alert(1)');
  bad('data:text/html,<script>alert(1)</script>');
  bad('file:///etc/passwd');
  bad('https://evil.com/watch?v=aqz-KE-bpKQ');
  bad('https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ');
  bad('https://evilyoutube.com/watch?v=aqz-KE-bpKQ');
  bad('https://user:pass@youtube.com/watch?v=aqz-KE-bpKQ');
  bad('https://www.youtube.com/watch?v=short');
  bad('https://www.youtube.com/watch?v=aqz-KE-bpKQ"><script>');
  bad('https://www.youtube.com/watch?v=../../../../x');
  bad('https://www.youtube.com/shorts/%22onload%3Dalert(1)');
  bad('https://www.tiktok.com/@user/video/123abc');
  bad('https://vm.tiktok.com/ZMabc123/');
  bad('https://www.instagram.com/reel/<img>/');
  bad('https://vimeo.com/abc');
  bad(`https://www.youtube.com/watch?v=${'a'.repeat(700)}`);
});

test('embed and canonical URLs are rebuilt only from validated ids', () => {
  assert.equal(embed.embedUrl('youtube', 'aqz-KE-bpKQ'), 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=0&playsinline=1&modestbranding=1');
  assert.equal(embed.embedUrl('youtube', '"><script>'), null);
  assert.equal(embed.embedUrl('tiktok', '1 onload=x'), null);
  assert.equal(embed.embedUrl('upload', 'x'), null);
  assert.equal(embed.embedUrl('vimeo', '76979871:abc def'), null);
  assert.equal(embed.canonicalUrl('tiktok', '7311111111111111111', { tiktokUser: 'a"b' }), 'https://www.tiktok.com/embed/v2/7311111111111111111');
  assert.equal(embed.isTrustedSourceUrl('javascript:alert(1)'), false);
  assert.equal(embed.isTrustedSourceUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), true);
  assert.equal(embed.isTrustedSourceUrl('https://www.youtube.com/watch?v=x"onmouseover=alert(1)'), false);
});
