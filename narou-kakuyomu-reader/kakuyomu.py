# -*- coding: utf-8 -*-
"""
kakuyomu.py - カクヨムのページ解析モジュール（ネットワーク処理なし）

server.py から `import kakuyomu as ky` して使う。HTMLを渡すと辞書を返すだけの
純粋関数なので、HTMLを保存しておけばオフラインでテストできる。

確認済みの構造（2026-10 時点）
- 作品ページ  : Next.js製。<script id="__NEXT_DATA__"> の Apollo state に
                作品情報と全話の目次が入っている（DOMの目次は開いた章しか描画されない）
- 話ページ    : 従来型のサーバー描画HTML。本文は <div class="... js-episode-body"> 内の <p id="pN">
"""
import json
import re

BASE = 'https://kakuyomu.jp'
KEY_PREFIX = 'kakuyomu_'


# ---------------------------------------------------------------- URL / ID
def work_url(work_id):
    return f'{BASE}/works/{work_id}'


def episode_url(work_id, episode_id):
    return f'{BASE}/works/{work_id}/episodes/{episode_id}'


def parse_input(raw):
    """URL・作品ID・保存キー(kakuyomu_...) から作品IDを取り出す。該当しなければ None"""
    raw = (raw or '').strip()
    m = re.search(r'kakuyomu\.jp/works/(\d{16,20})', raw)
    if m:
        return m.group(1)
    m = re.fullmatch(r'(?:kakuyomu_)?(\d{16,20})', raw)
    return m.group(1) if m else None


# ---------------------------------------------------------------- 作品ページ
def _apollo_state(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
                  html, re.DOTALL)
    if not m:
        raise ValueError('__NEXT_DATA__ が見つかりません（ページ構造が変わったか、ログイン要求ページの可能性）')
    try:
        return json.loads(m.group(1))['props']['pageProps']['__APOLLO_STATE__']
    except (KeyError, ValueError) as e:
        raise ValueError(f'Apollo state を読めませんでした: {e}')


def _ref_id(node):
    """{"__ref": "Episode:123"} -> "123"。refでなければ None"""
    if isinstance(node, dict) and '__ref' in node:
        return node['__ref'].split(':', 1)[1]
    return None


def _deref(state, node):
    if isinstance(node, dict) and '__ref' in node:
        return state.get(node['__ref'])
    return node


def parse_work_page(html, work_id):
    """作品ページHTML -> (info, toc)

    info: server.py の本棚エントリ用の作品情報
    toc : [{'ep': 1始まりの通し番号, 'episode_id', 'title', 'chapter', 'published_at'}, ...]
    """
    state = _apollo_state(html)
    work = state.get(f'Work:{work_id}')
    if not work:
        raise ValueError(f'作品 {work_id} の情報が見つかりません（非公開・削除済みの可能性）')

    author = _deref(state, work.get('author')) or {}

    toc = []
    for ch_ref in work.get('tableOfContentsV2') or []:
        chapter_node = _deref(state, ch_ref) or {}
        chapter = _deref(state, chapter_node.get('chapter')) or {}
        chapter_title = chapter.get('title') or ''
        for ep_ref in chapter_node.get('episodeUnions') or []:
            ep_id = _ref_id(ep_ref)
            if not ep_id:
                continue
            ep = _deref(state, ep_ref) or {}   # 定義が欠けていてもIDはrefから取れる
            toc.append({
                'ep': len(toc) + 1,
                'episode_id': ep.get('id') or ep_id,
                'title': ep.get('title') or '',
                'chapter': chapter_title,
                'published_at': ep.get('publishedAt'),
            })

    if not toc:  # 保険: 目次データが無い場合はDOMのリンクから（タイトルは取れない）
        seen = []
        for eid in re.findall(rf'/works/{work_id}/episodes/(\d+)', html):
            if eid not in seen:
                seen.append(eid)
        toc = [{'ep': i + 1, 'episode_id': eid, 'title': '', 'chapter': '', 'published_at': None}
               for i, eid in enumerate(seen)]

    public_count = work.get('publicEpisodeCount')
    info = {
        'ncode': KEY_PREFIX + work_id,
        'source': 'kakuyomu',
        'title': work.get('title') or '',
        'writer': author.get('activityName') or author.get('name') or '',
        'story': work.get('introduction') or '',
        'catchphrase': work.get('catchphrase') or '',
        'total_episodes': len(toc) or public_count or 1,
        'genre': work.get('genre'),
        'keyword': ' '.join(work.get('tagLabels') or []),
        'novel_updated_at': work.get('lastEpisodePublishedAt'),
        'general_firstup': work.get('publishedAt'),
        'serial_status': work.get('serialStatus'),
        'total_characters': work.get('totalCharacterCount'),
    }
    if public_count and public_count != len(toc):
        info['warning'] = f'目次 {len(toc)} 話 / 公開話数 {public_count} 話で一致しません'
    return info, toc


# ---------------------------------------------------------------- 話ページ
def _strip_tags(s):
    return re.sub(r'<[^>]+>', '', s).strip()


def _clean(html):
    s = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL)
    s = re.sub(r'<style.*?>.*?</style>', '', s, flags=re.DOTALL)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.DOTALL)
    return s.strip()


def _paragraphs(block):
    """<p id="pN"> を、既存リーダーのなろう形式 (id="LN") に揃えて連結"""
    paras = re.findall(r'<p id="p\d+"[^>]*>.*?</p>', block, re.DOTALL)
    return _clean(re.sub(r'<p id="p(\d+)"', r'<p id="L\1"', '\n'.join(paras)))


def _div_by_class(html, cls):
    """class 属性が `cls` で *終わる* div の中身を返す。

    注意: 単純に 'js-episode-body' を含むかで探すと、手前にある
    <div class="widget-episode js-episode-body-container"> に誤マッチする。
    """
    m = re.search(rf'<div class="[^"]*\b{re.escape(cls)}"[^>]*>(.*?)</div>', html, re.DOTALL)
    return m.group(1) if m else ''


def extract_episode(html):
    """話ページHTML -> (subtitle, preface, body, afterword)

    preface / afterword のクラス名は、前書き・後書きが付いた話を未確認のため推定。
    取れなければ空文字を返すだけで本文取得には影響しない。
    """
    m = re.search(r'<p class="widget-episodeTitle[^"]*">(.*?)</p>', html, re.DOTALL)
    subtitle = _strip_tags(m.group(1)) if m else ''

    body = _paragraphs(_div_by_class(html, 'js-episode-body'))
    preface = _paragraphs(_div_by_class(html, 'js-preface'))
    afterword = _paragraphs(_div_by_class(html, 'js-afterword'))
    return subtitle, preface, body, afterword
