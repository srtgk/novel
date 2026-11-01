#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Narou Kakuyomu-style Offline Reader Server (v7 - Kakuyomu Support & Server Storage Edition)
- Static file server for PWA
- Server-side centralized novel storage (shared across all devices & URLs)
- Narou & Kakuyomu scraping with automatic chapter caching
- Atomic file writes, retry mechanism, and status/batch retry APIs
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import gzip
import re
import socket
import os
import sys
import time
import threading
import traceback

import kakuyomu as ky

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(DIRECTORY, 'data')
LIBRARY_FILE = os.path.join(DATA_DIR, 'library.json')
CHAPTERS_DIR = os.path.join(DATA_DIR, 'chapters')

# スレッドセーフ用ロック
DB_LOCK = threading.Lock()

# Nコード / カクヨムキー正規表現
NCODE_RE = re.compile(r'^(n\d{4}[a-z]{2}|kakuyomu_\d{10,24}|sample01)$')

# 1リクエストあたりの最大取得話数（Cloudflare Tunnelタイムアウト対策）
MAX_RETRY_PER_CALL = 20

# レート制限用ロック & 最終リクエスト時刻記録
_FETCH_LOCK = threading.Lock()
_LAST_FETCH = {}

# サンプル小説データ
SAMPLE_NOVEL = {
    'ncode': 'sample01',
    'source': 'sample',
    'title': '【サンプル】異世界でオフラインリーダーを作ったら無双した件',
    'writer': 'カクヨム風開発者',
    'story': 'Android 16（Pixel 9a）を片手に異世界転移した主人公。電波の届かないダンジョンの中でも、事前のオフライン保存とカクヨム風のスワイプ次話移動により、ストレスゼロの快適な読書ライフを送っていた。これは、最下部スクロールに情熱を捧げた男の記録である。',
    'total_episodes': 3,
    'downloaded_count': 3,
    'last_read_ep': 1,
    'last_read_percent': 0,
    'is_sample': True,
    'updated_at': '2026-10-22T00:00:00'
}

SAMPLE_CHAPTERS = [
    {
        'ncode': 'sample01',
        'ep': 1,
        'subtitle': '第1話　気がつけばダンジョン、されど手元にはPixel 9a',
        'preface': '※この作品はカクヨム風リーダーの体験用サンプルエピソードです。',
        'body': '<p id="L1">目が覚めると、見知らぬ石造りの回廊に横たわっていた。</p>\n<p id="L2"><br></p>\n<p id="L3">「……ここは、どこだ？」</p>\n<p id="L4"><br></p>\n<p id="L5">ひんやりとした冷気と、薄暗い松明の光。どう見てもファンタジーRPGに出てくるダンジョンのそれである。</p>\n<p id="L6">だが、絶望する私の右ポケットには、確かな重みがあった。</p>\n<p id="L7"><br></p>\n<p id="L8">──最新鋭スマートフォン、Pixel 9a。</p>\n<p id="L9"><br></p>\n<p id="L10">画面を点灯させると、バッテリー残量は98%。だが当然のごとく『圏外』の文字が虚しく光っている。</p>\n<p id="L11">「くそっ、やっぱり電波はないか……いや、待てよ？」</p>\n<p id="L12"><br></p>\n<p id="L13">私はホーム画面に配置された、あのアイコンをタップした。</p>\n<p id="L14"><ruby>鳴動<rt>めいどう</rt></ruby>するアプリ──『カクヨム風オフラインリーダー』。</p>\n<p id="L15"><br></p>\n<p id="L16">「動く……！　サーバーに保存された小説が、外出先でもオフラインでも読めるぞ！」</p>',
        'afterword': '（下までスクロールして、さらに上に引き上げてみてください！バイブレーションとともに第2話へ進みます）'
    },
    {
        'ncode': 'sample01',
        'ep': 2,
        'subtitle': '第2話　引き上げて次話へ！　吸い付くようなオーバースクロール',
        'preface': '第1話からスムーズに遷移できましたでしょうか？',
        'body': '<p id="L1">ページの最下部に到達した状態で、私は親指をさらに上へとスワイプした。</p>\n<p id="L2"><br></p>\n<p id="L3">画面下部から、ふわりと現れるローディングリング。</p>\n<p id="L4">『引っ張って次の話へ』というガイドが、指の動きに合わせて心地よいバネのような抵抗感で追従してくる。</p>\n<p id="L5"><br></p>\n<p id="L6">ぐっ、と引き下げた瞬間──</p>\n<p id="L7"><br></p>\n<p id="L8">『トッ』</p>\n<p id="L9"><br></p>\n<p id="L10">端末の内蔵ハプティックモーターが、上品な振動を指先に返した。</p>',
        'afterword': '（次がサンプルの最終話です。最新話での特別な挙動もご確認ください）'
    },
    {
        'ncode': 'sample01',
        'ep': 3,
        'subtitle': '第3話　電波がなくても、物語は止まらない（完）',
        'preface': 'サンプル最終話です。',
        'body': '<p id="L1">「ふふふ……読書位置も自動的にサーバーと端末に同期されているな」</p>\n<p id="L2"><br></p>\n<p id="L3">一度アプリを閉じても、次に開けばミリ単位で前回のスクロール位置が復元される。</p>\n<p id="L4">魔王の城が近づこうが、ドラゴンの咆哮が轟こうが、私の読書ライフを妨げるものは何一つない。</p>\n<p id="L5"><br></p>\n<p id="L6">男はPixel 9aを大切に胸に抱き、新たな本棚への一歩を踏み出したのだった──。</p>\n<p id="L7"><br></p>\n<p id="L8">【終わり】</p>',
        'afterword': '最後までお読みいただきありがとうございます！上部の「戻る」ボタン、または画面タップメニューからライブラリへ戻れます。'
    }
]

# =============================================================================
# ユーティリティ関数
# =============================================================================

def save_json_atomic(path, data):
    """途中で止まっても壊れたファイルが残らないよう、一時ファイル経由で保存"""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def is_valid_chapter_file(path):
    """JSONとして読めて、本文が空でなければ有効"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return bool(data.get('body'))
    except Exception:
        return False

def init_storage():
    """データ保存用ディレクトリとライブラリファイルの初期化"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CHAPTERS_DIR, exist_ok=True)
    with DB_LOCK:
        if not os.path.exists(LIBRARY_FILE):
            save_library([SAMPLE_NOVEL])
        # サンプル話数の保存
        sample_ch_dir = os.path.join(CHAPTERS_DIR, 'sample01')
        os.makedirs(sample_ch_dir, exist_ok=True)
        for ch in SAMPLE_CHAPTERS:
            ch_path = os.path.join(sample_ch_dir, f"{ch['ep']}.json")
            if not os.path.exists(ch_path):
                save_json_atomic(ch_path, ch)

def load_library():
    """ライブラリJSONの読み込み"""
    if not os.path.exists(LIBRARY_FILE):
        return [SAMPLE_NOVEL]
    try:
        with open(LIBRARY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading library: {e}", flush=True)
        return [SAMPLE_NOVEL]

def save_library(novels):
    """ライブラリJSONの書き込み（アトミック）"""
    save_json_atomic(LIBRARY_FILE, novels)

def get_local_ip():
    """ローカルネットワーク内のIPアドレスを取得"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def resolve_work(raw):
    """入力(Nコード/URL/作品ID) -> (保存キー, 取得元)"""
    raw = (raw or '').strip().lower()
    work_id = ky.parse_input(raw)
    if work_id:
        return ky.KEY_PREFIX + work_id, 'kakuyomu'
    m = re.search(r'n\d{4}[a-z]{2}', raw)
    if m:
        return m.group(0), 'narou'
    if raw == 'sample01':
        return 'sample01', 'sample'
    return None, None

def fetch_url(url):
    """指定URLを取得（gzip対応、User-Agent付与）"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NarouKakuyomuReader/2.0"
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read()
        try:
            content = gzip.decompress(raw).decode('utf-8')
        except Exception:
            content = raw.decode('utf-8', errors='replace')
        return content

def fetch_url_retry(url, tries=3):
    """一時的なエラー（タイムアウト・429・5xx）だけ自動リトライ。404などは即座に失敗"""
    last = None
    for i in range(tries):
        try:
            return fetch_url(url)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(1.5 * (i + 1))
    raise last

def polite_fetch(url, min_interval=1.0):
    """同一ホストへのリクエストを1秒以上空ける"""
    host = urllib.parse.urlparse(url).netloc
    with _FETCH_LOCK:
        wait = _LAST_FETCH.get(host, 0) + min_interval - time.time()
        if wait > 0:
            time.sleep(wait)
        _LAST_FETCH[host] = time.time()
    return fetch_url_retry(url)

# =============================================================================
# カクヨム用ヘルパー
# =============================================================================

def ky_toc_path(key):
    return os.path.join(CHAPTERS_DIR, key, 'toc.json')

def ky_load_toc(key):
    try:
        with open(ky_toc_path(key), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def ky_refresh_work(key):
    """カクヨム作品ページを取得して目次を保存し、(info, toc) を返す"""
    work_id = key[len(ky.KEY_PREFIX):]
    html = polite_fetch(ky.work_url(work_id))
    info, toc = ky.parse_work_page(html, work_id)
    os.makedirs(os.path.join(CHAPTERS_DIR, key), exist_ok=True)
    save_json_atomic(ky_toc_path(key), toc)
    return info, toc

def ky_fetch_chapter(key, ep_num):
    """カクヨムの話ページを取得して整形辞書を返す"""
    work_id = key[len(ky.KEY_PREFIX):]
    toc = ky_load_toc(key) or ky_refresh_work(key)[1]
    entry = next((t for t in toc if t['ep'] == ep_num), None)
    if not entry:
        # 新着話の可能性があるので目次を更新して再確認
        toc = ky_refresh_work(key)[1]
        entry = next((t for t in toc if t['ep'] == ep_num), None)
    if not entry:
        raise Exception('目次にない話です')

    html = polite_fetch(ky.episode_url(work_id, entry['episode_id']))
    subtitle, preface, body, afterword = ky.extract_episode(html)
    if not body:
        raise Exception('本文の抽出に失敗しました（有料・会員限定の話か、構造が変わった可能性）')

    return {
        'ncode': key,
        'ep': ep_num,
        'episode_id': entry['episode_id'],
        'subtitle': subtitle or entry['title'] or f'第 {ep_num} 話',
        'preface': preface,
        'body': body,
        'afterword': afterword,
        'is_short_story': False
    }

# =============================================================================
# なろう用スクレイピング & 判定
# =============================================================================

def clean_novel_html(raw_html):
    """本文HTMLの安全化・ルビ等の整形"""
    if not raw_html:
        return ""
    cleaned = re.sub(r'<script.*?>.*?</script>', '', raw_html, flags=re.DOTALL)
    cleaned = re.sub(r'<style.*?>.*?</style>', '', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'<!--.*?-->', '', cleaned, flags=re.DOTALL)
    return cleaned.strip()

def extract_chapter_content(html):
    """なろうのHTMLからサブタイトル・まえがき・本文・あとがきを抽出（短編・連載両対応）"""
    # 1. サブタイトル
    sub_match = (
        re.search(r'<h1 class="p-novel__title[^"]*">(.*?)</h1>', html, re.DOTALL) or
        re.search(r'<p class="novel_subtitle">(.*?)</p>', html, re.DOTALL) or
        re.search(r'<p class="novel_title">(.*?)</p>', html, re.DOTALL)
    )
    subtitle = ""
    if sub_match:
        subtitle = re.sub(r'<[^>]+>', '', sub_match.group(1)).strip()

    # 2. まえがき
    preface = ""
    pref_match = (
        re.search(r'<div class="p-novel__text p-novel__text--preface"[^>]*>(.*?)</div>\s*<!--', html, re.DOTALL) or
        re.search(r'<div id="novel_p"[^>]*>(.*?)</div>\s*<!--', html, re.DOTALL) or
        re.search(r'<div class="p-novel__text p-novel__text--preface"[^>]*>(.*?)</div>', html, re.DOTALL) or
        re.search(r'<div id="novel_p"[^>]*>(.*?)</div>', html, re.DOTALL)
    )
    if pref_match:
        preface = clean_novel_html(pref_match.group(1))

    # 3. 本文
    body = ""
    body_match = (
        re.search(r'<div class="js-novel-text p-novel__text"[^>]*>(.*?)</div>\s*(?:<!--|</div>)', html, re.DOTALL) or
        re.search(r'<div id="novel_honbun"[^>]*>(.*?)</div>\s*<!--\s*#novel_honbun\s*-->', html, re.DOTALL) or
        re.search(r'<div id="novel_honbun"[^>]*>(.*?)</div>', html, re.DOTALL)
    )
    if body_match:
        body = clean_novel_html(body_match.group(1))
    else:
        paragraphs = re.findall(r'<p id="L\d+"[^>]*>.*?</p>', html, re.DOTALL)
        if paragraphs:
            body = clean_novel_html("\n".join(paragraphs))

    # 4. あとがき
    afterword = ""
    after_match = (
        re.search(r'<div class="p-novel__text p-novel__text--afterword"[^>]*>(.*?)</div>\s*<!--', html, re.DOTALL) or
        re.search(r'<div id="novel_a"[^>]*>(.*?)</div>\s*<!--', html, re.DOTALL) or
        re.search(r'<div class="p-novel__text p-novel__text--afterword"[^>]*>(.*?)</div>', html, re.DOTALL) or
        re.search(r'<div id="novel_a"[^>]*>(.*?)</div>', html, re.DOTALL)
    )
    if after_match:
        afterword = clean_novel_html(after_match.group(1))

    return subtitle, preface, body, afterword

def get_episode_status(ncode, total=None):
    """サーバー上の有効な話・壊れた話・未取得の話を判定"""
    ch_dir = os.path.join(CHAPTERS_DIR, ncode)
    ok, broken = set(), []
    if os.path.isdir(ch_dir):
        for fn in os.listdir(ch_dir):
            name, ext = os.path.splitext(fn)
            if ext != '.json' or not name.isdigit():
                continue  # .tmp や toc.json などは除外
            if is_valid_chapter_file(os.path.join(ch_dir, fn)):
                ok.add(int(name))
            else:
                broken.append(int(name))
    total = total or max(ok, default=0)
    missing = [ep for ep in range(1, total + 1) if ep not in ok]
    return sorted(ok), sorted(broken), missing

# =============================================================================
# HTTPリクエストハンドラー
# =============================================================================

class NarouRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        if hasattr(self, 'path') and (self.path.startswith('/sw.js') or self.path == '/' or '/index.html' in self.path):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def parse_json_body(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length == 0:
                return {}
            raw = self.rfile.read(length).decode('utf-8')
            return json.loads(raw)
        except Exception:
            return {}

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            # API ルーティング
            if path == '/api/library':
                self.handle_api_library()
            elif path == '/api/info':
                self.handle_api_info(query)
            elif path == '/api/chapter':
                self.handle_api_chapter(query)
            elif path == '/api/toc':
                self.handle_api_toc(query)
            elif path == '/api/search':
                self.handle_api_search(query)
            elif path == '/api/novel_status':
                self.handle_api_novel_status(query)
            elif path == '/api/tunnel_url':
                self.handle_api_tunnel_url()
            else:
                super().do_GET()
        except Exception as e:
            traceback.print_exc()
            self.send_json({'error': str(e)}, 500)

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == '/api/library/add':
                self.handle_api_library_add()
            elif path == '/api/library/delete':
                self.handle_api_library_delete()
            elif path == '/api/library/update_progress':
                self.handle_api_library_update_progress()
            elif path == '/api/library/retry':
                self.handle_api_library_retry()
            elif path == '/api/sync_from_client':
                self.handle_api_sync_from_client()
            else:
                self.send_json({'error': 'Not found'}, 404)
        except Exception as e:
            traceback.print_exc()
            self.send_json({'error': str(e)}, 500)

    # =========================================================================
    # 本棚（Library）API
    # =========================================================================

    def handle_api_library(self):
        """サーバーに保存されている全作品一覧を返却"""
        with DB_LOCK:
            novels = load_library()
            for n in novels:
                ncode = n.get('ncode')
                ch_dir = os.path.join(CHAPTERS_DIR, ncode)
                if os.path.isdir(ch_dir):
                    valid_eps = [
                        f for f in os.listdir(ch_dir)
                        if f.endswith('.json') and f[:-5].isdigit() and is_valid_chapter_file(os.path.join(ch_dir, f))
                    ]
                    n['downloaded_count'] = len(valid_eps)
            self.send_json({'novels': novels})

    def handle_api_library_add(self):
        """作品をサーバー本棚に追加し、即座に第1話をダウンロード保存"""
        data = self.parse_json_body()
        raw_input = data.get('ncode') or data.get('url') or ''
        key, source = resolve_work(raw_input)
        if not key or source == 'sample':
            self.send_json({'error': '有効なNコードまたは作品URLが見つかりません (例: n2267be, カクヨムURL)'}, 400)
            return

        novel_entry = None

        if source == 'kakuyomu':
            info, _ = ky_refresh_work(key)
            novel_entry = {
                'ncode': key,
                'source': 'kakuyomu',
                'title': info.get('title'),
                'writer': info.get('writer'),
                'story': info.get('story'),
                'catchphrase': info.get('catchphrase', ''),
                'total_episodes': info.get('total_episodes', 1),
                'genre': info.get('genre'),
                'keyword': info.get('keyword'),
                'novel_updated_at': info.get('novel_updated_at'),
                'general_firstup': info.get('general_firstup'),
                'last_read_ep': 1,
                'last_read_percent': 0,
                'downloaded_count': 0
            }
        else:  # narou
            ncode = key
            api_url = f"https://api.syosetu.com/novelapi/api/?out=json&ncode={ncode}&of=t-w-s-k-ga-gp-gl-nt"
            raw_json = fetch_url_retry(api_url)
            info = json.loads(raw_json)
            if not info or info[0].get('allcount', 0) == 0:
                self.send_json({'error': '小説家になろうに作品が見つかりませんでした'}, 404)
                return

            novel_info = info[1]
            novel_entry = {
                'ncode': ncode,
                'source': 'narou',
                'title': novel_info.get('title'),
                'writer': novel_info.get('writer'),
                'story': novel_info.get('story'),
                'total_episodes': novel_info.get('general_all_no', 0) or 1,
                'genre': novel_info.get('genre'),
                'keyword': novel_info.get('keyword'),
                'novel_updated_at': novel_info.get('novelupdated_at'),
                'general_firstup': novel_info.get('general_firstup'),
                'last_read_ep': 1,
                'last_read_percent': 0,
                'downloaded_count': 0
            }

        with DB_LOCK:
            novels = load_library()
            existing_idx = next((i for i, n in enumerate(novels) if n['ncode'] == key), None)
            if existing_idx is not None:
                novels[existing_idx].update(novel_entry)
            else:
                novels.insert(0, novel_entry)
            save_library(novels)

        # 第1話をバックグラウンドまたは即時ダウンロードしてサーバーに保存
        try:
            self.fetch_and_cache_chapter(key, 1)
        except Exception as e:
            print(f"Warning: Failed to pre-fetch ep 1 for {key}: {e}", flush=True)

        self.send_json({'success': True, 'novel': novel_entry})

    def handle_api_library_delete(self):
        """サーバー本棚から作品および保存済みエピソードを削除"""
        data = self.parse_json_body()
        raw_ncode = (data.get('ncode') or '').strip().lower()
        key, _ = resolve_work(raw_ncode)
        ncode = key or raw_ncode
        if not ncode or ncode == 'sample01':
            self.send_json({'error': '削除できない作品です'}, 400)
            return

        with DB_LOCK:
            novels = load_library()
            novels = [n for n in novels if n['ncode'] != ncode]
            save_library(novels)

            ch_dir = os.path.join(CHAPTERS_DIR, ncode)
            if os.path.exists(ch_dir):
                import shutil
                shutil.rmtree(ch_dir, ignore_errors=True)

        self.send_json({'success': True, 'ncode': ncode})

    def handle_api_library_update_progress(self):
        """読書進捗をサーバーに保存（端末間でしおり共有）"""
        data = self.parse_json_body()
        raw_ncode = data.get('ncode')
        key, _ = resolve_work(raw_ncode)
        ncode = key or raw_ncode
        ep = data.get('ep')
        percent = data.get('percent', 0)
        if not ncode:
            self.send_json({'error': 'ncode is required'}, 400)
            return

        with DB_LOCK:
            novels = load_library()
            for n in novels:
                if n['ncode'] == ncode:
                    if ep is not None:
                        n['last_read_ep'] = int(ep)
                    if percent is not None:
                        n['last_read_percent'] = int(percent)
                    break
            save_library(novels)

        self.send_json({'success': True})

    def handle_api_novel_status(self, query):
        """作品ごとの取得状況。missing が再取得対象"""
        raw_ncode = query.get('ncode', [''])[0].strip()
        ncode, _ = resolve_work(raw_ncode)
        if not ncode:
            self.send_json({'error': 'Invalid work id'}, 400)
            return

        with DB_LOCK:
            novel = next((n for n in load_library() if n.get('ncode') == ncode), None)
        total = novel.get('total_episodes') if novel else None
        ok, broken, missing = get_episode_status(ncode, total)
        self.send_json({
            'ncode': ncode,
            'total_episodes': total,
            'downloaded': len(ok),
            'broken': broken,
            'missing': missing
        })

    def handle_api_library_retry(self):
        """指定話（省略時は未取得全部）だけを順次取得。話ごとに成否を返す"""
        data = self.parse_json_body()
        raw_ncode = (data.get('ncode') or '').strip()
        ncode, source = resolve_work(raw_ncode)
        if not ncode or source == 'sample':
            self.send_json({'error': 'Invalid work id'}, 400)
            return

        eps = data.get('eps')
        if eps is None:
            with DB_LOCK:
                novel = next((n for n in load_library() if n.get('ncode') == ncode), None)
            _, _, eps = get_episode_status(ncode, novel.get('total_episodes') if novel else None)
        try:
            eps = sorted({int(e) for e in eps if int(e) >= 1})
        except (TypeError, ValueError):
            self.send_json({'error': 'Invalid eps'}, 400)
            return

        batch, remaining = eps[:MAX_RETRY_PER_CALL], eps[MAX_RETRY_PER_CALL:]
        chapters, failed = [], []
        for i, ep in enumerate(batch):
            try:
                chapters.append(self.fetch_and_cache_chapter(ncode, ep))
            except urllib.error.HTTPError as e:
                failed.append({'ep': ep, 'error': f'HTTP {e.code}', 'retryable': e.code != 404})
            except Exception as e:
                failed.append({'ep': ep, 'error': str(e), 'retryable': True})
            if i < len(batch) - 1:
                time.sleep(0.5)

        self.send_json({
            'ncode': ncode,
            'chapters': chapters,
            'failed': failed,
            'remaining': remaining
        })

    def handle_api_sync_from_client(self):
        """クライアントからのインポート処理（キー正規化対応）"""
        data = self.parse_json_body()
        novels = data.get('novels', [])
        chapters = data.get('chapters', [])

        imported_novels = 0
        imported_chapters = 0

        with DB_LOCK:
            current_library = load_library()
            existing_ncodes = {n['ncode'] for n in current_library}

            for n in novels:
                raw_ncode = n.get('ncode') or n.get('url') or ''
                key, _ = resolve_work(raw_ncode)
                if not key:
                    key = n.get('ncode')
                if not key or key == 'sample01':
                    continue

                n['ncode'] = key
                if key not in existing_ncodes:
                    current_library.append(n)
                    existing_ncodes.add(key)
                    imported_novels += 1

            save_library(current_library)

            for ch in chapters:
                raw_ncode = ch.get('ncode') or ''
                key, _ = resolve_work(raw_ncode)
                if not key:
                    key = raw_ncode
                if not key or key == 'sample01':
                    continue

                ch['ncode'] = key
                ep = ch.get('ep')
                if not ep:
                    continue

                ch_dir = os.path.join(CHAPTERS_DIR, key)
                os.makedirs(ch_dir, exist_ok=True)
                ch_file = os.path.join(ch_dir, f"{ep}.json")
                if not os.path.exists(ch_file):
                    save_json_atomic(ch_file, ch)
                    imported_chapters += 1

        self.send_json({
            'success': True,
            'imported_novels': imported_novels,
            'imported_chapters': imported_chapters
        })

    # =========================================================================
    # エピソード取得 & サーバー側自動キャッシュ
    # =========================================================================

    def fetch_and_cache_chapter(self, ncode, ep_num):
        """なろう・カクヨムからエピソードを取得し、サーバーの data/chapters/ に保存して返す"""
        ch_dir = os.path.join(CHAPTERS_DIR, ncode)
        os.makedirs(ch_dir, exist_ok=True)
        ch_file = os.path.join(ch_dir, f"{ep_num}.json")

        # すでにサーバーに有効なキャッシュがあればそれを返す
        if os.path.exists(ch_file):
            try:
                with open(ch_file, 'r', encoding='utf-8') as f:
                    cached = json.load(f)
                if cached.get('body'):
                    return cached
            except Exception:
                pass

        # カクヨムの場合
        if ncode.startswith(ky.KEY_PREFIX):
            result = ky_fetch_chapter(ncode, ep_num)
            save_json_atomic(ch_file, result)
            return result

        # なろうからスクレイピング
        url = f"https://ncode.syosetu.com/{ncode}/{ep_num}/"
        html = None
        is_short_story = False

        try:
            html = polite_fetch(url)
        except urllib.error.HTTPError as e:
            # 404の場合、第1話かつ短編（単一ページ小説）かどうかチェック
            if e.code == 404 and ep_num == 1:
                single_url = f"https://ncode.syosetu.com/{ncode}/"
                try:
                    html = polite_fetch(single_url)
                    is_short_story = True
                except Exception:
                    raise e
            else:
                raise e

        subtitle, preface, body, afterword = extract_chapter_content(html)
        if not subtitle:
            subtitle = "短編 本文" if is_short_story else f"第 {ep_num} 話"

        # 短編でbodyが空だった場合の再探索
        if not body and ep_num == 1 and not is_short_story:
            try:
                single_url = f"https://ncode.syosetu.com/{ncode}/"
                single_html = polite_fetch(single_url)
                _, p2, b2, a2 = extract_chapter_content(single_html)
                if b2:
                    body = b2
                    preface = p2
                    afterword = a2
                    subtitle = "短編 本文"
            except Exception:
                pass

        if not body:
            raise Exception("本文の抽出に失敗しました（作品が削除されているか、未公開の可能性があります）")

        result = {
            'ncode': ncode,
            'ep': ep_num,
            'subtitle': subtitle,
            'preface': preface,
            'body': body,
            'afterword': afterword,
            'is_short_story': is_short_story
        }

        # サーバー上にキャッシュ保存
        save_json_atomic(ch_file, result)
        return result

    def handle_api_chapter(self, query):
        """各話の本文取得API（サーバーキャッシュ優先＋自動保存）"""
        raw_ncode = query.get('ncode', [''])[0].strip()
        ep = query.get('ep', ['1'])[0].strip()

        key, source = resolve_work(raw_ncode)
        if not key:
            self.send_json({'error': 'Invalid work id'}, 400)
            return

        try:
            ep_num = int(ep)
        except ValueError:
            self.send_json({'error': 'Invalid episode number'}, 400)
            return

        try:
            result = self.fetch_and_cache_chapter(key, ep_num)
            self.send_json(result)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                self.send_json({'error': 'Episode not found (end of novel or invalid episode)'}, 404)
            else:
                self.send_json({'error': f'HTTP Error {e.code}'}, e.code)
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_api_info(self, query):
        """作品基本情報取得 (なろうAPI / カクヨム)"""
        raw = query.get('ncode', [''])[0].strip()
        key, source = resolve_work(raw)
        if not key:
            self.send_json({'error': 'Invalid work id format (e.g. n2267be, カクヨムURL)'}, 400)
            return

        if source == 'sample':
            self.send_json(SAMPLE_NOVEL)
            return

        if source == 'kakuyomu':
            try:
                info, _ = ky_refresh_work(key)
                self.send_json(info)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            return

        ncode = key
        api_url = f"https://api.syosetu.com/novelapi/api/?out=json&ncode={ncode}&of=t-w-s-k-ga-gp-gl-nt"
        try:
            raw_json = fetch_url_retry(api_url)
            info = json.loads(raw_json)
            if not info or info[0].get('allcount', 0) == 0:
                self.send_json({'error': 'Novel not found on Narou'}, 404)
                return

            novel = info[1]
            result = {
                'ncode': ncode,
                'source': 'narou',
                'title': novel.get('title'),
                'writer': novel.get('writer'),
                'story': novel.get('story'),
                'total_episodes': novel.get('general_all_no', 0) or 1,
                'genre': novel.get('genre'),
                'keyword': novel.get('keyword'),
                'novel_updated_at': novel.get('novelupdated_at'),
                'general_firstup': novel.get('general_firstup'),
            }
            self.send_json(result)
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_api_toc(self, query):
        """目次（サブタイトル一覧）の取得（なろうの全分割ページ巡回対応）"""
        raw = query.get('ncode', [''])[0].strip()
        key, source = resolve_work(raw)
        if not key:
            self.send_json({'error': 'Invalid work id'}, 400)
            return

        if source == 'sample':
            episodes = [{'ep': c['ep'], 'title': c['subtitle']} for c in SAMPLE_CHAPTERS]
            self.send_json({'ncode': 'sample01', 'episodes': episodes})
            return

        if source == 'kakuyomu':
            try:
                toc = ky_load_toc(key)
                if not toc:
                    _, toc = ky_refresh_work(key)
                self.send_json({
                    'ncode': key,
                    'episodes': [
                        {'ep': t['ep'], 'title': t['title'], 'chapter': t.get('chapter', '')}
                        for t in toc
                    ]
                })
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            return

        # なろう（全分割ページを巡回）
        ncode = key
        episodes = []
        page = 1

        while True:
            url = f"https://ncode.syosetu.com/{ncode}/" if page == 1 else f"https://ncode.syosetu.com/{ncode}/?p={page}"
            try:
                html = polite_fetch(url)
                items = re.findall(rf'href=["\']/{ncode}/(\d+)/["\'][^>]*>(.*?)</a>', html, re.DOTALL)
                if not items:
                    break
                added_in_page = 0
                for ep_str, title in items:
                    ep_num = int(ep_str)
                    clean_title = re.sub(r'<[^>]+>', '', title).strip()
                    if not any(e['ep'] == ep_num for e in episodes):
                        episodes.append({'ep': ep_num, 'title': clean_title})
                        added_in_page += 1
                if added_in_page == 0 or page >= 100:
                    break
                page += 1
            except Exception:
                break

        if not episodes:
            episodes = [{'ep': 1, 'title': '短編 本文'}]

        self.send_json({'ncode': ncode, 'episodes': episodes})

    def handle_api_search(self, query):
        """作品検索 (なろうAPI)"""
        word = query.get('word', [''])[0].strip()
        if not word:
            self.send_json({'error': 'word is required'}, 400)
            return

        encoded_word = urllib.parse.quote(word)
        api_url = f"https://api.syosetu.com/novelapi/api/?out=json&word={encoded_word}&lim=15&of=t-w-s-k-ga-gp-gl-nt-n"
        try:
            raw_json = fetch_url_retry(api_url)
            info = json.loads(raw_json)
            if not info or len(info) <= 1:
                self.send_json({'count': 0, 'results': []})
                return

            count = info[0].get('allcount', 0)
            results = []
            for item in info[1:]:
                results.append({
                    'ncode': item.get('ncode', '').lower(),
                    'source': 'narou',
                    'title': item.get('title'),
                    'writer': item.get('writer'),
                    'story': item.get('story'),
                    'total_episodes': item.get('general_all_no', 0) or 1,
                    'keyword': item.get('keyword'),
                })
            self.send_json({'count': count, 'results': results})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_api_tunnel_url(self):
        """現在のCloudflare TunnelのURLを取得して返却"""
        log_path = os.path.join(DIRECTORY, 'cloudflared.log')
        tunnel_url = None
        if os.path.exists(log_path):
            try:
                with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        m = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
                        if m:
                            tunnel_url = m.group(0)
            except Exception:
                pass
        self.send_json({'tunnel_url': tunnel_url})

def run_server():
    init_storage()
    local_ip = get_local_ip()
    handler = NarouRequestHandler
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
        print("=" * 60, flush=True)
        print(" 「なろう」カクヨム対応リーダー サーバー起動中 (v7 サーバー本棚共有版)", flush=True)
        print("=" * 60, flush=True)
        print(f" PCローカルURL:    http://localhost:{PORT}", flush=True)
        print(f" スマホ (Pixel 9a): http://{local_ip}:{PORT}", flush=True)
        print("=" * 60, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました。", flush=True)

if __name__ == '__main__':
    run_server()
