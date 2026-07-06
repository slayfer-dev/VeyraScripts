// =========================================================================
// --- Web Worker Anti-Throttling Hack ---
// =========================================================================
(function bypassTimerThrottling() {
    // 1. The Worker code (runs in a separate background thread)
    const workerCode = `
        const timers = new Map();
        
        self.onmessage = function(e) {
            const { type, id, delay, isInterval } = e.data;
            
            if (type === 'start') {
                const timerFn = isInterval ? setInterval : setTimeout;
                const nativeId = timerFn(() => {
                    self.postMessage({ id });
                }, delay);
                timers.set(id, { nativeId, isInterval });
            } 
            else if (type === 'clear') {
                if (timers.has(id)) {
                    const { nativeId, isInterval } = timers.get(id);
                    if (isInterval) clearInterval(nativeId);
                    else clearTimeout(nativeId);
                    timers.delete(id);
                }
            }
        };
    `;

    // 2. Create the Worker from a Blob URL
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    // 3. Keep track of callbacks in the main thread
    let timerIdCounter = 0;
    const callbacks = new Map();

    worker.onmessage = function(e) {
        const id = e.data.id;
        if (callbacks.has(id)) {
            const { cb, isInterval } = callbacks.get(id);
            cb(); // Execute the callback
            if (!isInterval) callbacks.delete(id);
        }
    };

    // 4. Save original functions in case we need them
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;

    // 5. Override native functions
    window.setTimeout = function(cb, delay, ...args) {
        const id = ++timerIdCounter;
        callbacks.set(id, { cb: () => cb(...args), isInterval: false });
        worker.postMessage({ type: 'start', id, delay: delay || 0, isInterval: false });
        return id;
    };

    window.clearTimeout = function(id) {
        callbacks.delete(id);
        worker.postMessage({ type: 'clear', id });
    };

    window.setInterval = function(cb, delay, ...args) {
        const id = ++timerIdCounter;
        callbacks.set(id, { cb: () => cb(...args), isInterval: true });
        worker.postMessage({ type: 'start', id, delay: delay || 0, isInterval: true });
        return id;
    };

    window.clearInterval = function(id) {
        callbacks.delete(id);
        worker.postMessage({ type: 'clear', id });
    };

    console.log("Anti-Throttling Web Worker initialized!");
})();
