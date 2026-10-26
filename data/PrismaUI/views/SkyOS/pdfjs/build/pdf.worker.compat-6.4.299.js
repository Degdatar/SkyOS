// PDF.js may load this from a module Worker or import it as a fake worker.
// Apply the compatibility shims before evaluating the upstream worker bundle.
import "./pdf.worker.polyfills-6.4.299.js";
export * from "./pdf.worker-6.4.299.js";
