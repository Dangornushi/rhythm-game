/**
 * オーディオ解析モジュール
 * Web Audio APIを使用して音楽を解析し、ビート情報を抽出
 */
export class AudioAnalyzer {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
  }

  /**
   * 音声ファイルを読み込んでデコード
   */
  async loadAudio(file) {
    const arrayBuffer = await file.arrayBuffer();
    return this.loadAudioFromBuffer(arrayBuffer);
  }

  /**
   * ArrayBufferから音声を読み込んでデコード
   */
  async loadAudioFromBuffer(arrayBuffer) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.audioBuffer;
  }

  /**
   * オンセット検出（音の立ち上がりを検出）
   */
  detectOnsets(sensitivity = 1.5) {
    if (!this.audioBuffer) return [];

    const channelData = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.02); // 20msのウィンドウ
    const hopSize = Math.floor(windowSize / 2);

    const energies = [];

    // エネルギーを計算
    for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < windowSize; j++) {
        energy += channelData[i + j] ** 2;
      }
      energies.push(energy / windowSize);
    }

    // オンセットを検出
    const onsets = [];
    const threshold = this.calculateThreshold(energies) * sensitivity;

    for (let i = 1; i < energies.length - 1; i++) {
      const diff = energies[i] - energies[i - 1];
      if (diff > threshold && energies[i] > energies[i + 1] * 0.8) {
        const time = (i * hopSize) / sampleRate;
        onsets.push(time);
      }
    }

    // 近接するオンセットをフィルタリング（最小間隔: 100ms）
    return this.filterCloseOnsets(onsets, 0.1);
  }

  /**
   * 周波数帯域別のオンセット検出（スペクトラルフラックス法）
   * @param {Function} onProgress - 進捗コールバック (0-1)
   */
  async detectOnsetsByBand(onProgress = null) {
    if (!this.audioBuffer) return { bass: [], midLow: [], midHigh: [], high: [] };

    const channelData = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;
    const fftSize = 1024;
    const hopSize = 512;

    // 各帯域のスペクトラルフラックスを計算
    const fluxData = { bass: [], midLow: [], midHigh: [], high: [] };
    let prevSpectrum = { bass: 0, midLow: 0, midHigh: 0, high: 0 };

    const totalIterations = Math.floor((channelData.length - fftSize) / hopSize);
    const chunkSize = 200;

    for (let i = 0, iteration = 0; i < channelData.length - fftSize; i += hopSize, iteration++) {
      const segment = channelData.slice(i, i + fftSize);

      // ハミング窓を適用
      const windowed = this.applyHammingWindow(segment);
      const spectrum = this.fft(windowed);

      const time = i / sampleRate;
      const binSize = sampleRate / fftSize;

      // 周波数帯域ごとのエネルギーを計算
      let bass = 0, midLow = 0, midHigh = 0, high = 0;

      for (let j = 0; j < spectrum.length; j++) {
        const freq = j * binSize;
        const mag = spectrum[j];

        if (freq < 150) bass += mag;
        else if (freq < 1000) midLow += mag;
        else if (freq < 4000) midHigh += mag;
        else if (freq < 8000) high += mag;
      }

      // スペクトラルフラックス（増加分のみ、半波整流）
      const bassFlux = Math.max(0, bass - prevSpectrum.bass);
      const midLowFlux = Math.max(0, midLow - prevSpectrum.midLow);
      const midHighFlux = Math.max(0, midHigh - prevSpectrum.midHigh);
      const highFlux = Math.max(0, high - prevSpectrum.high);

      fluxData.bass.push({ time, flux: bassFlux });
      fluxData.midLow.push({ time, flux: midLowFlux });
      fluxData.midHigh.push({ time, flux: midHighFlux });
      fluxData.high.push({ time, flux: highFlux });

      prevSpectrum = { bass, midLow, midHigh, high };

      if (iteration % chunkSize === 0) {
        if (onProgress) onProgress(iteration / totalIterations);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (onProgress) onProgress(1);

    // 各帯域のピークを検出
    return {
      bass: this.extractOnsetsFromFlux(fluxData.bass, 0.12),
      midLow: this.extractOnsetsFromFlux(fluxData.midLow, 0.1),
      midHigh: this.extractOnsetsFromFlux(fluxData.midHigh, 0.1),
      high: this.extractOnsetsFromFlux(fluxData.high, 0.08)
    };
  }

  /**
   * ハミング窓を適用
   */
  applyHammingWindow(data) {
    const n = data.length;
    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
      windowed[i] = data[i] * w;
    }
    return windowed;
  }

  /**
   * FFT（Cooley-Tukey）
   */
  fft(data) {
    const n = data.length;

    // ビット反転並び替え
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      let j = 0;
      let x = i;
      for (let k = 0; k < Math.log2(n); k++) {
        j = (j << 1) | (x & 1);
        x >>= 1;
      }
      real[j] = data[i];
    }

    // FFTバタフライ演算
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const step = (2 * Math.PI) / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const angle = -step * j;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);

          const idx1 = i + j;
          const idx2 = i + j + halfSize;

          const tReal = real[idx2] * cos - imag[idx2] * sin;
          const tImag = real[idx2] * sin + imag[idx2] * cos;

          real[idx2] = real[idx1] - tReal;
          imag[idx2] = imag[idx1] - tImag;
          real[idx1] = real[idx1] + tReal;
          imag[idx1] = imag[idx1] + tImag;
        }
      }
    }

    // マグニチュードを計算（ナイキスト周波数まで）
    const magnitude = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }

    return magnitude;
  }

  /**
   * スペクトラルフラックスからオンセットを抽出（適応的閾値）
   */
  extractOnsetsFromFlux(fluxData, minInterval) {
    if (fluxData.length === 0) return [];

    const fluxValues = fluxData.map(d => d.flux);
    const windowSize = 10; // 適応的閾値のウィンドウ
    const peaks = [];

    for (let i = windowSize; i < fluxData.length - 1; i++) {
      // ローカル平均を計算（適応的閾値）
      let localSum = 0;
      for (let j = i - windowSize; j < i; j++) {
        localSum += fluxValues[j];
      }
      const localMean = localSum / windowSize;
      const threshold = localMean * 1.5 + 0.001; // 適応的閾値

      // ピーク検出：現在値が閾値を超え、かつローカル最大
      if (fluxValues[i] > threshold &&
          fluxValues[i] > fluxValues[i - 1] &&
          fluxValues[i] >= fluxValues[i + 1]) {
        peaks.push(fluxData[i].time);
      }
    }

    return this.filterCloseOnsets(peaks, minInterval);
  }

  /**
   * 閾値を計算
   */
  calculateThreshold(energies) {
    const sorted = [...energies].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)];
  }

  /**
   * 平均を計算
   */
  calculateMean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * 近接するオンセットをフィルタリング
   */
  filterCloseOnsets(onsets, minInterval) {
    if (onsets.length === 0) return [];

    const filtered = [onsets[0]];
    for (let i = 1; i < onsets.length; i++) {
      if (onsets[i] - filtered[filtered.length - 1] >= minInterval) {
        filtered.push(onsets[i]);
      }
    }
    return filtered;
  }

  /**
   * AudioContextを取得
   */
  getContext() {
    return this.audioContext;
  }

  /**
   * AudioBufferを取得
   */
  getBuffer() {
    return this.audioBuffer;
  }
}
