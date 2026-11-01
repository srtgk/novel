/**
 * Kakuyomu-style Reader Engine
 * Core features:
 * - Pull-to-next-chapter gesture at scroll bottom with haptic feedback
 * - Pull-to-prev-chapter gesture at scroll top
 * - Tap-to-toggle HUD (Header & Footer)
 * - Auto save/restore scroll position
 * - Customizable theme, font size, line-height, and vertical/horizontal reading
 */

import { db } from './db.js';
import { api } from './api.js';

export class KakuyomuReader {
    constructor(containerEl, onNavigateBack) {
        this.container = containerEl;
        this.onNavigateBack = onNavigateBack;

        // 状態管理
        this.currentNovel = null;
        this.currentEp = 1;
        this.totalEpisodes = 1;
        this.isHudVisible = false;
        this.isTransitioning = false;

        // タッチ / スワイプ追跡用
        this.touchStartY = 0;
        this.touchStartX = 0;
        this.touchCurrentY = 0;
        this.isPullingBottom = false;
        this.isPullingTop = false;
        this.pullDistance = 0;
        this.PULL_THRESHOLD = 38; // 次話へトリガーされるピクセル数（軽いスワイプで即座に反応）
        this.hasTriggeredHaptic = false;
        this.lastTouchToggleTime = 0; // 合成クリックによる二重発火防止用

        // マウスホイール蓄積用（PC用）
        this.wheelAccumulator = 0;
        this.wheelTimer = null;

        // スクロール保存用デバウンス
        this.scrollSaveTimer = null;

        // 設定のデフォルト
        this.settings = {
            theme: 'sepia', // 'light', 'sepia', 'dark', 'black'
            fontSize: 18,   // 14 to 26
            lineHeight: 1.85,
            fontFamily: 'mincho', // 'mincho', 'gothic', 'round'
            writingMode: 'horizontal', // 'horizontal', 'vertical'
            haptic: true
        };

        this.initDom();
        this.loadSettings();
    }

    async loadSettings() {
        const saved = await db.getSetting('readerSettings');
        if (saved) {
            this.settings = { ...this.settings, ...saved };
        }
        this.applySettingsToDom();
    }

    async saveSettings() {
        await db.setSetting('readerSettings', this.settings);
        this.applySettingsToDom();
    }

    applySettingsToDom() {
        const reader = document.getElementById('reader-view');
        if (!reader) return;

        // テーマクラス更新
        reader.classList.remove('theme-light', 'theme-sepia', 'theme-dark', 'theme-black');
        reader.classList.add(`theme-${this.settings.theme}`);

        // フォントファミリ
        reader.classList.remove('font-mincho', 'font-gothic', 'font-round');
        reader.classList.add(`font-${this.settings.fontFamily}`);

        // 縦書き / 横書き
        if (this.settings.writingMode === 'vertical') {
            reader.classList.add('writing-vertical');
        } else {
            reader.classList.remove('writing-vertical');
        }

        // 縦書き/横書きラベルの更新
        this.updateWritingModeLabel();

        // CSSカスタムプロパティ
        reader.style.setProperty('--novel-font-size', `${this.settings.fontSize}px`);
        reader.style.setProperty('--novel-line-height', `${this.settings.lineHeight}`);

        // Android ステータスバー / ナビゲーションバーのテーマカラー（画面下部のラインがベージュにならないよう常に黒固定）
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', '#000000');
        }
    }

    updateWritingModeLabel() {
        const label = document.getElementById('label-writing-mode');
        if (label) {
            label.textContent = this.settings.writingMode === 'vertical' ? '横書きへ' : '縦書きへ';
        }
    }

    initDom() {
        this.container.innerHTML = `
            <div id="reader-view" class="reader-container theme-sepia font-mincho">
                <!-- 上部HUD (ヘッダー) -->
                <header id="reader-header" class="reader-hud reader-header">
                    <button id="btn-reader-back" class="hud-btn" title="戻る">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <div class="hud-title-wrap">
                        <h2 id="reader-title-novel" class="hud-novel-title">作品タイトル</h2>
                        <span id="reader-title-chapter" class="hud-chapter-subtitle">第1話 サブタイトル</span>
                    </div>
                    <button id="btn-reader-toc" class="hud-btn" title="目次">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    </button>
                </header>

                <!-- メインスクロールエリア -->
                <div id="reader-scroller" class="reader-scroller">
                    <!-- 最上部オーバースクロールインジケーター (前の話へ) -->
                    <div id="pull-top-indicator" class="pull-indicator pull-top">
                        <div class="pull-indicator-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                        <span class="pull-text">引き下げて前の話へ</span>
                    </div>

                    <!-- 本文コンテンツラッパー -->
                    <article id="reader-content-wrap" class="reader-content-wrap">
                        <div id="reader-preface" class="novel-preface"></div>
                        <h1 id="reader-subtitle" class="novel-chapter-title"></h1>
                        <div id="reader-body" class="novel-body"></div>
                        <div id="reader-afterword" class="novel-afterword"></div>

                        <!-- 最終話用エンドメッセージ -->
                        <div id="reader-end-card" class="reader-end-card hidden">
                            <div class="end-card-icon">🎉</div>
                            <h3>最新話まで到達しました</h3>
                            <p>作品の更新をお待ちください</p>
                            <button id="btn-end-back" class="btn-primary">作品目次へ戻る</button>
                        </div>
                    </article>

                    <!-- 最下部オーバースクロールインジケーター (カクヨム風 次の話へ) -->
                    <div id="pull-bottom-indicator" class="pull-indicator pull-bottom">
                        <div class="pull-indicator-content">
                            <div class="pull-indicator-circle">
                                <svg class="progress-ring" width="40" height="40">
                                    <circle class="progress-ring-bg" stroke="currentColor" stroke-width="3" fill="transparent" r="16" cx="20" cy="20"/>
                                    <circle id="pull-progress-bar" class="progress-ring-bar" stroke="currentColor" stroke-width="3" fill="transparent" r="16" cx="20" cy="20"/>
                                </svg>
                                <div class="pull-arrow-icon">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                </div>
                            </div>
                            <div class="pull-text-wrap">
                                <span id="pull-status-label" class="pull-text">引っ張って次の話へ</span>
                                <span id="pull-next-title" class="pull-next-sub"></span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 下部HUD (フッター & ナビゲーション - カクヨム準拠) -->
                <footer id="reader-footer" class="reader-hud reader-footer">
                    <!-- 上段: シークバー & 前後話ナビゲーション -->
                    <div class="footer-seeker-row">
                        <button id="btn-prev-ep" class="ep-nav-btn" title="前の話">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                            <span>前話</span>
                        </button>
                        <div class="seeker-slider-wrap">
                            <input type="range" id="chapter-seeker" min="1" max="1" value="1" class="chapter-seeker-range">
                            <div class="ep-counter-wrap">
                                第 <span id="footer-ep-current">1</span> / <span id="footer-ep-total">1</span> 話
                            </div>
                        </div>
                        <button id="btn-next-ep" class="ep-nav-btn" title="次の話">
                            <span>次話</span>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>

                    <!-- 下段: カクヨム風ボトムアクションバー -->
                    <div class="footer-actions-row">
                        <button id="btn-footer-toc" class="footer-action-pill" title="目次を開く">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                            <span>目次</span>
                        </button>
                        <button id="btn-toggle-writing-mode" class="footer-action-pill" title="縦書き/横書き切替">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
                            <span id="label-writing-mode">縦書きへ</span>
                        </button>
                        <button id="btn-open-settings" class="footer-action-pill" title="文字・背景設定">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            <span>文字・背景</span>
                        </button>
                    </div>
                </footer>

                <!-- 設定ボトムシートモーダル -->
                <div id="reader-settings-sheet" class="settings-sheet hidden">
                    <div class="sheet-backdrop" id="sheet-backdrop"></div>
                    <div class="sheet-content">
                        <div class="sheet-handle"></div>
                        <h3 class="sheet-title">表示設定</h3>

                        <!-- テーマ選択 -->
                        <div class="setting-group">
                            <label class="setting-label">テーマ</label>
                            <div class="theme-picker">
                                <button class="theme-btn theme-btn-light" data-theme="light">白</button>
                                <button class="theme-btn theme-btn-sepia selected" data-theme="sepia">セピア</button>
                                <button class="theme-btn theme-btn-dark" data-theme="dark">ダーク</button>
                                <button class="theme-btn theme-btn-black" data-theme="black">漆黒</button>
                            </div>
                        </div>

                        <!-- 文字サイズ -->
                        <div class="setting-group">
                            <div class="setting-label-row">
                                <label class="setting-label">文字サイズ</label>
                                <span id="font-size-val">18px</span>
                            </div>
                            <div class="slider-control">
                                <button id="btn-font-decrease" class="step-btn">小</button>
                                <input type="range" id="font-size-slider" min="14" max="26" step="1" value="18">
                                <button id="btn-font-increase" class="step-btn">大</button>
                            </div>
                        </div>

                        <!-- 行間 -->
                        <div class="setting-group">
                            <label class="setting-label">行間</label>
                            <div class="segmented-control">
                                <button class="seg-btn" data-lh="1.6">狭め</button>
                                <button class="seg-btn selected" data-lh="1.85">標準</button>
                                <button class="seg-btn" data-lh="2.2">広め</button>
                            </div>
                        </div>

                        <!-- フォントファミリー -->
                        <div class="setting-group">
                            <label class="setting-label">フォント</label>
                            <div class="segmented-control">
                                <button class="seg-btn selected" data-font="mincho">明朝体</button>
                                <button class="seg-btn" data-font="gothic">ゴシック</button>
                                <button class="seg-btn" data-font="round">丸ゴシック</button>
                            </div>
                        </div>

                        <!-- 縦書き / 横書き -->
                        <div class="setting-group">
                            <label class="setting-label">文字方向</label>
                            <div class="segmented-control">
                                <button class="seg-btn selected" data-mode="horizontal">横書き</button>
                                <button class="seg-btn" data-mode="vertical">縦書き</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const scroller = document.getElementById('reader-scroller');
        const header = document.getElementById('reader-header');
        const footer = document.getElementById('reader-footer');

        // 戻るボタン
        document.getElementById('btn-reader-back').addEventListener('click', () => {
            if (this.onNavigateBack) this.onNavigateBack();
        });

        // 目次ボタン
        document.getElementById('btn-reader-toc').addEventListener('click', () => {
            window.app.showChapterListModal(this.currentNovel.ncode);
        });

        // 前話・次話ボタン
        document.getElementById('btn-prev-ep').addEventListener('click', () => this.goToPrevChapter());
        document.getElementById('btn-next-ep').addEventListener('click', () => this.goToNextChapter());
        document.getElementById('btn-end-back').addEventListener('click', () => {
            if (this.onNavigateBack) this.onNavigateBack();
        });

        // フッター目次ボタン
        document.getElementById('btn-footer-toc')?.addEventListener('click', () => {
            window.app.showChapterListModal(this.currentNovel.ncode);
        });

        // 縦書き/横書きトグルボタン
        document.getElementById('btn-toggle-writing-mode')?.addEventListener('click', () => {
            const nextMode = this.settings.writingMode === 'vertical' ? 'horizontal' : 'vertical';
            this.settings.writingMode = nextMode;
            this.saveSettings();
            this.updateWritingModeLabel();
        });

        // エピソードシークバー
        const seeker = document.getElementById('chapter-seeker');
        if (seeker) {
            seeker.addEventListener('input', (e) => {
                const epVal = parseInt(e.target.value, 10);
                document.getElementById('footer-ep-current').textContent = epVal;
            });
            seeker.addEventListener('change', (e) => {
                const epVal = parseInt(e.target.value, 10);
                if (epVal !== this.currentEp) {
                    this.loadChapter(this.currentNovel.ncode, epVal, 0);
                }
            });
        }

        // 画面タップでHUDトグル（1本指タップで確実にトグル、微小スクロール許容、合成クリック二重発火防止）
        let touchDownTime = 0;
        let isSingleTouch = false;
        let startX = 0;
        let startY = 0;

        scroller.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                isSingleTouch = true;
                touchDownTime = Date.now();
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            } else {
                isSingleTouch = false;
            }
            this.handleTouchStart(e);
        }, { passive: false });

        scroller.addEventListener('touchmove', (e) => {
            this.handleTouchMove(e);
        }, { passive: false });

        scroller.addEventListener('touchend', (e) => {
            if (isSingleTouch && e.changedTouches.length > 0) {
                const tapDuration = Date.now() - touchDownTime;
                const movedDist = Math.hypot(
                    e.changedTouches[0].clientX - startX,
                    e.changedTouches[0].clientY - startY
                );

                // 1本指タップ: 450ms以内、移動距離40px以内（指のブレや微小スクロールを完全許容）
                if (tapDuration < 450 && movedDist < 40) {
                    const target = e.target;
                    // HUD内のボタンやシート、モーダルのタップは除外
                    if (!target.closest('.reader-hud') && !target.closest('.settings-sheet') && !target.closest('.app-modal') && target.tagName !== 'BUTTON' && target.tagName !== 'A') {
                        this.lastTouchToggleTime = Date.now();
                        this.toggleHud();
                    }
                }
            }

            this.handleTouchEnd(e);
            isSingleTouch = false;
        });

        // PCマウス・ホイールおよびクリック（タッチ後の合成クリックは二重発火防止ガード）
        scroller.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        scroller.addEventListener('click', (e) => {
            // タッチ直後（600ms以内）の合成クリックは無視（二重発火防止）
            if (Date.now() - this.lastTouchToggleTime < 600) {
                return;
            }
            if (window.getSelection().toString().length === 0 && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && !e.target.closest('.reader-hud') && !e.target.closest('.settings-sheet')) {
                this.toggleHud();
            }
        });

        // スクロール位置の自動記録
        scroller.addEventListener('scroll', () => {
            clearTimeout(this.scrollSaveTimer);
            this.scrollSaveTimer = setTimeout(() => {
                this.saveCurrentProgress();
            }, 300);
        });

        // 設定シートの開閉
        document.getElementById('btn-open-settings').addEventListener('click', () => this.openSettingsSheet());
        document.getElementById('sheet-backdrop').addEventListener('click', () => this.closeSettingsSheet());

        // 設定の変更ハンドラ
        this.bindSettingEvents();
    }

    bindSettingEvents() {
        // テーマ切り替え
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const theme = e.currentTarget.dataset.theme;
                this.settings.theme = theme;
                document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.saveSettings();
            });
        });

        // 文字サイズスライダー
        const fontSlider = document.getElementById('font-size-slider');
        const fontVal = document.getElementById('font-size-val');
        fontSlider.addEventListener('input', (e) => {
            const size = parseInt(e.target.value, 10);
            this.settings.fontSize = size;
            fontVal.textContent = `${size}px`;
            this.saveSettings();
        });

        document.getElementById('btn-font-decrease').addEventListener('click', () => {
            if (this.settings.fontSize > 14) {
                this.settings.fontSize--;
                fontSlider.value = this.settings.fontSize;
                fontVal.textContent = `${this.settings.fontSize}px`;
                this.saveSettings();
            }
        });

        document.getElementById('btn-font-increase').addEventListener('click', () => {
            if (this.settings.fontSize < 26) {
                this.settings.fontSize++;
                fontSlider.value = this.settings.fontSize;
                fontVal.textContent = `${this.settings.fontSize}px`;
                this.saveSettings();
            }
        });

        // 行間切り替え
        document.querySelectorAll('.segmented-control button[data-lh]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lh = parseFloat(e.currentTarget.dataset.lh);
                this.settings.lineHeight = lh;
                e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.saveSettings();
            });
        });

        // フォント切り替え
        document.querySelectorAll('.segmented-control button[data-font]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const font = e.currentTarget.dataset.font;
                this.settings.fontFamily = font;
                e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.saveSettings();
            });
        });

        // 縦書き / 横書き
        document.querySelectorAll('.segmented-control button[data-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                this.settings.writingMode = mode;
                e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.saveSettings();
            });
        });
    }

    // --- カクヨム風「引っ張って次話へ」タッチジェスチャーのハンドリング ---

    handleTouchStart(e) {
        if (this.isTransitioning) return;
        this.touchStartY = e.touches[0].clientY;
        this.touchStartX = e.touches[0].clientX;
        this.pullDistance = 0;
        this.isPullingBottom = false;
        this.isPullingTop = false;
        this.hasTriggeredHaptic = false;
    }

    handleTouchMove(e) {
        if (this.isTransitioning) return;
        const scroller = document.getElementById('reader-scroller');
        const currentY = e.touches[0].clientY;
        const diffY = currentY - this.touchStartY;

        const isAtBottom = (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5);
        const isAtTop = (scroller.scrollTop <= 5);

        // 最下部に達している状態で上にスワイプ (diffY < 0) -> 次の話へ引っ張り
        if (isAtBottom && diffY < 0) {
            e.preventDefault();
            this.isPullingBottom = true;

            // 軽い力・短いスクロール量でスッと反応
            const rawPull = -diffY;
            this.pullDistance = Math.min(rawPull * 0.95, 80);

            this.updatePullBottomUI(this.pullDistance);
        }
        // 最上部に達している状態で下にスワイプ (diffY > 0) -> 前の話へ引っ張り (第2話以降)
        else if (isAtTop && diffY > 0 && this.currentEp > 1) {
            e.preventDefault();
            this.isPullingTop = true;
            this.pullDistance = Math.min(diffY * 0.95, 80);
            this.updatePullTopUI(this.pullDistance);
        } else {
            this.resetPullUI();
        }
    }

    handleTouchEnd(e) {
        if (this.isTransitioning) return;

        if (this.isPullingBottom) {
            if (this.pullDistance >= this.PULL_THRESHOLD) {
                // しきい値達成！ 次の話へ遷移
                this.triggerNextChapterTransition();
            } else {
                this.resetPullUI(true);
            }
        } else if (this.isPullingTop) {
            if (this.pullDistance >= this.PULL_THRESHOLD) {
                // 前の話へ遷移
                this.triggerPrevChapterTransition();
            } else {
                this.resetPullUI(true);
            }
        }
        this.isPullingBottom = false;
        this.isPullingTop = false;
    }

    // PCマウスホイールによる次話トリガー
    handleWheel(e) {
        if (this.isTransitioning) return;
        const scroller = document.getElementById('reader-scroller');
        const isAtBottom = (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2);

        if (isAtBottom && e.deltaY > 0) {
            // 最下部での追加スクロール（軽いスクロールで即反応）
            this.wheelAccumulator += e.deltaY;
            this.updatePullBottomUI(Math.min(this.wheelAccumulator, 60));

            clearTimeout(this.wheelTimer);
            if (this.wheelAccumulator >= 45) {
                e.preventDefault();
                this.triggerNextChapterTransition();
                this.wheelAccumulator = 0;
            } else {
                this.wheelTimer = setTimeout(() => {
                    this.wheelAccumulator = 0;
                    this.resetPullUI(true);
                }, 300);
            }
        }
    }

    updatePullBottomUI(distance) {
        const indicator = document.getElementById('pull-bottom-indicator');
        const progressBar = document.getElementById('pull-progress-bar');
        const label = document.getElementById('pull-status-label');
        const wrap = document.getElementById('reader-content-wrap');

        if (!indicator || !wrap) return;

        // コンテンツ全体を上にシフト（カクヨム風の吸い付く引き上げ）
        const clampedDist = Math.min(distance, 100);
        wrap.style.transform = `translateY(-${clampedDist}px)`;
        indicator.style.transform = `translateY(-${clampedDist}px)`;
        indicator.classList.add('visible');

        // 円形プログレスリングの計算 (r=16, 2*PI*16 ≈ 100.5)
        const circumference = 2 * Math.PI * 16;
        const ratio = Math.min(distance / this.PULL_THRESHOLD, 1);
        const dashoffset = circumference * (1 - ratio);
        progressBar.style.strokeDashoffset = dashoffset;

        if (this.currentEp >= this.totalEpisodes) {
            label.textContent = '最新話に到達しました';
            return;
        }

        if (distance >= this.PULL_THRESHOLD) {
            label.textContent = '離して次の話へ！';
            indicator.classList.add('ready');

            // 境界到達時に1度だけバイブレーション（触覚フィードバック）
            if (!this.hasTriggeredHaptic && this.settings.haptic && navigator.vibrate) {
                navigator.vibrate(20);
                this.hasTriggeredHaptic = true;
            }
        } else {
            label.textContent = '引っ張って次の話へ';
            indicator.classList.remove('ready');
            this.hasTriggeredHaptic = false;
        }
    }

    updatePullTopUI(distance) {
        const indicator = document.getElementById('pull-top-indicator');
        const wrap = document.getElementById('reader-content-wrap');
        if (!indicator || !wrap) return;

        const clampedDist = Math.min(distance, 80);
        wrap.style.transform = `translateY(${clampedDist}px)`;
        indicator.classList.add('visible');

        if (distance >= this.PULL_THRESHOLD) {
            indicator.querySelector('.pull-text').textContent = '離して前の話へ！';
            if (!this.hasTriggeredHaptic && this.settings.haptic && navigator.vibrate) {
                navigator.vibrate(20);
                this.hasTriggeredHaptic = true;
            }
        } else {
            indicator.querySelector('.pull-text').textContent = '引き下げて前の話へ';
            this.hasTriggeredHaptic = false;
        }
    }

    resetPullUI(animate = false) {
        const wrap = document.getElementById('reader-content-wrap');
        const indicatorBottom = document.getElementById('pull-bottom-indicator');
        const indicatorTop = document.getElementById('pull-top-indicator');

        if (animate) {
            if (wrap) wrap.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
            if (indicatorBottom) indicatorBottom.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
        }

        if (wrap) wrap.style.transform = '';
        if (indicatorBottom) {
            indicatorBottom.style.transform = '';
            indicatorBottom.classList.remove('visible', 'ready');
        }
        if (indicatorTop) indicatorTop.classList.remove('visible');

        setTimeout(() => {
            if (wrap) wrap.style.transition = '';
            if (indicatorBottom) indicatorBottom.style.transition = '';
        }, 260);
    }

    triggerNextChapterTransition() {
        if (this.currentEp >= this.totalEpisodes) {
            this.resetPullUI(true);
            return;
        }

        this.isTransitioning = true;
        const wrap = document.getElementById('reader-content-wrap');
        // スライドアップアウト
        wrap.classList.add('transition-slide-out-up');

        setTimeout(async () => {
            this.resetPullUI(false);
            await this.loadChapter(this.currentNovel.ncode, this.currentEp + 1);
            wrap.classList.remove('transition-slide-out-up');
            wrap.classList.add('transition-slide-in-up');

            setTimeout(() => {
                wrap.classList.remove('transition-slide-in-up');
                this.isTransitioning = false;
            }, 300);
        }, 250);
    }

    triggerPrevChapterTransition() {
        if (this.currentEp <= 1) {
            this.resetPullUI(true);
            return;
        }

        this.isTransitioning = true;
        const wrap = document.getElementById('reader-content-wrap');
        wrap.classList.add('transition-slide-out-down');

        setTimeout(async () => {
            this.resetPullUI(false);
            await this.loadChapter(this.currentNovel.ncode, this.currentEp - 1);
            wrap.classList.remove('transition-slide-out-down');
            wrap.classList.add('transition-slide-in-down');

            setTimeout(() => {
                wrap.classList.remove('transition-slide-in-down');
                this.isTransitioning = false;
            }, 300);
        }, 250);
    }

    // --- チャプター読み込みと表示 ---

    async openNovel(ncode, startEp = 1, initialScroll = 0) {
        let novel = await db.getNovel(ncode);
        if (!novel) {
            // DBにまだない場合はAPIから取得して保存
            novel = await api.fetchNovelInfo(ncode);
            await db.saveNovel(novel);
        }

        this.currentNovel = novel;
        this.totalEpisodes = novel.total_episodes || 1;

        document.getElementById('reader-title-novel').textContent = novel.title;
        document.getElementById('footer-ep-total').textContent = this.totalEpisodes;

        await this.loadChapter(ncode, startEp, initialScroll);
    }

    async loadChapter(ncode, ep, initialScroll = 0) {
        this.currentEp = parseInt(ep, 10);
        const scroller = document.getElementById('reader-scroller');
        const subtitleEl = document.getElementById('reader-subtitle');
        const prefaceEl = document.getElementById('reader-preface');
        const bodyEl = document.getElementById('reader-body');
        const afterwordEl = document.getElementById('reader-afterword');
        const headerSubEl = document.getElementById('reader-title-chapter');
        const footerCurrentEl = document.getElementById('footer-ep-current');
        const endCard = document.getElementById('reader-end-card');

        footerCurrentEl.textContent = this.currentEp;

        const seeker = document.getElementById('chapter-seeker');
        if (seeker) {
            seeker.max = this.totalEpisodes;
            seeker.value = this.currentEp;
        }

        // まずローカルIndexedDBから取得
        let chapter = await db.getChapter(ncode, this.currentEp);

        if (!chapter) {
            // ローカルになければAPI経由で取得
            bodyEl.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>第 ${this.currentEp} 話を取得中...</p></div>`;
            try {
                chapter = await api.fetchChapter(ncode, this.currentEp);
                await db.saveChapter(chapter);
            } catch (err) {
                bodyEl.innerHTML = `
                    <div class="error-msg">
                        <p>エピソードの取得に失敗しました</p>
                        <p class="error-detail">${err.message}</p>
                        <button id="btn-retry-ch" class="btn-primary">再試行</button>
                    </div>
                `;
                document.getElementById('btn-retry-ch')?.addEventListener('click', () => {
                    this.loadChapter(ncode, ep);
                });
                return;
            }
        }

        // DOMに描画
        subtitleEl.textContent = chapter.subtitle;
        headerSubEl.textContent = chapter.subtitle;

        // まえがき
        if (chapter.preface && chapter.preface.trim().length > 0) {
            prefaceEl.innerHTML = chapter.preface;
            prefaceEl.classList.remove('hidden');
        } else {
            prefaceEl.innerHTML = '';
            prefaceEl.classList.add('hidden');
        }

        // 本文
        bodyEl.innerHTML = chapter.body;

        // あとがき
        if (chapter.afterword && chapter.afterword.trim().length > 0) {
            afterwordEl.innerHTML = chapter.afterword;
            afterwordEl.classList.remove('hidden');
        } else {
            afterwordEl.innerHTML = '';
            afterwordEl.classList.add('hidden');
        }

        // 最終話ならエンドカード表示
        if (this.currentEp >= this.totalEpisodes) {
            endCard.classList.remove('hidden');
            document.getElementById('pull-bottom-indicator').classList.add('is-last');
        } else {
            endCard.classList.add('hidden');
            document.getElementById('pull-bottom-indicator').classList.remove('is-last');
        }

        // 前後ボタンの有効/無効
        document.getElementById('btn-prev-ep').disabled = (this.currentEp <= 1);
        document.getElementById('btn-next-ep').disabled = (this.currentEp >= this.totalEpisodes);

        // 次の話のプレビューラベル
        const nextSubLabel = document.getElementById('pull-next-title');
        if (this.currentEp < this.totalEpisodes) {
            nextSubLabel.textContent = `次は第 ${this.currentEp + 1} 話`;
        } else {
            nextSubLabel.textContent = '';
        }

        // スクロール位置の復元
        if (initialScroll > 0) {
            scroller.scrollTop = initialScroll;
        } else {
            scroller.scrollTop = 0;
        }

        // 読書進捗を即時更新
        this.saveCurrentProgress();
    }

    async saveCurrentProgress() {
        if (!this.currentNovel) return;
        const scroller = document.getElementById('reader-scroller');
        const scrollPos = scroller.scrollTop;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        const percent = maxScroll > 0 ? Math.round((scrollPos / maxScroll) * 100) : 0;

        await db.updateProgress(this.currentNovel.ncode, this.currentEp, scrollPos, percent);
        api.updateProgress(this.currentNovel.ncode, this.currentEp, percent);
    }

    goToPrevChapter() {
        if (this.currentEp > 1) {
            this.triggerPrevChapterTransition();
        }
    }

    goToNextChapter() {
        if (this.currentEp < this.totalEpisodes) {
            this.triggerNextChapterTransition();
        }
    }

    // --- HUD (ヘッダー/フッター) 操作 ---

    toggleHud() {
        this.isHudVisible = !this.isHudVisible;
        const header = document.getElementById('reader-header');
        const footer = document.getElementById('reader-footer');

        if (this.isHudVisible) {
            header.classList.add('show');
            footer.classList.add('show');
        } else {
            header.classList.remove('show');
            footer.classList.remove('show');
            this.closeSettingsSheet();
        }

        // 読書中はDLバーを隠し、HUDメニューを開いた時だけ表示
        if (window.app?.updateDownloadBarVisibility) {
            window.app.updateDownloadBarVisibility();
        }
    }

    openSettingsSheet() {
        const sheet = document.getElementById('reader-settings-sheet');
        sheet.classList.remove('hidden');
        requestAnimationFrame(() => sheet.classList.add('open'));
    }

    closeSettingsSheet() {
        const sheet = document.getElementById('reader-settings-sheet');
        sheet.classList.remove('open');
        setTimeout(() => sheet.classList.add('hidden'), 250);
    }
}
