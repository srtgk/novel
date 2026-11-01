#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_tool.py - PC用作品ダウンロード & USBバックアップJSON生成ツール
作品URLまたはNコードを指定すると、全話を取得して
「リーダーアプリでインポート可能なバックアップJSONファイル」を直接生成します。
生成されたJSONファイルをUSBメモリ等でスマホに移して「📂 バックアップ復元」するだけで移行完了！
"""

import sys
import os
import json
import urllib.request
import urllib.parse
import re
import time
import gzip
from datetime import datetime

import kakuyomu as ky

def fetch_url(url, tries=3):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    last_err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as res:
                raw = res.read()
                try:
                    return gzip.decompress(raw).decode('utf-8')
                except Exception:
                    return raw.decode('utf-8', errors='replace')
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (i + 1))
    raise last_err

def clean_html(raw):
    if not raw:
        return ""
    s = re.sub(r'<script.*?>.*?</script>', '', raw, flags=re.DOTALL)
    s = re.sub(r'<style.*?>.*?</style>', '', s, flags=re.DOTALL)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.DOTALL)
    return s.strip()

def download_narou(ncode, max_ep=None):
    print(f"[なろう] 作品情報を取得中: {ncode}...")
    api_url = f"https://api.syosetu.com/novelapi/api/?out=json&ncode={ncode}&of=t-w-s-k-ga-gp-gl-nt"
    raw_json = fetch_url(api_url)
    info_list = json.loads(raw_json)
    if not info_list or len(info_list) <= 1:
        raise Exception("小説家になろうに作品が見つかりませんでした")

    item = info_list[1]
    total_episodes = item.get('general_all_no', 0) or 1
    target_count = min(total_episodes, max_ep) if max_ep else total_episodes

    novel_entry = {
        'ncode': ncode,
        'source': 'narou',
        'title': item.get('title'),
        'writer': item.get('writer'),
        'story': item.get('story'),
        'total_episodes': total_episodes,
        'genre': item.get('genre'),
        'keyword': item.get('keyword'),
        'novel_updated_at': item.get('novelupdated_at'),
        'general_firstup': item.get('general_firstup'),
        'last_read_ep': 1,
        'last_read_percent': 0,
        'downloaded_count': target_count
    }

    chapters = []
    print(f"『{novel_entry['title']}』 全 {target_count} 話をダウンロードします...")

    for ep in range(1, target_count + 1):
        url = f"https://ncode.syosetu.com/{ncode}/{ep}/"
        html = None
        is_short = False
        try:
            html = fetch_url(url)
        except urllib.error.HTTPError as e:
            if e.code == 404 and ep == 1:
                html = fetch_url(f"https://ncode.syosetu.com/{ncode}/")
                is_short = True
            else:
                print(f"  [Error] 第 {ep} 話の取得に失敗: {e}")
                continue

        # 要素抽出
        sub_match = (
            re.search(r'<h1 class="p-novel__title[^"]*">(.*?)</h1>', html, re.DOTALL) or
            re.search(r'<p class="novel_subtitle">(.*?)</p>', html, re.DOTALL) or
            re.search(r'<p class="novel_title">(.*?)</p>', html, re.DOTALL)
        )
        subtitle = re.sub(r'<[^>]+>', '', sub_match.group(1)).strip() if sub_match else f"第 {ep} 話"

        pref_match = re.search(r'<div class="p-novel__text p-novel__text--preface"[^>]*>(.*?)</div>', html, re.DOTALL)
        preface = clean_html(pref_match.group(1)) if pref_match else ""

        body_match = (
            re.search(r'<div class="js-novel-text p-novel__text"[^>]*>(.*?)</div>', html, re.DOTALL) or
            re.search(r'<div id="novel_honbun"[^>]*>(.*?)</div>', html, re.DOTALL)
        )
        if body_match:
            body = clean_html(body_match.group(1))
        else:
            paras = re.findall(r'<p id="L\d+"[^>]*>.*?</p>', html, re.DOTALL)
            body = clean_html("\n".join(paras)) if paras else ""

        after_match = re.search(r'<div class="p-novel__text p-novel__text--afterword"[^>]*>(.*?)</div>', html, re.DOTALL)
        afterword = clean_html(after_match.group(1)) if after_match else ""

        chapters.append({
            'id': f"{ncode}_{ep}",
            'ncode': ncode,
            'ep': ep,
            'subtitle': subtitle,
            'preface': preface,
            'body': body,
            'afterword': afterword,
            'downloaded_at': int(time.time() * 1000)
        })

        if ep % 10 == 0 or ep == target_count:
            print(f"  進捗: {ep} / {target_count} 話 完了")
        time.sleep(0.3)

    return novel_entry, chapters

def download_kakuyomu(work_id, max_ep=None):
    print(f"[カクヨム] 作品情報を取得中: {work_id}...")
    w_url = ky.work_url(work_id)
    html = fetch_url(w_url)
    info, toc = ky.parse_work_page(html, work_id)

    key = ky.KEY_PREFIX + work_id
    total_episodes = len(toc)
    target_toc = toc[:max_ep] if max_ep else toc
    target_count = len(target_toc)

    info['downloaded_count'] = target_count

    chapters = []
    print(f"『{info['title']}』 全 {target_count} 話をダウンロードします...")

    for i, t in enumerate(target_toc):
        ep = t['ep']
        ep_id = t['episode_id']
        ep_url = ky.episode_url(work_id, ep_id)
        try:
            ep_html = fetch_url(ep_url)
            sub, pref, body, aft = ky.extract_episode(ep_html)
            chapters.append({
                'id': f"{key}_{ep}",
                'ncode': key,
                'ep': ep,
                'episode_id': ep_id,
                'subtitle': sub or t['title'] or f"第 {ep} 話",
                'preface': pref,
                'body': body,
                'afterword': aft,
                'downloaded_at': int(time.time() * 1000)
            })
        except Exception as e:
            print(f"  [Error] 第 {ep} 話の取得失敗: {e}")

        if (i + 1) % 10 == 0 or (i + 1) == target_count:
            print(f"  進捗: {i + 1} / {target_count} 話 完了")
        time.sleep(0.5)

    return info, chapters

def main():
    if len(sys.argv) < 2:
        print("使用法:")
        print("  python export_tool.py <Nコード または カクヨムURL> [最大話数]")
        print("例:")
        print("  python export_tool.py n2267be")
        print("  python export_tool.py https://kakuyomu.jp/works/1177354054880238351 10")
        return

    raw_input = sys.argv[1]
    max_ep = int(sys.argv[2]) if len(sys.argv) > 2 else None

    # 判定
    ky_id = ky.parse_input(raw_input)
    if ky_id:
        novel, chapters = download_kakuyomu(ky_id, max_ep)
    else:
        m = re.search(r'n\d{4}[a-z]{2}', raw_input.lower())
        if m:
            novel, chapters = download_narou(m.group(0), max_ep)
        else:
            print(f"エラー: 有効なNコードまたはカクヨムURLが見つかりません: {raw_input}")
            return

    # バックアップJSONフォーマットの作成
    safe_title = re.sub(r'[\\/*?:"<>| ]', '_', novel['title'])[:30]
    out_filename = f"backup_{safe_title}_{novel['ncode']}.json"

    backup_data = {
        "app": "narou-kakuyomu-reader",
        "version": 9,
        "exported_at": datetime.now().isoformat(),
        "novel_count": 1,
        "chapter_count": len(chapters),
        "novels": [novel],
        "chapters": chapters,
        "settings": []
    }

    with open(out_filename, 'w', encoding='utf-8') as f:
        json.dump(backup_data, f, ensure_ascii=False, indent=2)

    print("\n==================================================")
    print(f" [完了] バックアップファイルを出力しました！")
    print(f" ファイル名: {out_filename}")
    print(f" 保存話数  : {len(chapters)} 話")
    print("==================================================")
    print("【スマホへの移行手順】")
    print(" 1. このJSONファイルをUSBメモリ・Google Drive等でスマホにコピー")
    print(" 2. スマホでリーダーアプリを開き、「バックアップ復元」をタップしてこのファイルを選択")
    print(" 3. 一瞬でスマホに作品と全話本文がインポートされます！")

if __name__ == "__main__":
    main()
