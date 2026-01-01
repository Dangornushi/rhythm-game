/**
 * 譜面キャッシュモジュール
 * IndexedDBを使用して譜面と音声データを保存
 */
export class ChartCache {
  constructor() {
    this.dbName = 'RhythmGameDB';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * データベースを開く
   */
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 曲データストア
        if (!db.objectStoreNames.contains('songs')) {
          const store = db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  /**
   * 曲を保存
   */
  async saveSong(name, audioData, chart, duration) {
    await this.ensureOpen();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['songs'], 'readwrite');
      const store = transaction.objectStore('songs');

      const song = {
        name,
        audioData, // ArrayBuffer
        chart,     // ノーツ配列
        duration,
        noteCount: chart.length,
        createdAt: Date.now()
      };

      const request = store.add(song);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 曲を取得
   */
  async getSong(id) {
    await this.ensureOpen();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['songs'], 'readonly');
      const store = transaction.objectStore('songs');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 全曲リストを取得（音声データなし）
   */
  async getAllSongs() {
    await this.ensureOpen();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['songs'], 'readonly');
      const store = transaction.objectStore('songs');
      const request = store.getAll();

      request.onsuccess = () => {
        // 音声データを除外してリストを返す
        const songs = request.result.map(song => ({
          id: song.id,
          name: song.name,
          noteCount: song.noteCount,
          duration: song.duration,
          createdAt: song.createdAt
        }));
        // 新しい順にソート
        songs.sort((a, b) => b.createdAt - a.createdAt);
        resolve(songs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 曲を削除
   */
  async deleteSong(id) {
    await this.ensureOpen();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['songs'], 'readwrite');
      const store = transaction.objectStore('songs');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * DBが開いているか確認し、開いていなければ開く
   */
  async ensureOpen() {
    if (!this.db) {
      await this.open();
    }
  }

  /**
   * 時間をフォーマット
   */
  static formatDuration(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}
