/**
 * IndexedDB Database Management for Narou Reader
 * Handles local storage for novels, chapters, reading progress, and settings.
 */

const DB_NAME = 'NarouKakuyomuReaderDB';
const DB_VERSION = 1;

class NovelDB {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 作品ストア
                if (!db.objectStoreNames.contains('novels')) {
                    const novelStore = db.createObjectStore('novels', { keyPath: 'ncode' });
                    novelStore.createIndex('updated_at', 'updated_at', { unique: false });
                }

                // 話（エピソード）ストア
                if (!db.objectStoreNames.contains('chapters')) {
                    const chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
                    chapterStore.createIndex('ncode', 'ncode', { unique: false });
                    chapterStore.createIndex('ncode_ep', ['ncode', 'ep'], { unique: true });
                }

                // 設定ストア
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB open error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // --- 作品 (Novels) 操作 ---

    async getAllNovels() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('novels', 'readonly');
            const store = tx.objectStore('novels');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getNovel(ncode) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('novels', 'readonly');
            const store = tx.objectStore('novels');
            const request = store.get(ncode);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveNovel(novelData) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('novels', 'readwrite');
            const store = tx.objectStore('novels');
            const data = {
                ...novelData,
                updated_at: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteNovel(ncode) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['novels', 'chapters'], 'readwrite');
            const novelStore = tx.objectStore('novels');
            const chapterStore = tx.objectStore('chapters');

            novelStore.delete(ncode);

            // 関連チャプターも全削除
            const index = chapterStore.index('ncode');
            const request = index.openKeyCursor(IDBKeyRange.only(ncode));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    chapterStore.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    // --- エピソード (Chapters) 操作 ---

    async getChapter(ncode, ep) {
        await this.init();
        const id = `${ncode}_${ep}`;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chapters', 'readonly');
            const store = tx.objectStore('chapters');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveChapter(chapterData) {
        await this.init();
        const id = `${chapterData.ncode}_${chapterData.ep}`;
        const record = {
            id,
            ncode: chapterData.ncode,
            ep: parseInt(chapterData.ep, 10),
            subtitle: chapterData.subtitle || `第 ${chapterData.ep} 話`,
            preface: chapterData.preface || '',
            body: chapterData.body || '',
            afterword: chapterData.afterword || '',
            downloaded_at: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chapters', 'novels'], 'readwrite');
            const chapterStore = tx.objectStore('chapters');
            const novelStore = tx.objectStore('novels');

            chapterStore.put(record);

            // 作品側のダウンロード数を更新
            const novelReq = novelStore.get(chapterData.ncode);
            novelReq.onsuccess = () => {
                const novel = novelReq.result;
                if (novel) {
                    novel.downloaded_count = (novel.downloaded_count || 0) + 1;
                    novelStore.put(novel);
                }
            };

            tx.oncomplete = () => resolve(record);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getDownloadedEpisodes(ncode) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chapters', 'readonly');
            const store = tx.objectStore('chapters');
            const index = store.index('ncode');
            const request = index.getAll(IDBKeyRange.only(ncode));
            request.onsuccess = () => {
                const chapters = request.result || [];
                const epMap = {};
                for (const ch of chapters) {
                    epMap[ch.ep] = ch.subtitle;
                }
                resolve(epMap);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // --- 読書進捗 (Progress) ---

    async updateProgress(ncode, ep, scrollPos = 0, scrollPercent = 0) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('novels', 'readwrite');
            const store = tx.objectStore('novels');
            const req = store.get(ncode);

            req.onsuccess = () => {
                const novel = req.result;
                if (novel) {
                    novel.last_read_ep = ep;
                    novel.last_read_scroll = scrollPos;
                    novel.last_read_percent = scrollPercent;
                    novel.last_read_at = Date.now();
                    store.put(novel);
                    resolve(novel);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    // --- 設定 (Settings) ---

    async getSetting(key, defaultValue = null) {
        await this.init();
        return new Promise((resolve) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const req = store.get(key);
            req.onsuccess = () => {
                if (req.result && req.result.value !== undefined) {
                    resolve(req.result.value);
                } else {
                    resolve(defaultValue);
                }
            };
            req.onerror = () => resolve(defaultValue);
        });
    }

    async setSetting(key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            const req = store.put({ key, value });
            req.onsuccess = () => resolve(value);
            req.onerror = () => reject(req.error);
        });
    }

    // --- バックアップ (エクスポート & インポート - USB/ファイル移行用) ---

    async getAllChapters() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chapters', 'readonly');
            const store = tx.objectStore('chapters');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async getAllSettings() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * 全本棚・全保存エピソード・設定を1つのJSONファイルとして端末にダウンロード保存
     */
    async exportBackup() {
        const novels = await this.getAllNovels();
        const chapters = await this.getAllChapters();
        const settings = await this.getAllSettings();

        const backupData = {
            app: 'narou-kakuyomu-reader',
            version: 8,
            exported_at: new Date().toISOString(),
            novel_count: novels.length,
            chapter_count: chapters.length,
            novels,
            chapters,
            settings
        };

        const jsonStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const filename = `narou_reader_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return { filename, novelCount: novels.length, chapterCount: chapters.length };
    }

    /**
     * バックアップJSONから本棚・エピソード・設定を一括復元（IndexedDBへ保存）
     */
    async importBackup(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('無効なバックアップデータです');
        }

        const novels = data.novels || [];
        const chapters = data.chapters || [];
        const settings = data.settings || [];

        if (novels.length === 0 && chapters.length === 0) {
            throw new Error('バックアップに復元可能な作品データが含まれていません');
        }

        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['novels', 'chapters', 'settings'], 'readwrite');
            const novelStore = tx.objectStore('novels');
            const chapterStore = tx.objectStore('chapters');
            const settingStore = tx.objectStore('settings');

            let importedNovels = 0;
            let importedChapters = 0;

            for (const n of novels) {
                if (n && n.ncode) {
                    novelStore.put(n);
                    importedNovels++;
                }
            }

            for (const ch of chapters) {
                if (ch && ch.ncode && ch.ep) {
                    const id = ch.id || `${ch.ncode}_${ch.ep}`;
                    chapterStore.put({ ...ch, id });
                    importedChapters++;
                }
            }

            for (const s of settings) {
                if (s && s.key) {
                    settingStore.put(s);
                }
            }

            tx.oncomplete = () => {
                resolve({ importedNovels, importedChapters });
            };
            tx.onerror = () => reject(tx.error);
        });
    }
}

export const db = new NovelDB();
