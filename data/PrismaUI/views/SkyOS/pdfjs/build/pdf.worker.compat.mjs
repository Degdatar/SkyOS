// PDF.js may load this from a module Worker or import it as a fake worker.
// The polyfill module is evaluated before the upstream worker in both cases.
import './pdf.worker.polyfills.mjs';
export * from './pdf.worker.mjs';
