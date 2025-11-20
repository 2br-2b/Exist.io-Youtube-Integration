// Content script running in ISOLATED world
// Injects the monitoring script and handles API calls

// Chrome API promise wrapper (works on both Chrome and Firefox)
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r))
};

let accessToken = null;
let attributeName = 'youtube_minutes';

(async function () {
    const data = await storage.get(['accessToken', 'attributeName']);

    if (!data.accessToken) {
        console.log('Exist.io YouTube Logger: No access token configured. Please set up the extension in settings.');
        return;
    }

    accessToken = data.accessToken;
    attributeName = data.attributeName || 'youtube_minutes';

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
    log_watch_time(duration_minutes);
}

function log_watch_time(duration_minutes) {
    const int_duration = Math.floor(duration_minutes);
    if (int_duration <= 0) {
        console.log("Exist.io: Ignoring sub-one minutes");
        return;
    }

    const url = "https://exist.io/api/2/attributes/increment/";
    const attributes = [{
        name: attributeName,
        date: new Date().toISOString().slice(0, 10),
        value: int_duration
    }];

    console.log("Exist.io: Logging", int_duration, "minutes");
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify(attributes)
    }).then(response => {
        if (!response.ok) {
            console.error("Exist.io: Failed to log watch time", response.status);
        }
    }).catch(error => {
        console.error("Exist.io: Error logging watch time", error);
    });
}
