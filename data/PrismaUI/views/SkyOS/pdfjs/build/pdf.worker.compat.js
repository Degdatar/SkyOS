// PDF.js uses Promise.withResolvers, which is missing in the Skyrim WebView runtime.
if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value() {
      let resolve;
      let reject;
      const promise = new Promise((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      return { promise, resolve, reject };
    }
  });
}
importScripts('./pdf.worker.js');
