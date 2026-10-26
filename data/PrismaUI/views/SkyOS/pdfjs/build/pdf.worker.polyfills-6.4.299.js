// PDF.js 6 uses APIs not yet exposed by the Ultralight runtime embedded in
// some PrismaUI releases. Install these before loading the upstream worker.
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

if (typeof Promise.try !== 'function') {
  Object.defineProperty(Promise, 'try', {
    configurable: true,
    writable: true,
    value(callback, ...args) {
      try { return Promise.resolve(callback(...args)); }
      catch (error) { return Promise.reject(error); }
    }
  });
}

if (typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value(key, callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    }
  });
}

if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true,
    writable: true,
    value() {
      const digits = '0123456789abcdef';
      let result = '';
      for (let i = 0; i < this.length; i++) {
        const byte = this[i];
        result += digits[byte >> 4] + digits[byte & 0x0f];
      }
      return result;
    }
  });
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    configurable: true,
    writable: true,
    value(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  });
}

if (typeof URL.parse !== 'function') {
  Object.defineProperty(URL, 'parse', {
    configurable: true,
    writable: true,
    value(url, base) {
      try { return new URL(url, base); } catch { return null; }
    }
  });
}

  // PDF.js 6.4 uses the newer precise summation API, absent in older PrismaUI WebViews.
  if (typeof Math.sumPrecise !== 'function') {
    Object.defineProperty(Math, 'sumPrecise', {
      configurable: true,
      writable: true,
      value(values) {
        let sum = 0;
        let correction = 0;
        for (const value of values) {
          const next = sum + value;
          if (!Number.isFinite(next)) return next;
          if (Math.abs(sum) >= Math.abs(value)) correction += (sum - next) + value;
          else correction += (value - next) + sum;
          sum = next;
        }
        return sum + correction;
      }
    });
  }
  // PDF.js 6.4 adds Iterator.prototype.join but older WebViews lack the global Iterator constructor.
  if (typeof globalThis.Iterator !== 'function') {
    const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    const Iterator = function Iterator() {
      throw new TypeError('Iterator is an abstract base class.');
    };
    Iterator.prototype = iteratorPrototype;
    globalThis.Iterator = Iterator;
  }
  if (typeof globalThis.Iterator.prototype.join !== 'function') {
    Object.defineProperty(globalThis.Iterator.prototype, 'join', {
      configurable: true,
      writable: true,
      value(separator) {
        return [...this].join(separator);
      }
    });
  }
