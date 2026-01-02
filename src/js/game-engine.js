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
    this.laneCount = 4; // 譜面のレーン数（変更しない）
    this.laneKeys = ['d', 'f', 'j', 'k'];
    this.laneColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];
    this.mobileLaneColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4']; // スマホ用4色

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
    this.touchStates = {};

    // スマホ判定
    this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    this.displayLaneCount = 4; // 常に4レーン表示

    // コールバック
    this.onScoreUpdate = null;
    this.onComboUpdate = null;
    this.onGameEnd = null;

    // 3D表示設定
    this.perspective = {
      vanishY: 0,           // 消失点のY座標（上端）
      horizonRatio: 0.15,   // 消失点でのレーン幅の比率
      noteMinScale: 0.3,    // 最も奥のノーツのスケール
    };

    this.setupCanvas();
    this.setupInput();

    // スマホの場合は横画面を強制
    if (this.isMobile) {
      this.lockLandscape();
    }
  }

  /**
   * 横画面をロック（スマホ用）
   */
  async lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (e) {
      // ロックに失敗した場合は警告を表示
      console.log('Screen orientation lock not supported');
    }
  }

  /**
   * Canvas設定
   */
  setupCanvas() {
    if (this.isMobile) {
      // 横画面対応：画面全体を使用
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.judgeLineY = this.canvas.height - 80;
      this.noteHeight = 25;
      this.touchAreaHeight = 70;
    } else {
      this.canvas.width = 600;
      this.canvas.height = window.innerHeight;
      this.judgeLineY = this.canvas.height - 100;
      this.noteHeight = 30;
      this.touchAreaHeight = 120;
    }

    this.laneWidth = this.canvas.width / this.displayLaneCount;

    // 3D用の消失点設定
    this.perspective.vanishY = 50;
  }

  /**
   * 入力設定
   */
  setupInput() {
    // キーボード入力
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

    // タッチ入力
    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.isPlaying) return;
      e.preventDefault();

      for (const touch of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const displayLane = this.getLaneFromX(x);

        if (displayLane >= 0 && displayLane < this.displayLaneCount) {
          this.touchStates[displayLane] = true;
          this.judgeNote(displayLane);
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      for (const touch of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const displayLane = this.getLaneFromX(x);

        if (displayLane >= 0 && displayLane < this.displayLaneCount) {
          this.touchStates[displayLane] = false;
        }
      }
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
   * X座標からレーン番号を取得（判定ライン位置で計算）
   */
  getLaneFromX(x) {
    for (let i = 0; i < this.displayLaneCount; i++) {
      const laneInfo = this.getLaneXAtY(i, this.judgeLineY);
      const nextLaneInfo = this.getLaneXAtY(i + 1, this.judgeLineY);
      if (x >= laneInfo.x && x < nextLaneInfo.x) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Y座標から3Dスケールを計算
   */
  getScaleAtY(y) {
    const { vanishY, noteMinScale } = this.perspective;
    const totalDistance = this.judgeLineY - vanishY;
    const currentDistance = y - vanishY;
    const progress = Math.max(0, Math.min(1, currentDistance / totalDistance));
    return noteMinScale + (1 - noteMinScale) * progress;
  }

  /**
   * Y座標でのレーンのX座標範囲を計算
   */
  getLaneXAtY(laneIndex, y) {
    const scale = this.getScaleAtY(y);
    const centerX = this.canvas.width / 2;
    const totalWidth = this.canvas.width * scale;
    const laneWidth = totalWidth / this.displayLaneCount;
    const startX = centerX - totalWidth / 2;
    return {
      x: startX + laneIndex * laneWidth,
      width: laneWidth
    };
  }

  /**
   * レーン描画（3D風）
   */
  renderLanes() {
    const ctx = this.ctx;
    const { vanishY } = this.perspective;

    // 各レーンを台形として描画
    for (let i = 0; i < this.displayLaneCount; i++) {
      // 上端（消失点付近）の座標
      const topLane = this.getLaneXAtY(i, vanishY);
      const topNextLane = this.getLaneXAtY(i + 1, vanishY);

      // 下端（判定ライン）の座標
      const bottomLane = this.getLaneXAtY(i, this.judgeLineY);
      const bottomNextLane = this.getLaneXAtY(i + 1, this.judgeLineY);

      // レーン背景（台形）
      ctx.fillStyle = `rgba(255, 255, 255, 0.03)`;
      ctx.beginPath();
      ctx.moveTo(topLane.x, vanishY);
      ctx.lineTo(topNextLane.x, vanishY);
      ctx.lineTo(bottomNextLane.x, this.judgeLineY);
      ctx.lineTo(bottomLane.x, this.judgeLineY);
      ctx.closePath();
      ctx.fill();

      // レーン区切り線
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(topLane.x, vanishY);
      ctx.lineTo(bottomLane.x, this.judgeLineY);
      ctx.stroke();
    }

    // 右端の線
    const topRight = this.getLaneXAtY(this.displayLaneCount, vanishY);
    const bottomRight = this.getLaneXAtY(this.displayLaneCount, this.judgeLineY);
    ctx.beginPath();
    ctx.moveTo(topRight.x, vanishY);
    ctx.lineTo(bottomRight.x, this.judgeLineY);
    ctx.stroke();

    // 奥行きグリッド線（横線）
    const gridLines = 8;
    for (let i = 1; i < gridLines; i++) {
      const progress = i / gridLines;
      const y = vanishY + (this.judgeLineY - vanishY) * progress;
      const leftLane = this.getLaneXAtY(0, y);
      const rightLane = this.getLaneXAtY(this.displayLaneCount, y);

      ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + progress * 0.05})`;
      ctx.beginPath();
      ctx.moveTo(leftLane.x, y);
      ctx.lineTo(rightLane.x, y);
      ctx.stroke();
    }
  }

  /**
   * 判定ライン描画（3D対応）
   */
  renderJudgeLine() {
    const ctx = this.ctx;
    const leftLane = this.getLaneXAtY(0, this.judgeLineY);
    const rightLane = this.getLaneXAtY(this.displayLaneCount, this.judgeLineY);

    // グラデーション効果
    const gradient = ctx.createLinearGradient(0, this.judgeLineY - 5, 0, this.judgeLineY + 5);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(leftLane.x, this.judgeLineY - 5, rightLane.x - leftLane.x, 10);
  }

  /**
   * 時間progressから3D遠近法を適用したY座標を計算
   */
  getPerspectiveY(linearProgress) {
    const { vanishY } = this.perspective;
    // 3D空間でのZ座標をシミュレート
    // zFar: 大きいほど奥から出現、zNear: 大きいほど加速が緩やか
    const zFar = 150;
    const zNear = 20;
    const z = zFar - linearProgress * (zFar - zNear);
    // 遠近法投影：手前ほど加速して見える
    return vanishY + (this.judgeLineY - vanishY) * (zNear / z);
  }

  /**
   * ノーツ描画（3D風）
   */
  renderNotes(currentTime) {
    const ctx = this.ctx;
    const { vanishY } = this.perspective;

    // 奥から手前の順に描画するためソート
    const sortedNotes = [...this.activeNotes].sort((a, b) => {
      const progressA = 1 - ((a.time - currentTime) / this.noteAppearTime);
      const progressB = 1 - ((b.time - currentTime) / this.noteAppearTime);
      return this.getPerspectiveY(progressA) - this.getPerspectiveY(progressB);
    });

    sortedNotes.forEach(note => {
      const timeDiff = note.time - currentTime;
      // 線形の進行度を計算
      const linearProgress = 1 - (timeDiff / this.noteAppearTime);
      // 3D遠近法を適用したY座標
      const y = this.getPerspectiveY(linearProgress);

      // 画面外のノーツは描画しない
      if (y < vanishY || y > this.judgeLineY) return;

      // 3Dスケールを取得
      const scale = this.getScaleAtY(y);
      const laneInfo = this.getLaneXAtY(note.lane, y);

      // スケールに応じたノーツサイズ
      const noteHeight = this.noteHeight * scale;
      const noteWidth = laneInfo.width - 20 * scale;
      const x = laneInfo.x + 10 * scale;

      // ノーツ本体
      const colors = this.isMobile ? this.mobileLaneColors : this.laneColors;
      ctx.fillStyle = colors[note.lane];
      ctx.beginPath();
      ctx.roundRect(x, y - noteHeight / 2, noteWidth, noteHeight, 5 * scale);
      ctx.fill();

      // 光沢効果
      const glossGradient = ctx.createLinearGradient(x, y - noteHeight / 2, x, y + noteHeight / 2);
      glossGradient.addColorStop(0, `rgba(255, 255, 255, ${0.4 * scale})`);
      glossGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glossGradient;
      ctx.fill();

      // 枠線（奥行き感を強調）
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 * scale})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /**
   * キー/タッチエリア表示描画（3D対応）
   */
  renderKeyIndicators() {
    const ctx = this.ctx;

    if (this.isMobile) {
      // スマホ: タッチエリアを描画
      for (let i = 0; i < this.displayLaneCount; i++) {
        const laneInfo = this.getLaneXAtY(i, this.judgeLineY);
        const nextLaneInfo = this.getLaneXAtY(i + 1, this.judgeLineY);
        const y = this.judgeLineY + 10;
        const isPressed = this.touchStates[i];
        const width = nextLaneInfo.x - laneInfo.x - 10;

        // タッチエリア背景
        ctx.fillStyle = isPressed
          ? this.mobileLaneColors[i]
          : `rgba(${this.hexToRgb(this.mobileLaneColors[i])}, 0.3)`;
        ctx.fillRect(laneInfo.x + 5, y, width, this.touchAreaHeight);

        // タッチエリア枠線
        ctx.strokeStyle = this.mobileLaneColors[i];
        ctx.lineWidth = 2;
        ctx.strokeRect(laneInfo.x + 5, y, width, this.touchAreaHeight);
      }
    } else {
      // PC: キー表示
      const keyY = this.judgeLineY + 30;

      this.laneKeys.forEach((key, i) => {
        const laneInfo = this.getLaneXAtY(i, this.judgeLineY);
        const nextLaneInfo = this.getLaneXAtY(i + 1, this.judgeLineY);
        const x = (laneInfo.x + nextLaneInfo.x) / 2;
        const isPressed = this.keyStates[key];

        ctx.fillStyle = isPressed ? this.laneColors[i] : 'rgba(255, 255, 255, 0.3)';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key.toUpperCase(), x, keyY);
      });
    }
  }

  /**
   * HEXカラーをRGBに変換
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '255, 255, 255';
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
   * 複数レーンを対象にノーツ判定（スマホ用）
   */
  judgeNoteMultiLane(laneIndices) {
    const currentTime = this.getCurrentTime();

    // 対象レーンの中で最も近いノーツを探す
    let closestNote = null;
    let closestDiff = Infinity;

    this.activeNotes.forEach(note => {
      if (!laneIndices.includes(note.lane) || note.hit) return;

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

      this.showJudgment(judgment, closestNote.lane);
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
    const laneInfo = this.getLaneXAtY(laneIndex, this.judgeLineY);
    const nextLaneInfo = this.getLaneXAtY(laneIndex + 1, this.judgeLineY);
    const centerX = (laneInfo.x + nextLaneInfo.x) / 2;

    const element = document.createElement('div');
    element.className = `judgment ${judgment}`;
    element.textContent = judgment.toUpperCase();
    element.style.left = `${this.canvas.offsetLeft + centerX}px`;
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
