/* Pulse Edit — motore demo browser.
 * Porting fedele del percorso LIBROSA del prodotto (beat_detector.py fallback):
 * onset_strength(aggregate=median) → tempo (tempogram+prior) → beat_track DP →
 * estensione griglia → bars/upbeats → energy map → pattern di taglio (editor.py).
 * Divergenze dichiarate dal prodotto: chroma via STFT (non CQT), perc-RMS dallo
 * spettrogramma mascherato (niente iSTFT). Il resto è 1:1 col sorgente librosa 0.11.
 * Nessun export: il motore produce SOLO tempi di taglio per il player. */
"use strict";

const SR = 22050, N_FFT = 2048, HOP = 512, N_MELS = 128;

/* ── FFT radix-2 (reale via complessa) ── */
function fftInPlace(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const ur = re[i + k], ui = im[i + k];
                const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
}

/* np.round: half-to-even */
function npRound(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
}

function hannPeriodic(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
}

/* ── STFT |S|² — center=True, pad 'constant' (zeri), hann periodica ── */
function stftPower(y) {
    const pad = N_FFT >> 1;
    const nFrames = 1 + Math.floor(y.length / HOP);
    const win = hannPeriodic(N_FFT);
    const nBins = N_FFT / 2 + 1;
    const S = new Float64Array(nBins * nFrames);
    const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
    for (let t = 0; t < nFrames; t++) {
        const start = t * HOP - pad;
        for (let i = 0; i < N_FFT; i++) {
            const idx = start + i;
            re[i] = (idx >= 0 && idx < y.length) ? y[idx] * win[i] : 0;
            im[i] = 0;
        }
        fftInPlace(re, im);
        for (let k = 0; k < nBins; k++) S[k * nFrames + t] = re[k] * re[k] + im[k] * im[k];
    }
    return { S, nBins, nFrames };
}

/* ── filterbank mel Slaney (htk=False, norm='slaney') ── */
function melHz(m) { // slaney
    const f_sp = 200 / 3, min_log_hz = 1000, min_log_mel = min_log_hz / f_sp, logstep = Math.log(6.4) / 27;
    return m < min_log_mel ? m * f_sp : min_log_hz * Math.exp(logstep * (m - min_log_mel));
}
function hzMel(f) {
    const f_sp = 200 / 3, min_log_hz = 1000, min_log_mel = min_log_hz / f_sp, logstep = Math.log(6.4) / 27;
    return f < min_log_hz ? f / f_sp : min_log_mel + Math.log(f / min_log_hz) / logstep;
}
function melFilterbank(nBins, fmax) {
    const fftFreqs = new Float64Array(nBins);
    for (let k = 0; k < nBins; k++) fftFreqs[k] = k * SR / N_FFT;
    const melMin = hzMel(0), melMax = hzMel(fmax);
    const pts = new Float64Array(N_MELS + 2);
    for (let i = 0; i < N_MELS + 2; i++) pts[i] = melHz(melMin + (melMax - melMin) * i / (N_MELS + 1));
    const fb = [];
    for (let m = 0; m < N_MELS; m++) {
        const lo = pts[m], mid = pts[m + 1], hi = pts[m + 2];
        const row = new Float64Array(nBins);
        const norm = 2 / (hi - lo); // slaney
        for (let k = 0; k < nBins; k++) {
            const f = fftFreqs[k];
            const up = (f - lo) / (mid - lo), down = (hi - f) / (hi - mid);
            const v = Math.max(0, Math.min(up, down));
            row[k] = v * norm;
        }
        fb.push(row);
    }
    return fb;
}

/* power_to_db: ref=1, amin=1e-10, top_db=80 (clamp sul max globale) */
function powerToDb(M, n) {
    let mx = -Infinity;
    for (let i = 0; i < n; i++) { M[i] = 10 * Math.log10(Math.max(1e-10, M[i])); if (M[i] > mx) mx = M[i]; }
    const floor_ = mx - 80;
    for (let i = 0; i < n; i++) if (M[i] < floor_) M[i] = floor_;
}

function median(arr) {
    const a = Float64Array.from(arr).sort();
    const n = a.length;
    return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

/* ── onset_strength: mel power→dB, diff lag1 clamped, MEDIANA sulle bande,
      pad sinistro lag + n_fft//(2*hop), trim a nFrames ── */
function onsetStrength(y) {
    const { S, nBins, nFrames } = stftPower(y);
    const fb = melFilterbank(nBins, 0.5 * SR);
    const M = new Float64Array(N_MELS * nFrames);
    for (let m = 0; m < N_MELS; m++) {
        const row = fb[m];
        for (let t = 0; t < nFrames; t++) {
            let acc = 0;
            for (let k = 0; k < nBins; k++) acc += row[k] * S[k * nFrames + t];
            M[m * nFrames + t] = acc;
        }
    }
    powerToDb(M, N_MELS * nFrames);
    const lag = 1, padW = lag + Math.floor(N_FFT / (2 * HOP)); // 1+2 = 3
    const env = new Float64Array(nFrames);
    const col = new Float64Array(N_MELS);
    for (let t = 0; t < nFrames - lag; t++) {
        for (let m = 0; m < N_MELS; m++)
            col[m] = Math.max(0, M[m * nFrames + t + lag] - M[m * nFrames + t]);
        const dst = t + padW;
        if (dst < nFrames) env[dst] = median(col);
    }
    return { env, spec: S, nBins, nFrames };
}

/* ── tempo: tempogram (autocorr con hann per frame, norm max) → media →
      prior log-normale su log2, max_tempo 320, argmax log1p(1e6·tg) ── */
function estimateTempo(env) {
    const winLength = Math.floor(8.0 * SR / HOP); // 344
    const n = env.length, half = winLength >> 1;
    const padded = new Float64Array(n + 2 * half);
    // pad linear_ramp → 0 agli estremi
    for (let i = 0; i < half; i++) padded[i] = env[0] * (i / half);
    padded.set(env, half);
    for (let i = 0; i < half; i++) padded[n + half + i] = env[n - 1] * (1 - (i + 1) / half);
    const w = hannPeriodic(winLength);
    let fftN = 1; while (fftN < 2 * winLength) fftN <<= 1;
    const acc = new Float64Array(winLength);
    const re = new Float64Array(fftN), im = new Float64Array(fftN);
    const frame = new Float64Array(winLength);
    for (let t = 0; t < n; t++) {
        for (let i = 0; i < winLength; i++) frame[i] = padded[t + i] * w[i];
        re.fill(0); im.fill(0); re.set(frame);
        fftInPlace(re, im);
        for (let k = 0; k < fftN; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
        fftInPlace(re, im); // inversa non normalizzata di un reale pari = n·autocorr
        let mx = 0;
        for (let l = 0; l < winLength; l++) { const v = Math.abs(re[l]); if (v > mx) mx = v; }
        if (mx > 0) for (let l = 0; l < winLength; l++) acc[l] += re[l] / mx;
    }
    for (let l = 0; l < winLength; l++) acc[l] /= n;
    // bpms[k] = 60·(sr/hop)/k, bpms[0]=inf
    let best = -Infinity, bestK = 1;
    for (let k = 1; k < winLength; k++) {
        const bpm = 60 * (SR / HOP) / k;
        if (bpm >= 320) continue; // logprior = -inf sopra max_tempo
        const lp = -0.5 * Math.pow(Math.log2(bpm) - Math.log2(120), 2);
        const score = Math.log1p(1e6 * acc[k]) + lp;
        if (score > best) { best = score; bestK = k; }
    }
    return 60 * (SR / HOP) / bestK;
}

/* ── beat tracker DP (porting di __beat_tracker, tightness 60, trim) ── */
function trackBeats(env, bpm, tightness) {
    const n = env.length;
    const frameRate = SR / HOP;
    const fpb = npRound(frameRate * 60 / bpm);
    // normalizza per std (ddof=1)
    let mean = 0; for (let i = 0; i < n; i++) mean += env[i]; mean /= n;
    let va = 0; for (let i = 0; i < n; i++) va += (env[i] - mean) ** 2;
    const std = Math.sqrt(va / (n - 1)) + 1.1754944e-38;
    const oe = new Float64Array(n);
    for (let i = 0; i < n; i++) oe[i] = env[i] / std;
    // localscore: convoluzione same con finestra gaussiana exp(-0.5·(x·32/fpb)²)
    const K = 2 * fpb + 1, win = new Float64Array(K);
    for (let i = 0; i < K; i++) { const x = (i - fpb) * 32 / fpb; win[i] = Math.exp(-0.5 * x * x); }
    const ls = new Float64Array(n);
    const Kh = K >> 1;
    for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let k = Math.max(0, i + Kh - n + 1); k < Math.min(i + Kh, K); k++)
            acc += win[k] * oe[i + Kh - k];
        ls[i] = acc;
    }
    // DP
    let lsMax = 0; for (let i = 0; i < n; i++) if (ls[i] > lsMax) lsMax = ls[i];
    const thresh = 0.01 * lsMax;
    const backlink = new Int32Array(n).fill(-1);
    const cumscore = new Float64Array(n);
    let firstBeat = true;
    const lo1 = npRound(fpb / 2), lo2 = 2 * fpb;
    const logFpb = Math.log(fpb);
    for (let i = 0; i < n; i++) {
        let bestS = -Infinity, bestLoc = -1;
        for (let loc = i - lo1; loc >= i - lo2 && loc >= 0; loc--) {
            const d = Math.log(i - loc) - logFpb;
            const s = cumscore[loc] - tightness * d * d;
            if (s > bestS) { bestS = s; bestLoc = loc; }
        }
        cumscore[i] = bestLoc >= 0 ? ls[i] + bestS : ls[i];
        if (firstBeat && ls[i] < thresh) backlink[i] = -1;
        else { backlink[i] = bestLoc; firstBeat = false; }
    }
    // ultimo beat: localmax di cumscore, mediana, soglia 0.5·med
    const lmax = [], lvals = [];
    for (let i = 0; i < n; i++) {
        const okL = i === 0 || cumscore[i] > cumscore[i - 1];
        const okR = i === n - 1 || cumscore[i] >= cumscore[i + 1];
        if (okL && okR) { lmax.push(i); lvals.push(cumscore[i]); }
    }
    const th2 = 0.5 * median(lvals);
    let tail = n - 1;
    const isLmax = new Uint8Array(n); for (const i of lmax) isLmax[i] = 1;
    for (let i = n - 1; i >= 0; i--) if (isLmax[i] && cumscore[i] >= th2) { tail = i; break; }
    // backtrack
    const isBeat = new Uint8Array(n);
    for (let b = tail; b >= 0; b = backlink[b]) { isBeat[b] = 1; if (backlink[b] < 0) break; }
    // trim: conv hanning(5) sui punteggi dei beat, soglia 0.5·rms
    let beats = []; for (let i = 0; i < n; i++) if (isBeat[i]) beats.push(i);
    if (beats.length) {
        const hw = [0, 0.5, 1, 0.5, 0];
        const bs = beats.map(b => ls[b]);
        const sm = bs.map((_, i) => {
            let a = 0;
            for (let k = 0; k < 5; k++) { const j = i + 2 - k; if (j >= 0 && j < bs.length) a += hw[k] * bs[j]; }
            return a;
        });
        let rms = 0; for (const v of sm) rms += v * v;
        const th3 = 0.5 * Math.sqrt(rms / sm.length);
        let a = 0; while (a < n && ls[a] <= th3) a++;
        let b = n - 1; while (b >= 0 && ls[b] <= th3) b--;
        beats = beats.filter(f => f >= a && f <= b);
    }
    return beats.map(f => f * HOP / SR);
}

/* ── post del PRODOTTO (beat_detector.py, percorso librosa):
      estendi con intervallo medio davanti e dietro; bars ogni 4; upbeats ── */
function productPost(beatsList, audioDuration) {
    let beats = beatsList.slice();
    if (beats.length < 2) return { beats, bars: beats.slice(), upbeats: [] };
    let avg = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    let first = beats[0]; const prepend = [];
    while (first - avg >= 0.05) { first -= avg; prepend.push(first); }
    if (prepend.length) beats = prepend.reverse().concat(beats);
    avg = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    let last = beats[beats.length - 1];
    while (last + avg < audioDuration - 0.1) { last += avg; beats.push(last); }
    const bars = []; for (let i = 0; i < beats.length; i += 4) bars.push(beats[i]);
    // upbeats "quarter" con beat reali: tutti i beat fra bar[i] e bar[i+1]
    const upbeats = [];
    for (let i = 0; i < bars.length - 1; i++)
        for (const b of beats) if (b > bars[i] && b < bars[i + 1]) upbeats.push(b);
    return { beats, bars, upbeats };
}

/* ── energia per beat — struttura del prodotto (7 feature pesate, smooth 2s,
      min-max). chroma via STFT e perc-RMS dallo spettro mascherato (dichiarato). ── */
function energyPerBeat(y, beats, spec, nBins, nFrames) {
    const eps = 1e-10;
    const centroid = new Float64Array(nFrames), bandwidth = new Float64Array(nFrames),
          flatness = new Float64Array(nFrames), onsetE = new Float64Array(nFrames);
    const freqs = new Float64Array(nBins);
    for (let k = 0; k < nBins; k++) freqs[k] = k * SR / N_FFT;
    const mag = new Float64Array(nBins);
    for (let t = 0; t < nFrames; t++) {
        let sum = 0, wsum = 0, logsum = 0;
        for (let k = 0; k < nBins; k++) { mag[k] = Math.sqrt(spec[k * nFrames + t]); sum += mag[k]; wsum += mag[k] * freqs[k]; }
        const c = wsum / (sum + eps); centroid[t] = c;
        let bw = 0, psum = 0;
        for (let k = 0; k < nBins; k++) { bw += mag[k] * (freqs[k] - c) ** 2; psum += spec[k * nFrames + t]; logsum += Math.log(spec[k * nFrames + t] + eps); }
        bandwidth[t] = Math.sqrt(bw / (sum + eps));
        flatness[t] = Math.exp(logsum / nBins) / (psum / nBins + eps);
    }
    // onset (riuso: flux mel non disponibile qui → flux spettrale positivo)
    for (let t = 1; t < nFrames; t++) {
        let a = 0;
        for (let k = 0; k < nBins; k++) {
            const d = Math.sqrt(spec[k * nFrames + t]) - Math.sqrt(spec[k * nFrames + t - 1]);
            if (d > 0) a += d;
        }
        onsetE[t] = a;
    }
    // contrast: 6 bande da 200Hz, picco−valle (quantile 2%)
    const contrast = new Float64Array(nFrames);
    const edges = [200, 400, 800, 1600, 3200, 6400, 12800];
    for (let t = 0; t < nFrames; t++) {
        let acc = 0, nb = 0;
        for (let b = 0; b < 6; b++) {
            const kLo = Math.ceil(edges[b] * N_FFT / SR), kHi = Math.min(nBins - 1, Math.floor(edges[b + 1] * N_FFT / SR));
            if (kHi <= kLo) continue;
            const vals = [];
            for (let k = kLo; k <= kHi; k++) vals.push(spec[k * nFrames + t]);
            vals.sort((x, y) => x - y);
            const q = Math.max(1, Math.floor(0.02 * vals.length));
            let valley = 0, peak = 0;
            for (let i = 0; i < q; i++) { valley += vals[i]; peak += vals[vals.length - 1 - i]; }
            acc += Math.log(peak / q + eps) - Math.log(valley / q + eps); nb++;
        }
        contrast[t] = nb ? acc / nb : 0;
    }
    // chroma (STFT folding) → distanza fra frame consecutivi
    const chromaDiff = new Float64Array(nFrames);
    const chromaPrev = new Float64Array(12), chromaCur = new Float64Array(12);
    for (let t = 0; t < nFrames; t++) {
        chromaCur.fill(0);
        for (let k = 1; k < nBins; k++) {
            const f = freqs[k]; if (f < 60 || f > 4000) continue;
            const pc = ((Math.round(12 * Math.log2(f / 261.626)) % 12) + 12) % 12;
            chromaCur[pc] += Math.sqrt(spec[k * nFrames + t]);
        }
        let mx = 0; for (let i = 0; i < 12; i++) if (chromaCur[i] > mx) mx = chromaCur[i];
        if (mx > 0) for (let i = 0; i < 12; i++) chromaCur[i] /= mx;
        if (t > 0) {
            let d = 0; for (let i = 0; i < 12; i++) d += (chromaCur[i] - chromaPrev[i]) ** 2;
            chromaDiff[t] = Math.sqrt(d);
        }
        chromaPrev.set(chromaCur);
    }
    // perc-RMS: maschera percussiva (mediana verticale 31 vs orizzontale 31) sullo spettro
    const percRms = new Float64Array(nFrames);
    const kern = 15; // metà di 31
    const colBuf = [];
    for (let t = 0; t < nFrames; t++) {
        let acc = 0;
        for (let k = 0; k < nBins; k += 4) { // sottocampiono le righe ×4 (velocità; è una feature qualitativa)
            const v = spec[k * nFrames + t];
            // mediana orizzontale (armonica)
            colBuf.length = 0;
            for (let dt = -kern; dt <= kern; dt += 3) { const tt = t + dt; if (tt >= 0 && tt < nFrames) colBuf.push(spec[k * nFrames + tt]); }
            colBuf.sort((a, b) => a - b);
            const H = colBuf[colBuf.length >> 1];
            // mediana verticale (percussiva)
            colBuf.length = 0;
            for (let dk = -kern; dk <= kern; dk += 3) { const kk = k + dk; if (kk >= 0 && kk < nBins) colBuf.push(spec[kk * nFrames + t]); }
            colBuf.sort((a, b) => a - b);
            const P = colBuf[colBuf.length >> 1];
            const m = (P * P) / (H * H + P * P + eps);
            acc += v * m * m;
        }
        percRms[t] = Math.sqrt(acc / (nBins / 4));
    }
    const feats = [onsetE, centroid, contrast, bandwidth, flatness, chromaDiff, percRms];
    const weights = [0.20, 0.15, 0.15, 0.10, 0.10, 0.15, 0.15];
    const act = new Float64Array(nFrames);
    for (let f = 0; f < feats.length; f++) {
        let mx = 0; const F = feats[f];
        for (let t = 0; t < nFrames; t++) if (F[t] > mx) mx = F[t];
        if (mx > 0) for (let t = 0; t < nFrames; t++) act[t] += weights[f] * F[t] / mx;
    }
    // smooth uniforme 2s (86 frame, riflesso come scipy)
    const size = Math.max(1, Math.floor(2.0 * SR / HOP));
    const sm = new Float64Array(nFrames);
    const half1 = Math.floor(size / 2);
    for (let t = 0; t < nFrames; t++) {
        let a = 0;
        for (let d = -half1; d < size - half1; d++) {
            let idx = t + d;
            if (idx < 0) idx = -idx - 1; if (idx >= nFrames) idx = 2 * nFrames - idx - 1;
            a += act[idx];
        }
        sm[t] = a / size;
    }
    const frameTimes = []; for (let t = 0; t < nFrames; t++) frameTimes.push(t * HOP / SR);
    let energy = beats.map(bt => {
        let idx = frameTimes.findIndex(ft => ft >= bt);
        if (idx < 0) idx = nFrames - 1;
        idx = Math.max(0, Math.min(idx, nFrames - 1));
        return sm[idx];
    });
    const mn = Math.min(...energy), mxE = Math.max(...energy);
    energy = (mxE - mn > 0) ? energy.map(e => (e - mn) / (mxE - mn)) : energy.map(() => 0.5);
    return energy;
}

/* ── pattern di taglio (porting di editor.py apply_cut_pattern) ── */
function cutTimes(pattern, beats, upbeats, bars, energy) {
    if (pattern === "bar") return bars.slice();
    if (pattern === "beat") return beats.slice();
    if (pattern === "beat_upbeat") return [...new Set([...beats, ...upbeats])].sort((a, b) => a - b);
    // energy_map (default del prodotto)
    const nBars = bars.length;
    if (nBars < 2 || !energy.length) return bars.slice();
    const barSet = new Set(bars);
    const barEnergy = [], barSubdivs = [];
    for (let bi = 0; bi < nBars; bi++) {
        const s = bars[bi], e = bi + 1 < nBars ? bars[bi + 1] : Infinity;
        const en = [], sub = [];
        for (let gi = 0; gi < beats.length; gi++) {
            const gf = beats[gi];
            if (gf >= s && gf < e) {
                if (gi < energy.length) en.push(energy[gi]);
                if (!barSet.has(gf) && gf > s) sub.push(gf);
            }
        }
        barEnergy.push(en.length ? en.reduce((a, b) => a + b) / en.length : 0.5);
        barSubdivs.push(sub);
    }
    const result = [];
    let i = 0;
    while (i < nBars) {
        result.push(bars[i]);
        const e = barEnergy[i];
        let skip;
        if (e > 0.85) { result.push(...barSubdivs[i]); skip = 1; }
        else if (e > 0.7) skip = 1;
        else if (e > 0.45) skip = 2;
        else if (e > 0.25) skip = 4;
        else skip = 8;
        i += skip;
    }
    if (bars.length && !result.includes(bars[nBars - 1])) result.push(bars[nBars - 1]);
    return [...new Set(result)].sort((a, b) => a - b);
}

/* ── entry point: y mono @22050 ── */
function analyze(y, sensitivity) {
    if (sensitivity === undefined) sensitivity = 0.5;
    const audioDuration = y.length / SR;
    const { env, spec, nBins, nFrames } = onsetStrength(y);
    const bpm = estimateTempo(env);
    const tightness = 100 * (1 - sensitivity) + 10;
    const raw = trackBeats(env, bpm, tightness);
    const { beats, bars, upbeats } = productPost(raw, audioDuration);
    const energy = energyPerBeat(y, beats, spec, nBins, nFrames);
    return { bpm, beats, bars, upbeats, energy,
             cuts: { energy_map: cutTimes("energy_map", beats, upbeats, bars, energy),
                     bar: cutTimes("bar", beats, upbeats, bars, energy),
                     beat: cutTimes("beat", beats, upbeats, bars, energy),
                     beat_upbeat: cutTimes("beat_upbeat", beats, upbeats, bars, energy) } };
}

if (typeof module !== "undefined") module.exports = { analyze, SR };
if (typeof window !== "undefined") window.PulseEditEngine = { analyze, SR };
