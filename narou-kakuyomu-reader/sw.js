/**
 * Service Worker for Narou Kakuyomu Reader (v9 - GitHub Pages & Offline Edition)
 * Network-First for HTML/JS/CSS when online to guarantee instant updates.
 * Cache-Fallback for 100% offline functionality.
 */

const CACHE_NAME = 'narou-reader-v9';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/style.css?v=9',
    './js/app.js?v=9',
    './js/reader.js',
    './js/db.js',
    './js/api.js',
    './js/kakuyomu.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// インストール時にアプリシェルをキャッシュ & 即時アクティベート
self.addEventListener('install', (event) => {
    console.log('[Service Worker v9] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(
                ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.warn('Cache failed for', url, err)))
            );
        }).then(() => self.skipWaiting())
    );
});

// 古いキャッシュの即時削除 & クライアント乗っ取り
self.addEventListener('activate', (event) => {
    console.log('[Service Worker v9] Activating...');
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker v6] Purging old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// フェッチ処理 (Network-First with Cache-Fallback)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // APIリクエストや外部通信はキャッシュせず常に直接ネットワークへ
    if (url.pathname.startsWith('/api/') || url.origin !== location.origin) {
        return;
    }

    // 静的ファイル: ネットワーク優先 (通信可能なら常に最新のサーバーコードを取得してキャッシュを更新)
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
            }
            return networkResponse;
        }).catch(() => {
            // オフライン・電波不通時は保存済みキャッシュから即座に表示
            return caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // HTMLナビゲーション要求なら index.html を返す
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html') || caches.match('./');
                }
            });
        })
    );
});
