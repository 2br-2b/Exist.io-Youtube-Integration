// Content script running in ISOLATED world
// Injects the monitoring script and sends messages to background for API calls

// Chrome API promise wrapper (works on both Chrome and Firefox)
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r))
};

(async function () {
    const data = await storage.get(['accessToken']);

    if (!data.accessToken) {
        console.log('Exist.io YouTube Logger: No access token configured. Please set up the extension in settings.');
        return;
    }

    // Inject the monitoring script into the MAIN world
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);

    // Listen for messages from the injected script
    window.addEventListener('message', handleMessage);
})();

function handleMessage(event) {
    if (event.source !== window) return;
    if (event.data.type !== 'EXIST_LOG_TIME') return;

    const duration_minutes = event.data.duration;

    // Send to background script to avoid CORS issues
    chrome.runtime.sendMessage({
        type: 'LOG_WATCH_TIME',
        duration: duration_minutes
    }, (response) => {
        if (response && response.success) {
            console.log("Exist.io: Logged time successfully, total:", response.current);
        } else if (response) {
            console.log("Exist.io: Log result:", response.reason);
        }
    });
}
