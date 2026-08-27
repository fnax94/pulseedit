'use strict';
/* Worker di analisi Pulse Edit — l'analyze e' CPU-bound (secondi),
   qui gira fuori dal main thread e non blocca la UI. */

/* Il motore esporta su window: nel worker lo shim lo fa puntare a self. */
self.window = self;
importScripts('./pe_engine.js');

self.onmessage = (e) => {
  const { job, y, sensitivity } = e.data;
  try {
    const res = self.PulseEditEngine.analyze(y, sensitivity);
    self.postMessage({ job, ok: true, res });
  } catch (err) {
    self.postMessage({ job, ok: false, error: String((err && err.message) || err) });
  }
};
