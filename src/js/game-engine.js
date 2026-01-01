/**
 * ゲームエンジンモジュール
 * ゲームのメインループ、描画、入力処理、判定を管理
 */
export class GameEngine {
  constructor(canvas, audioContext, audioBuffer) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;

    // ゲーム設定
    this.laneCount = 4;
    this.laneKeys = ['d', 'f', 'j', 'k'];
    this.laneColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];

    // タイミング設定
    this.noteSpeed = 500; // ノーツの落下速度（px/s）
    this.judgeLineY = 0; // 判定ライン（後で設定）
    this.noteAppearTime = 2.0; // ノーツが画面に表示される秒数

    // 判定ウィンドウ（秒）
    this.judgeWindows = {
      perfect: 0.05,
      great: 0.1,
      good: 0.15
    };

    // ゲーム状態
    this.notes = [];
    this.activeNotes = [];
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgeCount = { perfect: 0, great: 0, good: 0, miss: 0 };

    this.isPlaying = false;
    this.startTime = 0;
    this.audioSource = null;

    // オーディオ遅延補正（秒）
    // baseLatency: オーディオ処理の遅延
    // outputLatency: スピーカー出力の遅延
    this.audioLatency = (audioContext.baseLatency || 0) + (audioContext.outputLatency || 0);
    // 追加のマニュアル補正（環境によって調整が必要な場合）
    this.manualOffset = 0.05; // 50ms

    // 入力状態
    this.keyStates = {};

    // コールバック
    this.onScoreUpdate = null;
    this.onComboUpdate = null;
    this.onGameEnd = null;

    this.setupCanvas();
    this.setupInput();
  }

  /**
   * Canvas設定
   */
  setupCanvas() {
    this.canvas.width = 600;
    this.canvas.height = window.innerHeight;

    this.laneWidth = this.canvas.width / this.laneCount;
    this.judgeLineY = this.canvas.height - 100;
    this.noteHeight = 30;
  }

  /**
   * 入力設定
   */
  setupInput() {
    document.addEventListener('keydown', (e) => {
      if (!this.isPlaying) return;

      const laneIndex = this.laneKeys.indexOf(e.key.toLowerCase());
      if (laneIndex !== -1 && !this.keyStates[e.key]) {
        this.keyStates[e.key] = true;
        this.judgeNote(laneIndex);
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keyStates[e.key] = false;
    });
  }

  /**
   * 譜面をセット
   */
  setChart(notes) {
    this.notes = notes.map(note => ({
      ...note,
      hit: false,
      missed: false
    }));
    this.activeNotes = [];
  }

  /**
   * ゲーム開始
   */
  start() {
    // スコアリセット
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgeCount = { perfect: 0, great: 0, good: 0, miss: 0 };

    this.notes.forEach(note => {
      note.hit = false;
      note.missed = false;
    });
    this.activeNotes = [];

    // 音声再生
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    this.audioSource.connect(this.audioContext.destination);

    this.startTime = this.audioContext.currentTime;
    this.audioSource.start();

    this.isPlaying = true;

    // ゲーム終了検知
    this.audioSource.onended = () => {
      setTimeout(() => this.end(), 500);
    };

    this.gameLoop();
  }

  /**
   * 現在の再生時間を取得（遅延補正済み）
   */
  getCurrentTime() {
    return this.audioContext.currentTime - this.startTime - this.audioLatency - this.manualOffset;
  }

  /**
   * ゲームループ
   */
  gameLoop() {
    if (!this.isPlaying) return;

    const currentTime = this.getCurrentTime();

    this.update(currentTime);
    this.render(currentTime);

    requestAnimationFrame(() => this.gameLoop());
  }

  /**
   * 更新処理
   */
  update(currentTime) {
    // アクティブなノーツを更新
    this.activeNotes = this.notes.filter(note => {
      if (note.hit || note.missed) return false;

      const timeDiff = note.time - currentTime;

      // 画面外に出たらミス
      if (timeDiff < -this.judgeWindows.good) {
        note.missed = true;
        this.registerMiss();
        return false;
      }

      // 表示範囲内
      return timeDiff < this.noteAppearTime;
    });
  }

  /**
   * 描画処理
   */
  render(currentTime) {
    const ctx = this.ctx;

    // 背景クリア
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // レーンを描画
    this.renderLanes();

    // 判定ラインを描画
    this.renderJudgeLine();

    // ノーツを描画
    this.renderNotes(currentTime);

    // キー表示を描画
    this.renderKeyIndicators();
  }

  /**
   * レーン描画
   */
  renderLanes() {
    const ctx = this.ctx;

    for (let i = 0; i < this.laneCount; i++) {
      const x = i * this.laneWidth;

      // レーン背景
      ctx.fillStyle = `rgba(255, 255, 255, 0.03)`;
      ctx.fillRect(x, 0, this.laneWidth, this.canvas.height);

      // レーン区切り線
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
  }

  /**
   * 判定ライン描画
   */
  renderJudgeLine() {
    const ctx = this.ctx;

    // グラデーション効果
    const gradient = ctx.createLinearGradient(0, this.judgeLineY - 5, 0, this.judgeLineY + 5);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, this.judgeLineY - 5, this.canvas.width, 10);
  }

  /**
   * ノーツ描画
   */
  renderNotes(currentTime) {
    const ctx = this.ctx;

    this.activeNotes.forEach(note => {
      const timeDiff = note.time - currentTime;
      const y = this.judgeLineY - (timeDiff / this.noteAppearTime) * this.judgeLineY;
      const x = note.lane * this.laneWidth;

      // ノーツ本体
      ctx.fillStyle = this.laneColors[note.lane];
      ctx.beginPath();
      ctx.roundRect(x + 10, y - this.noteHeight / 2, this.laneWidth - 20, this.noteHeight, 5);
      ctx.fill();

      // 光沢効果
      const glossGradient = ctx.createLinearGradient(x, y - this.noteHeight / 2, x, y + this.noteHeight / 2);
      glossGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      glossGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glossGradient;
      ctx.fill();
    });
  }

  /**
   * キー表示描画
   */
  renderKeyIndicators() {
    const ctx = this.ctx;
    const keyY = this.judgeLineY + 30;

    this.laneKeys.forEach((key, i) => {
      const x = i * this.laneWidth + this.laneWidth / 2;
      const isPressed = this.keyStates[key];

      ctx.fillStyle = isPressed ? this.laneColors[i] : 'rgba(255, 255, 255, 0.3)';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key.toUpperCase(), x, keyY);
    });
  }

  /**
   * ノーツ判定
   */
  judgeNote(laneIndex) {
    const currentTime = this.getCurrentTime();

    // 該当レーンの最も近いノーツを探す
    let closestNote = null;
    let closestDiff = Infinity;

    this.activeNotes.forEach(note => {
      if (note.lane !== laneIndex || note.hit) return;

      const diff = Math.abs(note.time - currentTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestNote = note;
      }
    });

    if (!closestNote) return;

    // 判定
    let judgment = null;
    if (closestDiff <= this.judgeWindows.perfect) {
      judgment = 'perfect';
      this.score += 1000;
    } else if (closestDiff <= this.judgeWindows.great) {
      judgment = 'great';
      this.score += 500;
    } else if (closestDiff <= this.judgeWindows.good) {
      judgment = 'good';
      this.score += 100;
    }

    if (judgment) {
      closestNote.hit = true;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.judgeCount[judgment]++;

      // コンボボーナス
      this.score += Math.floor(this.combo * 10);

      this.showJudgment(judgment, laneIndex);
      this.updateUI();
    }
  }

  /**
   * ミス登録
   */
  registerMiss() {
    this.combo = 0;
    this.judgeCount.miss++;
    this.updateUI();
  }

  /**
   * 判定エフェクト表示
   */
  showJudgment(judgment, laneIndex) {
    const element = document.createElement('div');
    element.className = `judgment ${judgment}`;
    element.textContent = judgment.toUpperCase();
    element.style.left = `${this.canvas.offsetLeft + laneIndex * this.laneWidth + this.laneWidth / 2}px`;
    element.style.top = `${this.judgeLineY - 50}px`;
    document.body.appendChild(element);

    setTimeout(() => element.remove(), 500);
  }

  /**
   * UI更新
   */
  updateUI() {
    if (this.onScoreUpdate) this.onScoreUpdate(this.score);
    if (this.onComboUpdate) this.onComboUpdate(this.combo);
  }

  /**
   * ゲーム終了
   */
  end() {
    this.isPlaying = false;

    if (this.onGameEnd) {
      this.onGameEnd({
        score: this.score,
        maxCombo: this.maxCombo,
        ...this.judgeCount,
        totalNotes: this.notes.length
      });
    }
  }

  /**
   * ゲーム停止
   */
  stop() {
    this.isPlaying = false;
    if (this.audioSource) {
      this.audioSource.stop();
    }
  }
}
