// Content script running in ISOLATED world
// Gets the token from storage and injects the YouTube monitoring code into the page

// Chrome API promise wrapper (works on both Chrome and Firefox)
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r))
};

(async function() {
    const data = await storage.get(['accessToken', 'attributeName']);

    if (!data.accessToken) {
        console.log('Exist.io YouTube Logger: No access token configured. Please set up the extension in settings.');
        return;
    }

    const attributeName = data.attributeName || 'youtube_minutes';

    // Inject the monitoring script into the MAIN world
    const script = document.createElement('script');
    script.textContent = `(${youtubeMonitorScript.toString()})("${data.accessToken}", "${attributeName}")`;
    document.documentElement.appendChild(script);
    script.remove();
})();

function youtubeMonitorScript(API_TOKEN, ATTRIBUTE_NAME) {
    const STATES = {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5
    };

    let start_timestamp = null;
    let playerInitialized = false;

    function initializePlayer() {
        if (playerInitialized) return;

        const e_player = document.getElementById('movie_player');
        if (!e_player) return;

        e_player.addEventListener('onStateChange', (state) => {
            state_change_handler(state);
        });
        playerInitialized = true;
        console.log('Exist.io YouTube logger initialized');
    }

    // Try immediately in case player already exists
    initializePlayer();

    // Listen for YouTube's navigation events (works for SPA navigation)
    window.addEventListener('yt-navigate-finish', () => {
        playerInitialized = false;
        initializePlayer();
    });

    // Also listen for page load completion
    document.addEventListener('DOMContentLoaded', initializePlayer);
    window.addEventListener('load', initializePlayer);

    function state_change_handler(state) {
        if (state === STATES.PLAYING) {
            start_timestamp = Date.now();
        } else {
            if (start_timestamp) {
                const end_timestamp = Date.now();
                const duration_minutes = (end_timestamp - start_timestamp) / 1000 / 60;
                console.log(`Exist.io: Watched for ${duration_minutes.toFixed(2)} minutes`);
                start_timestamp = null;
                log_watch_time(duration_minutes);
            }
        }
    }

    function log_watch_time(duration_minutes) {
        const int_duration = Math.floor(duration_minutes);
        if (int_duration <= 0) {
            return;
        }

        const url = "https://exist.io/api/2/attributes/increment/";
        const attributes = [{
            name: ATTRIBUTE_NAME,
            date: new Date().toISOString().slice(0, 10),
            value: int_duration
        }];

        console.log("Exist.io: Logging", int_duration, "minutes");
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_TOKEN}`
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
}
