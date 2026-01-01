/**
 * メインモジュール
 * アプリケーションのエントリーポイント
 */
import { AudioAnalyzer } from './audio-analyzer.js';
import { ChartGenerator } from './chart-generator.js';
import { GameEngine } from './game-engine.js';
import { ChartCache } from './chart-cache.js';

class App {
  constructor() {
    this.audioAnalyzer = new AudioAnalyzer();
    this.chartGenerator = new ChartGenerator();
    this.chartCache = new ChartCache();
    this.gameEngine = null;

    this.audioFile = null;
    this.audioData = null; // ArrayBuffer
    this.chart = null;
    this.duration = 0;
    this.currentSongId = null; // 保存済み曲を再生中の場合のID

    this.init();
  }

  async init() {
    // DOM要素
    this.screens = {
      title: document.getElementById('title-screen'),
      game: document.getElementById('game-screen'),
      result: document.getElementById('result-screen')
    };

    this.audioInput = document.getElementById('audio-input');
    this.startBtn = document.getElementById('start-btn');
    this.retryBtn = document.getElementById('retry-btn');
    this.backBtn = document.getElementById('back-btn');
    this.songList = document.getElementById('song-list');
    this.canvas = document.getElementById('game-canvas');
    this.scoreDisplay = document.getElementById('score');
    this.comboDisplay = document.getElementById('combo');
    this.resultStats = document.getElementById('result-stats');

    // イベントリスナー
    this.audioInput.addEventListener('change', (e) => this.onAudioSelect(e));
    this.startBtn.addEventListener('click', () => this.startNewSong());
    this.retryBtn.addEventListener('click', () => this.retryGame());
    this.backBtn.addEventListener('click', () => this.backToTitle());

    // 保存済み曲リストを読み込み
    await this.loadSongList();
  }

  /**
   * 画面切り替え
   */
  showScreen(screenName) {
    Object.values(this.screens).forEach(screen => {
      screen.classList.remove('active');
    });
    this.screens[screenName].classList.add('active');
  }

  /**
   * 保存済み曲リストを読み込み
   */
  async loadSongList() {
    try {
      const songs = await this.chartCache.getAllSongs();
      this.renderSongList(songs);
    } catch (error) {
      console.error('曲リスト読み込みエラー:', error);
    }
  }

  /**
   * 曲リストを描画
   */
  renderSongList(songs) {
    if (songs.length === 0) {
      this.songList.innerHTML = '<p class="empty-message">保存された曲はありません</p>';
      return;
    }

    this.songList.innerHTML = songs.map(song => `
      <div class="song-item" data-id="${song.id}">
        <div class="song-info">
          <div class="song-name">${this.escapeHtml(song.name)}</div>
          <div class="song-meta">
            ${ChartCache.formatDuration(song.duration)} / ${song.noteCount}ノーツ
          </div>
        </div>
        <div class="song-actions">
          <button class="play-btn" data-id="${song.id}">プレイ</button>
          <button class="delete-btn" data-id="${song.id}">削除</button>
        </div>
      </div>
    `).join('');

    // イベントリスナーを追加
    this.songList.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playSavedSong(parseInt(btn.dataset.id));
      });
    });

    this.songList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSong(parseInt(btn.dataset.id));
      });
    });
  }

  /**
   * HTMLエスケープ
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 音声ファイル選択時
   */
  async onAudioSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    this.audioFile = file;
    this.currentSongId = null;
    this.startBtn.textContent = '解析中...';
    this.startBtn.disabled = true;

    try {
      // ArrayBufferを保存（キャッシュ用）
      this.audioData = await file.arrayBuffer();

      // 音声を読み込み
      await this.audioAnalyzer.loadAudioFromBuffer(this.audioData.slice(0));

      // 譜面を生成
      console.log('音声解析中...');
      const bandOnsets = await this.audioAnalyzer.detectOnsetsByBand((progress) => {
        this.startBtn.textContent = `解析中... ${Math.floor(progress * 100)}%`;
      });
      this.duration = this.audioAnalyzer.getBuffer().duration;

      this.chart = this.chartGenerator.generateFromBands(bandOnsets, this.duration);
      console.log(`譜面生成完了: ${this.chart.length} ノーツ`);

      this.startBtn.textContent = `解析してプレイ (${this.chart.length}ノーツ)`;
      this.startBtn.disabled = false;
    } catch (error) {
      console.error('音声の読み込みに失敗:', error);
      this.startBtn.textContent = 'エラー - 再選択してください';
    }
  }

  /**
   * 新規曲を開始（解析後）
   */
  async startNewSong() {
    if (!this.chart || !this.audioData) return;

    // 曲をキャッシュに保存
    const songName = this.audioFile.name.replace(/\.[^/.]+$/, ''); // 拡張子を除去
    try {
      this.currentSongId = await this.chartCache.saveSong(
        songName,
        this.audioData,
        this.chart,
        this.duration
      );
      console.log(`曲を保存しました: ${songName}`);
      await this.loadSongList(); // リストを更新
    } catch (error) {
      console.error('曲の保存に失敗:', error);
    }

    this.startGame();
  }

  /**
   * 保存済み曲を再生
   */
  async playSavedSong(songId) {
    try {
      const song = await this.chartCache.getSong(songId);
      if (!song) {
        console.error('曲が見つかりません');
        return;
      }

      this.currentSongId = songId;
      this.chart = song.chart;
      this.duration = song.duration;
      this.audioData = song.audioData;

      // 音声を読み込み
      await this.audioAnalyzer.loadAudioFromBuffer(song.audioData.slice(0));

      this.startGame();
    } catch (error) {
      console.error('曲の読み込みに失敗:', error);
    }
  }

  /**
   * 曲を削除
   */
  async deleteSong(songId) {
    if (!confirm('この曲を削除しますか？')) return;

    try {
      await this.chartCache.deleteSong(songId);
      await this.loadSongList();
    } catch (error) {
      console.error('曲の削除に失敗:', error);
    }
  }

  /**
   * ゲーム開始
   */
  startGame() {
    if (!this.chart) return;

    this.showScreen('game');

    // ゲームエンジン初期化
    this.gameEngine = new GameEngine(
      this.canvas,
      this.audioAnalyzer.getContext(),
      this.audioAnalyzer.getBuffer()
    );

    // スマホの場合は連打を防いだ簡単譜面に
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    const chartToUse = isMobile
      ? this.chartGenerator.adjustForMobile(this.chart)
      : this.chart;

    this.gameEngine.setChart(chartToUse);

    // コールバック設定
    this.gameEngine.onScoreUpdate = (score) => {
      this.scoreDisplay.textContent = score.toLocaleString();
    };

    this.gameEngine.onComboUpdate = (combo) => {
      this.comboDisplay.textContent = combo;
    };

    this.gameEngine.onGameEnd = (result) => {
      this.showResult(result);
    };

    // 少し待ってから開始
    setTimeout(() => {
      this.gameEngine.start();
    }, 1000);
  }

  /**
   * リザルト表示
   */
  showResult(result) {
    this.showScreen('result');

    const accuracy = ((result.perfect + result.great * 0.8 + result.good * 0.5) / result.totalNotes * 100).toFixed(1);

    this.resultStats.innerHTML = `
      <p>Score: ${result.score.toLocaleString()}</p>
      <p>Max Combo: ${result.maxCombo}</p>
      <p>Accuracy: ${accuracy}%</p>
      <hr style="margin: 1rem 0; border-color: rgba(255,255,255,0.2);">
      <p style="color: #ffff00;">Perfect: ${result.perfect}</p>
      <p style="color: #00ff00;">Great: ${result.great}</p>
      <p style="color: #00aaff;">Good: ${result.good}</p>
      <p style="color: #ff0000;">Miss: ${result.miss}</p>
    `;
  }

  /**
   * リトライ
   */
  async retryGame() {
    // AudioContextを再初期化
    await this.audioAnalyzer.loadAudioFromBuffer(this.audioData.slice(0));
    this.startGame();
  }

  /**
   * タイトルに戻る
   */
  backToTitle() {
    if (this.gameEngine) {
      this.gameEngine.stop();
    }
    this.showScreen('title');
    this.loadSongList(); // リストを更新
  }
}

// アプリケーション起動
new App();
