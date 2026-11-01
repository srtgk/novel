/**
 * api.js - Narou & Kakuyomu Client (v9 - Client-First & GitHub Pages Edition)
 * Works directly in browser using CORS Proxies or local server endpoints.
 */

import * as ky from './kakuyomu.js';
import { db } from './db.js';

// サンプル作品データ（オフライン即時体験用）
export const SAMPLE_NOVEL = {
    ncode: 'sample01',
    source: 'sample',
    title: '【サンプル】異世界でオフラインリーダーを作ったら無双した件',
    writer: 'カクヨム風開発者',
    story: 'Android 16（Pixel 9a）を片手に異世界転移した主人公。電波の届かないダンジョンの中でも、事前のオフライン保存とカクヨム風のスワイプ次話移動により、ストレスゼロの快適な読書ライフを送っていた。これは、最下部スクロールに情熱を捧げた男の記録である。',
    total_episodes: 3,
    downloaded_count: 3,
    last_read_ep: 1,
    last_read_percent: 0,
    is_sample: true
};

export const SAMPLE_CHAPTERS = [
    {
        ncode: 'sample01',
        ep: 1,
        subtitle: '第1話　気がつけばダンジョン、されど手元にはPixel 9a',
        preface: '※この作品はカクヨム風リーダーの体験用サンプルエピソードです。',
        body: `<p id="L1">目が覚めると、見知らぬ石造りの回廊に横たわっていた。</p>
<p id="L2"><br></p>
<p id="L3">「……ここは、どこだ？」</p>
<p id="L4"><br></p>
<p id="L5">ひんやりとした冷気と、薄暗い松明の光。どう見てもファンタジーRPGに出てくるダンジョンのそれである。</p>
<p id="L6">だが、絶望する私の右ポケットには、確かな重みがあった。</p>
<p id="L7"><br></p>
<p id="L8">──最新鋭スマートフォン、Pixel 9a。</p>
<p id="L9"><br></p>
<p id="L10">画面を点灯させると、バッテリー残量は98%。だが当然のごとく『圏外』の文字が虚しく光っている。</p>
<p id="L11">「くそっ、やっぱり電波はないか……いや、待てよ？」</p>
<p id="L12"><br></p>
<p id="L13">私はホーム画面に配置された、あのアイコンをタップした。</p>
<p id="L14"><ruby>鳴動<rt>めいどう</rt></ruby>するアプリ──『カクヨム風オフラインリーダー』。</p>
<p id="L15"><br></p>
<p id="L16">「動く……！　端末に保存された小説が、外出先でもオフラインでも読めるぞ！」</p>`,
        afterword: '（下までスクロールして、さらに上に引き上げてみてください！バイブレーションとともに第2話へ進みます）'
    },
    {
        ncode: 'sample01',
        ep: 2,
        subtitle: '第2話　引き上げて次話へ！　吸い付くようなオーバースクロール',
        preface: '第1話からスムーズに遷移できましたでしょうか？',
        body: `<p id="L1">ページの最下部に到達した状態で、私は親指をさらに上へとスワイプした。</p>
<p id="L2"><br></p>
<p id="L3">画面下部から、ふわりと現れるローディングリング。</p>
<p id="L4">『引っ張って次の話へ』というガイドが、指の動きに合わせて心地よいバネのような抵抗感で追従してくる。</p>
<p id="L5"><br></p>
<p id="L6">ぐっ、と引き下げた瞬間──</p>
<p id="L7"><br></p>
<p id="L8">『トッ』</p>
<p id="L9"><br></p>
<p id="L10">端末の内蔵ハプティックモーターが、上品な振動を指先に返した。</p>`,
        afterword: '（次がサンプルの最終話です。最新話での特別な挙動もご確認ください）'
    },
    {
        ncode: 'sample01',
        ep: 3,
        subtitle: '第3話　電波がなくても、物語は止まらない（完）',
        preface: 'サンプル最終話です。',
        body: `<p id="L1">「ふふふ……読書位置も自動的に端末のIndexedDBに記憶されているな」</p>
<p id="L2"><br></p>
<p id="L3">一度アプリを閉じても、次に開けばミリ単位で前回のスクロール位置が復元される。</p>
<p id="L4">魔王の城が近づこうが、ドラゴンの咆哮が轟こうが、私の読書ライフを妨げるものは何一つない。</p>
<p id="L5"><br></p>
<p id="L6">男はPixel 9aを大切に胸に抱き、新たな本棚への一歩を踏み出したのだった──。</p>
<p id="L7"><br></p>
<p id="L8">【終わり】</p>`,
        afterword: '最後までお読みいただきありがとうございます！上部の「戻る」ボタン、または画面タップメニューからライブラリへ戻れます。'
    }
];

export class NovelAPI {
    constructor() {
        this.timeoutMs = 12000;
        this.defaultProxies = [
            'https://novel.kzfm-game-aka.workers.dev/proxy?url=',
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?url='
        ];
    }

    /**
     * 入力文字列（URLや作品ID）から作品キーとソース（narou/kakuyomu/sample）を判定
     */
    static resolveWork(raw) {
        if (!raw) return { key: null, source: null, id: null };
        const clean = raw.trim();

        // 1. カクヨム
        const kyId = ky.parseInput(clean);
        if (kyId) {
            return { key: ky.KEY_PREFIX + kyId, source: 'kakuyomu', id: kyId };
        }

        // 2. なろう
        const nm = clean.toLowerCase().match(/n\d{4}[a-z]{2}/);
        if (nm) {
            return { key: nm[0], source: 'narou', id: nm[0] };
        }

        // 3. サンプル
        if (clean.toLowerCase() === 'sample01') {
            return { key: 'sample01', source: 'sample', id: 'sample01' };
        }

        return { key: null, source: null, id: null };
    }

    static normalizeNcode(input) {
        const res = NovelAPI.resolveWork(input);
        return res.key || input;
    }

    /**
     * プロキシURLを自動判定して組み立て
     * すべての外部リクエストが正しくカスタムプロキシ（?url=...）を経由するように統一
     */
    static buildProxyUrl(rawProxy, targetUrl) {
        if (!rawProxy || !rawProxy.trim()) return targetUrl;
        let proxy = rawProxy.trim();
        if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
            proxy = 'https://' + proxy;
        }

        // Cloudflare Workers (novel.kzfm-game-aka.workers.dev) の自動正規化
        if (proxy.includes('novel.kzfm-game-aka.workers.dev') && !proxy.includes('/proxy') && !proxy.includes('?url=')) {
            proxy = proxy.replace(/\/+$/, '') + '/proxy?url=';
        }

        if (proxy.endsWith('=') || proxy.includes('?')) {
            if (proxy.endsWith('=')) {
                return proxy + encodeURIComponent(targetUrl);
            } else if (proxy.endsWith('?')) {
                return proxy + 'url=' + encodeURIComponent(targetUrl);
            } else {
                const sep = proxy.includes('?') ? '&' : '?';
                return proxy + sep + 'url=' + encodeURIComponent(targetUrl);
            }
        }

        // パス型プロキシ（https://example.workers.dev/https://target...）
        const base = proxy.replace(/\/+$/, '');
        return `${base}/${targetUrl}`;
    }

    /**
     * CORSプロキシまたは直接通信でテキストを取得
     */
    async fetchText(targetUrl, timeoutMs = this.timeoutMs) {
        // 1. ユーザー設定のカスタムプロキシがあれば最優先
        let customProxy = null;
        try {
            customProxy = await db.getSetting('custom_cors_proxy', null);
        } catch (e) {}

        const proxies = [];
        if (customProxy && customProxy.trim()) {
            proxies.push(customProxy.trim());
        }

        // 2. デフォルトプロキシ群を追加
        for (const dp of this.defaultProxies) {
            if (!proxies.includes(dp)) {
                proxies.push(dp);
            }
        }
        proxies.push(''); // 直接アクセス（フォールバック）

        let lastError = null;

        for (const proxy of proxies) {
            const fetchUrl = NovelAPI.buildProxyUrl(proxy, targetUrl);

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetch(fetchUrl, {
                    method: 'GET',
                    signal: controller.signal,
                    credentials: 'omit', // 不要なCookie送信を防ぎ401エラーを抑止
                    cache: 'no-cache',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,text/plain,*/*'
                    }
                });
                clearTimeout(timer);

                if (res.ok) {
                    const text = await res.text();
                    // プロキシが自サイトのLPやHTMLエラーを返してきた場合は無効として次を試行
                    if (proxy && text.includes('<!DOCTYPE html>') && targetUrl.includes('api.syosetu.com')) {
                        throw new Error('プロキシが不正な応答（HTML）を返しました');
                    }
                    return text;
                } else {
                    lastError = new Error(`HTTP Error ${res.status}: ${res.statusText}`);
                }
            } catch (err) {
                clearTimeout(timer);
                lastError = err;
            }
        }

        throw new Error(`データの取得に失敗しました: ${lastError ? lastError.message : '接続エラー'}`);
    }

    /**
     * なろうHTMLのクリーニング
     */
    cleanNovelHtml(raw) {
        if (!raw) return '';
        return raw
            .replace(/<script.*?>.*?<\/script>/gis, '')
            .replace(/<style.*?>.*?<\/style>/gis, '')
            .replace(/<!--.*?-->/gis, '')
            .trim();
    }

    /**
     * なろう本文HTMLから各要素を抽出
     */
    extractNarouChapter(html, ncode, ep) {
        let subtitle = '';
        const subMatch = html.match(/<h1 class="p-novel__title[^"]*">(.*?)<\/h1>/is) ||
                         html.match(/<p class="novel_subtitle">(.*?)<\/p>/is) ||
                         html.match(/<p class="novel_title">(.*?)<\/p>/is);
        if (subMatch) {
            subtitle = subMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        let preface = '';
        const prefMatch = html.match(/<div class="p-novel__text p-novel__text--preface"[^>]*>(.*?)<\/div>\s*<!--/is) ||
                          html.match(/<div id="novel_p"[^>]*>(.*?)<\/div>\s*<!--/is) ||
                          html.match(/<div class="p-novel__text p-novel__text--preface"[^>]*>(.*?)<\/div>/is) ||
                          html.match(/<div id="novel_p"[^>]*>(.*?)<\/div>/is);
        if (prefMatch) {
            preface = this.cleanNovelHtml(prefMatch[1]);
        }

        let body = '';
        const bodyMatch = html.match(/<div class="js-novel-text p-novel__text"[^>]*>(.*?)<\/div>\s*(?:<!--|<\/div>)/is) ||
                          html.match(/<div id="novel_honbun"[^>]*>(.*?)<\/div>\s*<!--\s*#novel_honbun\s*-->/is) ||
                          html.match(/<div id="novel_honbun"[^>]*>(.*?)<\/div>/is);
        if (bodyMatch) {
            body = this.cleanNovelHtml(bodyMatch[1]);
        } else {
            const paras = html.match(/<p id="L\d+"[^>]*>.*?<\/p>/gis);
            if (paras) {
                body = this.cleanNovelHtml(paras.join('\n'));
            }
        }

        let afterword = '';
        const afterMatch = html.match(/<div class="p-novel__text p-novel__text--afterword"[^>]*>(.*?)<\/div>\s*<!--/is) ||
                           html.match(/<div id="novel_a"[^>]*>(.*?)<\/div>\s*<!--/is) ||
                           html.match(/<div class="p-novel__text p-novel__text--afterword"[^>]*>(.*?)<\/div>/is) ||
                           html.match(/<div id="novel_a"[^>]*>(.*?)<\/div>/is);
        if (afterMatch) {
            afterword = this.cleanNovelHtml(afterMatch[1]);
        }

        return {
            ncode,
            ep: parseInt(ep, 10),
            subtitle: subtitle || `第 ${ep} 話`,
            preface,
            body,
            afterword,
            is_short_story: false
        };
    }

    // =========================================================================
    // 公開APIメソッド群（すべてプロキシ経由で統一・不要な/api/直接呼出を排除）
    // =========================================================================

    /**
     * 作品検索 (なろうAPI)
     */
    async searchNovels(word) {
        if (!word || !word.trim()) return [];
        const encodedWord = encodeURIComponent(word.trim());
        const targetUrl = `https://api.syosetu.com/novelapi/api/?out=json&word=${encodedWord}&lim=15&of=t-w-s-k-ga-gp-gl-nt-n`;

        const text = await this.fetchText(targetUrl);
        const data = JSON.parse(text);
        if (!data || data.length <= 1) return [];

        return data.slice(1).map(item => ({
            ncode: item.ncode.toLowerCase(),
            source: 'narou',
            title: item.title,
            writer: item.writer,
            story: item.story,
            total_episodes: item.general_all_no || 1,
            keyword: item.keyword || ''
        }));
    }

    /**
     * 作品メタデータの取得 (なろう / カクヨム両対応)
     */
    async fetchNovelInfo(input) {
        const { key, source, id } = NovelAPI.resolveWork(input);
        if (!key) throw new Error('有効なNコードまたはカクヨムURLが見つかりません');

        if (source === 'sample') return SAMPLE_NOVEL;

        if (source === 'kakuyomu') {
            const html = await this.fetchText(ky.workUrl(id));
            const { info } = ky.parseWorkPage(html, id);
            return info;
        }

        // なろう
        const targetUrl = `https://api.syosetu.com/novelapi/api/?out=json&ncode=${id}&of=t-w-s-k-ga-gp-gl-nt`;
        const text = await this.fetchText(targetUrl);
        const data = JSON.parse(text);
        if (!data || data.length <= 1) {
            throw new Error('小説家になろうに作品が見つかりませんでした');
        }
        const item = data[1];
        return {
            ncode: id,
            source: 'narou',
            title: item.title,
            writer: item.writer,
            story: item.story,
            total_episodes: item.general_all_no || 1,
            genre: item.genre,
            keyword: item.keyword,
            novel_updated_at: item.novelupdated_at,
            general_firstup: item.general_firstup,
            last_read_ep: 1,
            last_read_percent: 0,
            downloaded_count: 0
        };
    }

    /**
     * 各話の本文・サブタイトル取得 (なろう / カクヨム両対応)
     */
    async fetchChapter(keyOrInput, ep = 1) {
        const { key, source, id } = NovelAPI.resolveWork(keyOrInput);
        const epNum = parseInt(ep, 10);

        if (source === 'sample') {
            const ch = SAMPLE_CHAPTERS.find(c => c.ep === epNum);
            if (ch) return ch;
            throw new Error('指定されたサンプル話が見つかりません');
        }

        if (source === 'kakuyomu') {
            // カクヨム: 目次からエピソードIDを取得して本文取得
            const toc = await this.fetchToc(key);
            const entry = (toc.episodes || []).find(e => e.ep === epNum);
            if (!entry || !entry.episode_id) {
                throw new Error(`カクヨムの第 ${epNum} 話が見つかりません`);
            }
            const epHtml = await this.fetchText(ky.episodeUrl(id, entry.episode_id));
            const { subtitle, preface, body, afterword } = ky.extractEpisode(epHtml);
            if (!body) throw new Error('本文の抽出に失敗しました');
            return {
                ncode: key,
                ep: epNum,
                subtitle: subtitle || entry.title || `第 ${epNum} 話`,
                preface,
                body,
                afterword,
                is_short_story: false
            };
        }

        // なろう
        const epUrl = `https://ncode.syosetu.com/${id}/${epNum}/`;
        let html = '';
        let isShortStory = false;

        try {
            html = await this.fetchText(epUrl);
        } catch (err) {
            // 404等の場合、第1話かつ短編（URL直下）をフォールバック試行
            if (epNum === 1) {
                const singleUrl = `https://ncode.syosetu.com/${id}/`;
                try {
                    html = await this.fetchText(singleUrl);
                    isShortStory = true;
                } catch (e) {
                    throw err;
                }
            } else {
                throw err;
            }
        }

        const chapter = this.extractNarouChapter(html, id, epNum);
        chapter.is_short_story = isShortStory;
        if (!chapter.body) {
            throw new Error('本文の抽出に失敗しました（作品が削除されているか未公開の可能性があります）');
        }
        return chapter;
    }

    /**
     * 目次（サブタイトル一覧）の取得 (全分割ページ巡回対応)
     */
    async fetchToc(keyOrInput) {
        const { key, source, id } = NovelAPI.resolveWork(keyOrInput);

        if (source === 'sample') {
            return {
                ncode: 'sample01',
                episodes: SAMPLE_CHAPTERS.map(c => ({ ep: c.ep, title: c.subtitle }))
            };
        }

        if (source === 'kakuyomu') {
            const html = await this.fetchText(ky.workUrl(id));
            const { toc } = ky.parseWorkPage(html, id);
            return {
                ncode: key,
                episodes: toc.map(t => ({
                    ep: t.ep,
                    episode_id: t.episode_id,
                    title: t.title,
                    chapter: t.chapter
                }))
            };
        }

        // なろう: 全分割ページ巡回
        const episodes = [];
        let page = 1;

        while (true) {
            const url = page === 1
                ? `https://ncode.syosetu.com/${id}/`
                : `https://ncode.syosetu.com/${id}/?p=${page}`;

            try {
                const html = await this.fetchText(url);
                const regex = new RegExp(`href=["']/${id}/(\\d+)/["'][^>]*>(.*?)</a>`, 'gis');
                let match;
                let addedInPage = 0;
                while ((match = regex.exec(html)) !== null) {
                    const epNum = parseInt(match[1], 10);
                    const title = match[2].replace(/<[^>]+>/g, '').trim();
                    if (!episodes.some(e => e.ep === epNum)) {
                        episodes.push({ ep: epNum, title });
                        addedInPage++;
                    }
                }
                if (addedInPage === 0 || page >= 100) break;
                page++;
            } catch (err) {
                break;
            }
        }

        if (episodes.length === 0) {
            episodes.push({ ep: 1, title: '短編 本文' });
        }

        return { ncode: id, episodes };
    }
}

export const api = new NovelAPI();
