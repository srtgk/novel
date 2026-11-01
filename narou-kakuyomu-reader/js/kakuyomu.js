/**
 * kakuyomu.js - カクヨムのページ解析モジュール（ブラウザ / ES Module版）
 * ネットワーク通信なし。HTML文字列を受け取ってパースする純粋関数。
 */

export const BASE = 'https://kakuyomu.jp';
export const KEY_PREFIX = 'kakuyomu_';

/**
 * 作品URLの生成
 */
export function workUrl(workId) {
    return `${BASE}/works/${workId}`;
}

/**
 * 各話URLの生成
 */
export function episodeUrl(workId, episodeId) {
    return `${BASE}/works/${workId}/episodes/${episodeId}`;
}

/**
 * URL・作品ID・保存キーからカクヨム作品IDを取り出す
 */
export function parseInput(raw) {
    raw = (raw || '').trim();
    const m = raw.match(/kakuyomu\.jp\/works\/(\d{10,24})/);
    if (m) return m[1];
    const m2 = raw.match(/^(?:kakuyomu_)?(\d{10,24})$/);
    return m2 ? m2[1] : null;
}

/**
 * 作品ページHTMLから __NEXT_DATA__ の Apollo State を抽出
 */
function getApolloState(html) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!m) {
        throw new Error('__NEXT_DATA__ が見つかりません（ページ構造変更または非公開の可能性があります）');
    }
    try {
        const data = JSON.parse(m[1]);
        return data.props.pageProps.__APOLLO_STATE__;
    } catch (e) {
        throw new Error(`Apollo stateの解析に失敗しました: ${e.message}`);
    }
}

function refId(node) {
    if (node && typeof node === 'object' && node.__ref) {
        const parts = node.__ref.split(':');
        return parts.length > 1 ? parts[1] : null;
    }
    return null;
}

function deref(state, node) {
    if (node && typeof node === 'object' && node.__ref) {
        return state[node.__ref] || null;
    }
    return node;
}

/**
 * 作品ページHTML -> { info, toc }
 */
export function parseWorkPage(html, workId) {
    const state = getApolloState(html);
    const work = state[`Work:${workId}`];
    if (!work) {
        throw new Error(`作品 ${workId} の情報が見つかりません（非公開・削除済みの可能性）`);
    }

    const author = deref(state, work.author) || {};
    const toc = [];

    const tocRefs = work.tableOfContentsV2 || [];
    for (const chRef of tocRefs) {
        const chapterNode = deref(state, chRef) || {};
        const chapter = deref(state, chapterNode.chapter) || {};
        const chapterTitle = chapter.title || '';
        const epRefs = chapterNode.episodeUnions || [];

        for (const epRef of epRefs) {
            const epId = refId(epRef);
            if (!epId) continue;
            const ep = deref(state, epRef) || {};
            toc.push({
                ep: toc.length + 1,
                episode_id: ep.id || epId,
                title: ep.title || '',
                chapter: chapterTitle,
                published_at: ep.publishedAt || null
            });
        }
    }

    // 保険: DOMリンクからのフォールバック
    if (toc.length === 0) {
        const regex = new RegExp(`/works/${workId}/episodes/(\\d+)`, 'g');
        const seen = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
            const eid = match[1];
            if (!seen.includes(eid)) seen.push(eid);
        }
        seen.forEach((eid, idx) => {
            toc.push({
                ep: idx + 1,
                episode_id: eid,
                title: '',
                chapter: '',
                published_at: null
            });
        });
    }

    const publicCount = work.publicEpisodeCount || 0;
    const info = {
        ncode: KEY_PREFIX + workId,
        source: 'kakuyomu',
        title: work.title || '',
        writer: author.activityName || author.name || '',
        story: work.introduction || '',
        catchphrase: work.catchphrase || '',
        total_episodes: toc.length || publicCount || 1,
        genre: work.genre || '',
        keyword: (work.tagLabels || []).join(' '),
        novel_updated_at: work.lastEpisodePublishedAt || null,
        general_firstup: work.publishedAt || null,
        serial_status: work.serialStatus || null,
        total_characters: work.totalCharacterCount || 0,
        last_read_ep: 1,
        last_read_percent: 0,
        downloaded_count: 0
    };

    return { info, toc };
}

function stripTags(s) {
    return (s || '').replace(/<[^>]+>/g, '').trim();
}

function cleanHtml(html) {
    let s = (html || '');
    s = s.replace(/<script.*?>.*?<\/script>/gis, '');
    s = s.replace(/<style.*?>.*?<\/style>/gis, '');
    s = s.replace(/<!--.*?-->/gis, '');
    return s.trim();
}

function paragraphs(block) {
    if (!block) return '';
    const matches = block.match(/<p id="p\d+"[^>]*>.*?<\/p>/gis) || [];
    const joined = matches.join('\n');
    const converted = joined.replace(/<p id="p(\d+)"/gi, '<p id="L$1"');
    return cleanHtml(converted);
}

function divByClass(html, cls) {
    const re = new RegExp(`<div class="[^"]*\\b${cls}"[^>]*>(.*?)</div>`, 's');
    const m = html.match(re);
    return m ? m[1] : '';
}

/**
 * 話ページHTML -> { subtitle, preface, body, afterword }
 */
export function extractEpisode(html) {
    const subMatch = html.match(/<p class="widget-episodeTitle[^"]*">(.*?)<\/p>/s);
    const subtitle = subMatch ? stripTags(subMatch[1]) : '';

    const body = paragraphs(divByClass(html, 'js-episode-body'));
    const preface = paragraphs(divByClass(html, 'js-preface'));
    const afterword = paragraphs(divByClass(html, 'js-afterword'));

    return { subtitle, preface, body, afterword };
}
