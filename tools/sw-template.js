/* Talanoa offline cache.
   sw.js is generated from tools/sw-template.js by tools/build.py; edit the template.

   Everything the board needs is kept on the phone, so it keeps working with no
   internet. Voice clips go in their own cache ("tt2-voices") that survives app
   updates; the page fills it for whichever voice is selected. */
var VERSION = '__VERSION__';
var CACHE = 'tt2-app-' + VERSION;
var VOICE_CACHE = 'tt2-voices';
var SHARE_CACHE = 'tt2-share';       /* a photo shared to Talanoa, until the page picks it up */
var PRECACHE = __PRECACHE__;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf('tt2-app-') === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* The page asks which version is running (shown in Settings). */
self.addEventListener('message', function (e) {
  if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});

/* Audio elements ask for byte ranges. Answer them from the full cached file. */
function slice(req, res) {
  var range = req.headers.get('range');
  if (!range || !res || res.status !== 200) return res;
  return res.arrayBuffer().then(function (buf) {
    var len = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return new Response(buf, { status: 200, headers: res.headers });
    var start, end;
    if (m[1] === '') { start = Math.max(0, len - Number(m[2])); end = len - 1; }
    else { start = Number(m[1]); end = m[2] === '' ? len - 1 : Math.min(Number(m[2]), len - 1); }
    if (start >= len || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + len } });
    }
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + len,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }});
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* A photo shared to Talanoa from the gallery (the manifest's "share_target"): keep it, then open the
     app, which offers to make a new picture with it or put it on one already on the board. */
  if (req.method === 'POST' && /\/share-photo$/.test(url.pathname)) {
    e.respondWith(req.formData().then(function (form) {
      var f = form.get('photo');
      if (!f || !f.size) return null;
      return caches.open(SHARE_CACHE).then(function (c) {
        return c.put('shared-photo', new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
      });
    }).catch(function () {}).then(function () { return Response.redirect('./?shared=1', 303); }));
    return;
  }
  if (req.method !== 'GET') return;

  if (url.pathname.indexOf('/voices/') !== -1) {
    /* Fetch the whole clip once (never a partial), keep it, then serve the range asked for. */
    e.respondWith(caches.open(VOICE_CACHE).then(function (c) {
      return c.match(url.href).then(function (hit) {
        if (hit) return hit;
        return fetch(url.href).then(function (res) {
          if (res.ok) c.put(url.href, res.clone());
          return res;
        });
      });
    }).then(function (res) { return slice(req, res); }));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
    return hit || fetch(req);
  }));
});
