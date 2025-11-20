// This script runs in the MAIN world to access YouTube's player API

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

            // Send message to content script to log the time
            window.postMessage({
                type: 'EXIST_LOG_TIME',
                duration: duration_minutes
            }, '*');
        }
    }
}
