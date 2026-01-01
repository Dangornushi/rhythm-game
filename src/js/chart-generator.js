/**
 * 譜面生成モジュール
 * 音声解析結果から譜面データを生成
 */
export class ChartGenerator {
  constructor() {
    this.lanes = 4; // D, F, J, K
  }

  /**
   * 周波数帯域別のオンセットから譜面を生成
   * 低音（ドラム、ベース）のみにフォーカス
   */
  generateFromBands(bandOnsets, duration) {
    const notes = [];

    // 低音域（バスドラム、ベース）のみを使用
    // レーンは交互に配置してプレイしやすくする
    bandOnsets.bass.forEach((time, index) => {
      // 直近のノーツと被らないレーンを選択
      const lane = this.selectLaneForBass(notes, time);
      notes.push({ time, lane });
    });

    // 時間でソートして重複を削除
    return this.cleanupNotes(notes);
  }

  /**
   * 低音用のレーン選択（前のノーツと被らないように）
   */
  selectLaneForBass(existingNotes, time) {
    const recentNotes = existingNotes.filter(n => time - n.time < 0.2);
    const usedLanes = new Set(recentNotes.map(n => n.lane));

    // 使用されていないレーンからランダムに選択
    const availableLanes = [];
    for (let i = 0; i < this.lanes; i++) {
      if (!usedLanes.has(i)) {
        availableLanes.push(i);
      }
    }

    if (availableLanes.length > 0) {
      return availableLanes[Math.floor(Math.random() * availableLanes.length)];
    }

    return Math.floor(Math.random() * this.lanes);
  }

  /**
   * 単純なオンセットから譜面を生成
   */
  generateFromOnsets(onsets, duration) {
    const notes = [];

    onsets.forEach((time, index) => {
      // パターンを作成（連続するノーツが同じレーンにならないように）
      const lane = this.selectLane(notes, time);
      notes.push({ time, lane });
    });

    return notes;
  }

  /**
   * レーンを選択（前のノーツと被らないように）
   */
  selectLane(existingNotes, time) {
    // 直近のノーツを確認
    const recentNotes = existingNotes.filter(n => time - n.time < 0.3);
    const usedLanes = new Set(recentNotes.map(n => n.lane));

    // 使用されていないレーンからランダムに選択
    const availableLanes = [];
    for (let i = 0; i < this.lanes; i++) {
      if (!usedLanes.has(i)) {
        availableLanes.push(i);
      }
    }

    if (availableLanes.length > 0) {
      return availableLanes[Math.floor(Math.random() * availableLanes.length)];
    }

    // 全レーン使用済みの場合はランダム
    return Math.floor(Math.random() * this.lanes);
  }

  /**
   * ノーツを整理（ソート、重複除去）
   */
  cleanupNotes(notes) {
    // 時間でソート
    notes.sort((a, b) => a.time - b.time);

    // 同時刻の同レーンノーツを除去
    const cleaned = [];
    const seen = new Set();

    notes.forEach(note => {
      const key = `${note.time.toFixed(2)}-${note.lane}`;
      if (!seen.has(key)) {
        seen.add(key);
        cleaned.push(note);
      }
    });

    // 近すぎるノーツを間引く（同レーン内で100ms以内）
    return this.filterCloseNotes(cleaned);
  }

  /**
   * 近すぎるノーツをフィルタリング
   */
  filterCloseNotes(notes) {
    const result = [];
    const lastTimeByLane = {};

    notes.forEach(note => {
      const lastTime = lastTimeByLane[note.lane] || -Infinity;
      if (note.time - lastTime >= 0.1) {
        result.push(note);
        lastTimeByLane[note.lane] = note.time;
      }
    });

    return result;
  }

  /**
   * 難易度調整（ノーツ数を間引く）
   */
  adjustDifficulty(notes, level) {
    // level: 0.0（簡単）〜 1.0（難しい）
    if (level >= 1.0) return notes;

    const keepRatio = 0.3 + (level * 0.7); // 30%〜100%を保持
    return notes.filter(() => Math.random() < keepRatio);
  }
}
