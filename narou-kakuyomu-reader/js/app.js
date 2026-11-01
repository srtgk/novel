/**
 * app.js - Main Application Controller (v9 - Client-First & GitHub Pages Edition)
 * Pure client-side operation with IndexedDB storage and easy USB/File backup export/import.
 */

import { db } from './db.js';
import { api, SAMPLE_NOVEL, SAMPLE_CHAPTERS } from './api.js';
import { KakuyomuReader } from './reader.js';

class AppController {
    constructor() {
        this.currentView = 'library'; // 'library', 'detail', 'reader'
        this.currentNovel = null;
        this.reader = null;
        this.isDownloading = false;
        this.downloadAbort = false;

        this.init();
    }

    async init() {
        await db.init();
        await this.ensureSampleNovel();

        const readerContainer = document.getElementById('reader-screen');
        this.reader = new KakuyomuReader(readerContainer, () => {
            this.showDetailView(this.currentNovel.ncode);
        });

        this.bindEvents();

        // ローカル本棚を描画
        await this.renderLibrary();
    }

    async ensureSampleNovel() {
        const existing = await db.getNovel(SAMPLE_NOVEL.ncode);
        if (!existing) {
            await db.saveNovel(SAMPLE_NOVEL);
            for (const ch of SAMPLE_CHAPTERS) {
                await db.saveChapter(ch);
            }
        }
    }

    bindEvents() {
        // タブ切り替え（検索タブ / Nコード・カクヨム手動入力タブ）
        const tabSearch = document.getElementById('tab-btn-search');
        const tabNcode = document.getElementById('tab-btn-ncode');
        const formSearch = document.getElementById('form-search-novel');
        const formAdd = document.getElementById('form-add-novel');
        const searchResults = document.getElementById('search-results-list');

        tabSearch?.addEventListener('click', () => {
            tabSearch.classList.add('active');
            tabNcode.classList.remove('active');
            formSearch.classList.remove('hidden');
            formAdd.classList.add('hidden');
            if (searchResults && searchResults.innerHTML.trim() !== '') {
                searchResults.classList.remove('hidden');
            }
        });

        tabNcode?.addEventListener('click', () => {
            tabNcode.classList.add('active');
            tabSearch.classList.remove('active');
            formAdd.classList.remove('hidden');
            formSearch.classList.add('hidden');
            if (searchResults) {
                searchResults.classList.add('hidden');
            }
        });

        // 1. なろう作品キーワード検索フォーム
        formSearch?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('input-search-word');
            const word = input.value.trim();
            if (!word) return;

            const btn = document.getElementById('btn-search-submit');
            btn.disabled = true;
            btn.textContent = '検索中...';
            searchResults.classList.remove('hidden');
            searchResults.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>公式APIから作品を検索中...</p></div>';

            try {
                const results = await api.searchNovels(word);
                await this.renderSearchResults(results);
            } catch (err) {
                searchResults.innerHTML = `<div class="error-msg"><p>検索に失敗しました: ${this.escapeHtml(err.message)}</p></div>`;
            } finally {
                btn.disabled = false;
                btn.textContent = '検索';
            }
        });

        // 2. 作品直接追加フォーム（なろう・カクヨム両対応、端末IndexedDBに直接保存）
        formAdd?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('input-ncode');
            const rawVal = input.value.trim();
            if (!rawVal) return;

            const btn = document.getElementById('btn-add-submit');
            btn.disabled = true;
            btn.textContent = '作品を取得中...';

            try {
                const novel = await api.fetchNovelInfo(rawVal);
                await db.saveNovel(novel);

                // 第1話を自動先読み保存
                try {
                    const ch1 = await api.fetchChapter(novel.ncode, 1);
                    await db.saveChapter(ch1);
                } catch (e) {
                    console.warn('Failed to prefetch ep 1:', e);
                }

                input.value = '';
                await this.renderLibrary();
                this.showToast(`『${novel.title}』を本棚に追加しました！`);
            } catch (err) {
                alert(`作品の追加に失敗しました: ${err.message}`);
            } finally {
                btn.disabled = false;
                btn.textContent = '追加';
            }
        });

        // 3. 本棚内 リアルタイム絞り込みフィルター
        const filterInput = document.getElementById('input-library-filter');
        filterInput?.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            const cards = document.querySelectorAll('#novel-list .novel-card');
            cards.forEach(card => {
                const title = card.querySelector('.card-title')?.textContent?.toLowerCase() || '';
                const author = card.querySelector('.card-author')?.textContent?.toLowerCase() || '';
                const story = card.querySelector('.card-story')?.textContent?.toLowerCase() || '';
                if (!query || title.includes(query) || author.includes(query) || story.includes(query)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });

        // 4. バックアップ エクスポート（USB/ファイル保存）
        document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
            try {
                const res = await db.exportBackup();
                this.showToast(`バックアップを保存しました！（${res.novelCount}作品 / ${res.chapterCount}話）`);
            } catch (err) {
                alert('バックアップのエクスポートに失敗しました: ' + err.message);
            }
        });

        // 5. バックアップ インポート（USB/ファイル読み込み）
        const fileInput = document.getElementById('file-import-backup');
        document.getElementById('btn-import-backup')?.addEventListener('click', () => {
            fileInput?.click();
        });

        fileInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const res = await db.importBackup(data);
                await this.renderLibrary();
                this.showToast(`復元が完了しました！（${res.importedNovels}作品 / ${res.importedChapters}話）`);
            } catch (err) {
                alert('バックアップの復元に失敗しました: ' + err.message);
            } finally {
                fileInput.value = '';
            }
        });

        // 6. 作品詳細画面の削除ボタン
        document.getElementById('btn-delete-from-detail')?.addEventListener('click', async () => {
            if (!this.currentNovel) return;
            if (this.currentNovel.is_sample || this.currentNovel.ncode === 'sample01') {
                alert('サンプル作品は削除できません');
                return;
            }
            if (confirm(`『${this.currentNovel.title}』と端末内の全保存エピソードを削除しますか？`)) {
                await db.deleteNovel(this.currentNovel.ncode);
                this.showToast('作品を本棚から削除しました');
                this.showLibraryView();
            }
        });

        // 7. 常駐ダウンロードバーの中止ボタン
        document.getElementById('btn-floating-cancel')?.addEventListener('click', () => {
            if (this.isDownloading) {
                this.downloadAbort = true;
                this.showToast('ダウンロードを中止しています...');
            }
        });

        // 8. キャッシュ強制クリア & 最新化ボタン
        document.getElementById('btn-force-refresh')?.addEventListener('click', async () => {
            if (confirm('Service Workerと静的キャッシュを更新して最新版を再読み込みしますか？\n（※本棚に保存した小説データは消えません）')) {
                try {
                    if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const reg of regs) {
                            await reg.unregister();
                        }
                    }
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        for (const key of keys) {
                            await caches.delete(key);
                        }
                    }
                } catch (e) {
                    console.warn('Cache clear error:', e);
                }
                window.location.reload(true);
            }
        });

        // 9. プロキシ設定モーダルの開閉 & 保存
        const modalProxy = document.getElementById('modal-proxy');
        const inputProxy = document.getElementById('input-custom-proxy');
        document.getElementById('btn-open-proxy-modal')?.addEventListener('click', async () => {
            const currentProxy = await db.getSetting('custom_cors_proxy', '');
            if (inputProxy) inputProxy.value = currentProxy;
            modalProxy?.classList.remove('hidden');
        });

        const closeProxyModal = () => {
            modalProxy?.classList.add('hidden');
        };
        document.getElementById('modal-proxy-backdrop')?.addEventListener('click', closeProxyModal);
        document.getElementById('btn-close-proxy')?.addEventListener('click', closeProxyModal);

        document.getElementById('btn-save-proxy')?.addEventListener('click', async () => {
            const val = inputProxy?.value.trim() || '';
            await db.setSetting('custom_cors_proxy', val);
            closeProxyModal();
            this.showToast(val ? 'カスタムプロキシを設定しました' : 'プロキシ設定をクリア（デフォルト）しました');
        });

        // 戻るボタン（詳細画面からライブラリへ）
        document.getElementById('btn-detail-back')?.addEventListener('click', () => {
            this.showLibraryView();
        });
    }

    // --- 検索結果の描画 ---

    async renderSearchResults(results) {
        const container = document.getElementById('search-results-list');
        if (!container) return;

        if (!results || results.length === 0) {
            container.innerHTML = `
                <div class="search-result-card" style="text-align: center; color: #64748b;">
                    該当する作品が見つかりませんでした。別のキーワードをお試しください。
                </div>
            `;
            return;
        }

        const savedNovels = await db.getAllNovels();
        const savedNcodes = new Set(savedNovels.map(n => n.ncode));

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 12px; font-weight: 700; color: #475569;">検索結果 (${results.length}件)</span>
                <button type="button" id="btn-close-search-results" style="background: none; border: none; font-size: 12px; color: #64748b; cursor: pointer; padding: 4px;">✕ 閉じる</button>
            </div>
        ` + results.map(r => {
            const isSaved = savedNcodes.has(r.ncode);
            return `
                <div class="search-result-card" data-ncode="${r.ncode}">
                    <div class="search-result-title">${this.escapeHtml(r.title)}</div>
                    <div class="search-result-meta">
                        <span>作者: ${this.escapeHtml(r.writer || '不明')}</span>
                        <span>・</span>
                        <span>全 ${r.total_episodes || 1} 話</span>
                        <span>・</span>
                        <span>${r.ncode.toUpperCase()}</span>
                    </div>
                    <div class="search-result-story">${this.escapeHtml(r.story || '')}</div>
                    <button class="btn-add-search-novel ${isSaved ? 'already-saved' : ''}" data-ncode="${r.ncode}" ${isSaved ? 'disabled' : ''}>
                        ${isSaved ? '✓ 本棚に保存済' : '＋ 本棚に追加'}
                    </button>
                </div>
            `;
        }).join('');

        document.getElementById('btn-close-search-results')?.addEventListener('click', () => {
            container.classList.add('hidden');
        });

        container.querySelectorAll('.btn-add-search-novel:not(.already-saved)').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetBtn = e.currentTarget;
                const ncode = targetBtn.dataset.ncode;
                targetBtn.disabled = true;
                targetBtn.textContent = '追加中...';

                try {
                    const novel = await api.fetchNovelInfo(ncode);
                    await db.saveNovel(novel);
                    try {
                        const ch1 = await api.fetchChapter(novel.ncode, 1);
                        await db.saveChapter(ch1);
                    } catch (err) {}

                    targetBtn.textContent = '✓ 本棚に保存済';
                    targetBtn.classList.add('already-saved');
                    await this.renderLibrary();
                    this.showToast(`『${novel.title}』を本棚に追加しました！`);
                } catch (err) {
                    alert(`追加に失敗しました: ${err.message}`);
                    targetBtn.disabled = false;
                    targetBtn.textContent = '＋ 本棚に追加';
                }
            });
        });
    }

    // --- 画面切り替え ---

    updateDownloadBarVisibility() {
        const bar = document.getElementById('floating-download-bar');
        if (!bar) return;

        if (!this.isDownloading) {
            bar.classList.remove('active');
            return;
        }

        if (this.currentView === 'reader') {
            if (this.reader && this.reader.isHudVisible) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        } else {
            bar.classList.add('active');
        }
    }

    showLibraryView() {
        this.currentView = 'library';
        document.getElementById('library-screen').classList.remove('hidden');
        document.getElementById('detail-screen').classList.add('hidden');
        document.getElementById('reader-screen').classList.add('hidden');
        this.updateDownloadBarVisibility();
        this.renderLibrary();
    }

    async showDetailView(ncode) {
        this.currentView = 'detail';
        document.getElementById('library-screen').classList.add('hidden');
        document.getElementById('detail-screen').classList.remove('hidden');
        document.getElementById('reader-screen').classList.add('hidden');
        this.updateDownloadBarVisibility();

        const novel = await db.getNovel(ncode);
        this.currentNovel = novel;
        if (novel) {
            this.renderDetail(novel);
        }
    }

    async showReaderView(ncode, ep = 1, initialScroll = 0) {
        this.currentView = 'reader';
        document.getElementById('library-screen').classList.add('hidden');
        document.getElementById('detail-screen').classList.add('hidden');
        document.getElementById('reader-screen').classList.remove('hidden');
        this.updateDownloadBarVisibility();

        const novel = await db.getNovel(ncode);
        this.currentNovel = novel;
        await this.reader.openNovel(ncode, ep, initialScroll);
    }

    // --- ライブラリ画面描画 ---

    async renderLibrary() {
        const novels = await db.getAllNovels();
        const listEl = document.getElementById('novel-list');
        if (!listEl) return;

        if (novels.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <p class="empty-title">本棚に作品がありません</p>
                    <p class="empty-desc">上部の入力欄からNコード（例: n2267be）やカクヨムURLを入力して追加するか、USBのバックアップファイルを「復元」してください。</p>
                </div>
            `;
            return;
        }

        const cardsHtml = await Promise.all(novels.map(async (n) => {
            const isSample = (n.ncode === 'sample01');
            const isKakuyomu = n.source === 'kakuyomu' || (n.ncode && n.ncode.startsWith('kakuyomu_'));
            const sourceBadge = isSample
                ? '<span class="badge-source sample-tag">体験版</span>'
                : (isKakuyomu
                    ? '<span class="badge-source badge-kakuyomu">カクヨム</span>'
                    : '<span class="badge-source badge-narou">なろう</span>');

            const total = n.total_episodes || 1;
            const downloadedMap = await db.getDownloadedEpisodes(n.ncode);
            const downloaded = Object.keys(downloadedMap).length || n.downloaded_count || (isSample ? 3 : 0);
            const lastEp = n.last_read_ep || 1;
            const percent = n.last_read_percent || 0;

            return `
                <div class="novel-card" data-ncode="${n.ncode}">
                    <div class="card-header">
                        <div style="display: flex; align-items: center;">
                            ${sourceBadge}
                            <div class="card-badge ${downloaded >= total ? 'badge-downloaded' : 'badge-partial'}">
                                ${downloaded >= total ? '全話 保存済' : `${downloaded}/${total}話 保存`}
                            </div>
                        </div>
                        <span style="font-size: 11px; color: #0284c7; font-weight: 600;">📱 オフライン対応</span>
                        ${!isSample ? `<button class="btn-delete-novel" data-ncode="${n.ncode}" title="削除">✕</button>` : ''}
                    </div>
                    <h3 class="card-title">${this.escapeHtml(n.title)}</h3>
                    <p class="card-author">作者: ${this.escapeHtml(n.writer || '不明')}</p>
                    <p class="card-story">${this.escapeHtml(n.story || '')}</p>

                    <div class="card-progress-wrap">
                        <div class="card-progress-bar">
                            <div class="progress-fill" style="width: ${Math.min(100, Math.round((lastEp / total) * 100))}%"></div>
                        </div>
                        <div class="card-progress-text">
                            <span>読書進捗: 第 ${lastEp} 話 (${percent}%)</span>
                            <span>全 ${total} 話</span>
                        </div>
                    </div>

                    <div class="card-actions">
                        <button class="btn-primary btn-read-resume" data-ncode="${n.ncode}" data-ep="${lastEp}" data-scroll="${n.last_read_scroll || 0}">
                            ${n.last_read_ep ? `続きから読む (第${lastEp}話)` : '最初から読む'}
                        </button>
                        <button class="btn-secondary btn-show-detail" data-ncode="${n.ncode}">
                            目次・詳細
                        </button>
                    </div>
                </div>
            `;
        }));

        listEl.innerHTML = cardsHtml.join('');

        // イベントバインド
        listEl.querySelectorAll('.btn-read-resume').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ncode = e.currentTarget.dataset.ncode;
                const ep = parseInt(e.currentTarget.dataset.ep, 10);
                const scroll = parseInt(e.currentTarget.dataset.scroll, 10);
                this.showReaderView(ncode, ep, scroll);
            });
        });

        listEl.querySelectorAll('.btn-show-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ncode = e.currentTarget.dataset.ncode;
                this.showDetailView(ncode);
            });
        });

        listEl.querySelectorAll('.btn-delete-novel').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ncode = e.currentTarget.dataset.ncode;
                if (confirm('この作品と保存済みエピソードを本棚から削除しますか？')) {
                    await db.deleteNovel(ncode);
                    await this.renderLibrary();
                    this.showToast('作品を本棚から削除しました');
                }
            });
        });
    }

    // --- 作品詳細・目次画面描画 ---

    async renderDetail(novel) {
        document.getElementById('detail-title').textContent = novel.title;
        document.getElementById('detail-writer').textContent = `作者: ${novel.writer || '不明'}`;
        document.getElementById('detail-story').textContent = novel.story || '';

        const isKakuyomu = novel.source === 'kakuyomu' || (novel.ncode && novel.ncode.startsWith('kakuyomu_'));
        const sourceName = novel.is_sample ? '体験版' : (isKakuyomu ? 'カクヨム' : '小説家になろう');
        const total = novel.total_episodes || 1;
        const downloadedMap = await db.getDownloadedEpisodes(novel.ncode);
        const downloadedCount = Object.keys(downloadedMap).length;

        document.getElementById('detail-stats').innerHTML = `
            <span class="badge-source ${novel.is_sample ? 'sample-tag' : (isKakuyomu ? 'badge-kakuyomu' : 'badge-narou')}">${sourceName}</span>
            <span>全 ${total} 話</span>
            <span>・</span>
            <span class="${downloadedCount >= total ? 'text-green' : ''}">端末保存: ${downloadedCount}/${total} 話</span>
        `;

        const btnResume = document.getElementById('btn-detail-resume');
        const lastEp = novel.last_read_ep || 1;
        btnResume.textContent = novel.last_read_ep ? `続きから読む (第${lastEp}話)` : '最初から読む';
        btnResume.onclick = () => this.showReaderView(novel.ncode, lastEp, novel.last_read_scroll || 0);

        const btnFirst = document.getElementById('btn-detail-first');
        btnFirst.onclick = () => this.showReaderView(novel.ncode, 1, 0);

        const btnDownloadAll = document.getElementById('btn-download-all');
        btnDownloadAll.onclick = () => this.startBatchDownload(novel);

        // 目次の取得
        let episodes = [];
        try {
            const tocData = await api.fetchToc(novel.ncode);
            episodes = tocData.episodes || [];
        } catch (e) {
            console.warn('Failed to fetch TOC:', e);
            for (let ep = 1; ep <= total; ep++) {
                episodes.push({ ep, title: downloadedMap[ep] || `第 ${ep} 話` });
            }
        }

        const listEl = document.getElementById('detail-chapter-list');
        listEl.innerHTML = episodes.map(item => {
            const ep = item.ep;
            const isDownloaded = !!downloadedMap[ep];
            const isCurrentRead = (ep === novel.last_read_ep);

            return `
                <div class="chapter-item ${isCurrentRead ? 'current-reading' : ''}" data-ep="${ep}">
                    <div class="chapter-info">
                        <span class="chapter-num">${ep}</span>
                        <span class="chapter-name">${this.escapeHtml(item.title)}</span>
                    </div>
                    <div class="chapter-meta">
                        ${isDownloaded ? '<span class="badge-saved">保存済</span>' : '<span class="badge-not-saved">未保存</span>'}
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.chapter-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const ep = parseInt(e.currentTarget.dataset.ep, 10);
                this.showReaderView(novel.ncode, ep, 0);
            });
        });
    }

    // --- 一括ダウンロード機能 (端末ローカル保存) ---

    async startBatchDownload(novel) {
        if (this.isDownloading) {
            alert('他の作品をダウンロード中です。完了または中止するまでお待ちください。');
            return;
        }

        const total = novel.total_episodes || 1;
        if (total > 30) {
            if (!confirm(`全 ${total} 話の一括ダウンロードを開始しますか？\n（途中で中止することも可能です）`)) {
                return;
            }
        }

        this.isDownloading = true;
        this.downloadAbort = false;
        this.updateDownloadBarVisibility();

        const barTitle = document.getElementById('floating-dl-title');
        const barCount = document.getElementById('floating-dl-count');
        const barFill = document.getElementById('floating-dl-fill');

        barTitle.textContent = `『${novel.title}』ダウンロード中`;

        const downloadedMap = await db.getDownloadedEpisodes(novel.ncode);
        let successCount = Object.keys(downloadedMap).length;
        let failCount = 0;

        for (let ep = 1; ep <= total; ep++) {
            if (this.downloadAbort) {
                this.showToast('ダウンロードを中止しました');
                break;
            }

            // すでに端末に保存されていればスキップ
            if (downloadedMap[ep]) {
                const percent = Math.round((ep / total) * 100);
                barCount.textContent = `${ep} / ${total} 話 (${percent}%)`;
                barFill.style.width = `${percent}%`;
                continue;
            }

            try {
                const chapter = await api.fetchChapter(novel.ncode, ep);
                await db.saveChapter(chapter);
                successCount++;
            } catch (err) {
                console.error(`Failed to download ep ${ep}:`, err);
                failCount++;
            }

            const percent = Math.round((ep / total) * 100);
            barCount.textContent = `${ep} / ${total} 話 (${percent}%)`;
            barFill.style.width = `${percent}%`;

            // サーバー負荷軽減のウェイト (300ms)
            await new Promise(r => setTimeout(r, 300));
        }

        this.isDownloading = false;
        this.downloadAbort = false;
        this.updateDownloadBarVisibility();

        await this.renderLibrary();
        if (this.currentView === 'detail' && this.currentNovel?.ncode === novel.ncode) {
            this.renderDetail(this.currentNovel);
        }

        this.showToast(`ダウンロード完了: ${successCount}話 保存 (失敗: ${failCount}話)`);
    }

    // --- 目次モーダル表示 (showChapterListModal) ---
    async showChapterListModal(ncode) {
        ncode = ncode || this.currentNovel?.ncode;
        if (!ncode) return;

        const modal = document.getElementById('modal-toc');
        const modalList = document.getElementById('modal-toc-list');
        const modalBackdrop = document.getElementById('modal-toc-backdrop');
        const btnClose = document.getElementById('btn-close-toc-modal');

        if (!modal || !modalList) return;

        modal.classList.remove('hidden');
        modalList.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>目次を取得中...</p></div>';

        const closeModal = () => {
            modal.classList.add('hidden');
        };

        if (modalBackdrop) modalBackdrop.onclick = closeModal;
        if (btnClose) btnClose.onclick = closeModal;

        try {
            const downloadedMap = await db.getDownloadedEpisodes(ncode);
            const tocData = await api.fetchToc(ncode);
            const episodes = tocData.episodes || [];

            if (episodes.length === 0) {
                modalList.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">目次情報がありません</div>';
                return;
            }

            modalList.innerHTML = episodes.map(e => `
                <div class="toc-modal-item ${this.reader && this.reader.currentEp === e.ep ? 'selected' : ''}" data-ep="${e.ep}">
                    <span class="toc-ep">${e.ep}</span>
                    <span class="toc-title">${this.escapeHtml(e.title || downloadedMap[e.ep] || '（タイトルなし）')}</span>
                    ${e.chapter ? `<span style="font-size: 11px; color: #94a3b8; margin-left: 6px;">[${this.escapeHtml(e.chapter)}]</span>` : ''}
                </div>
            `).join('');

            modalList.querySelectorAll('.toc-modal-item').forEach(item => {
                item.onclick = async () => {
                    const ep = parseInt(item.dataset.ep, 10);
                    closeModal();
                    if (this.currentView === 'reader' && this.reader) {
                        await this.reader.loadChapter(ncode, ep, 0);
                    } else {
                        await this.showReaderView(ncode, ep, 0);
                    }
                };
            });
        } catch (e) {
            console.error('Failed to load TOC modal:', e);
            modalList.innerHTML = `<div class="error-msg"><p>目次の取得に失敗しました: ${this.escapeHtml(e.message)}</p></div>`;
        }
    }

    showToast(message) {
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.className = 'app-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3200);
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

// アプリケーション初期化
window.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
