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

function getDateString(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function getMidnightAfter(timestamp) {
    const date = new Date(timestamp);
    date.setHours(24, 0, 0, 0);
    return date.getTime();
}

function state_change_handler(state) {
    if (state === STATES.PLAYING || state === STATES.BUFFERING) {
        start_timestamp = Date.now();
    } else {
        if (start_timestamp) {
            const end_timestamp = Date.now();

            // Check if the session spans midnight
            const startDate = getDateString(start_timestamp);
            const endDate = getDateString(end_timestamp);

            if (startDate === endDate) {
                // Same day - simple case
                const duration_minutes = (end_timestamp - start_timestamp) / 1000 / 60;
                console.log(`Exist.io: Watched for ${duration_minutes.toFixed(2)} minutes`);

                window.postMessage({
                    type: 'EXIST_LOG_TIME',
                    duration: duration_minutes
                }, '*');
            } else {
                // Session spans midnight - split across days
                let currentStart = start_timestamp;
                let currentDate = startDate;

                while (currentDate !== endDate) {
                    const midnight = getMidnightAfter(currentStart);
                    const duration_minutes = (midnight - currentStart) / 1000 / 60;

                    console.log(`Exist.io: Watched for ${duration_minutes.toFixed(2)} minutes on ${currentDate}`);

                    window.postMessage({
                        type: 'EXIST_LOG_TIME',
                        duration: duration_minutes,
                        date: currentDate
                    }, '*');

                    currentStart = midnight;
                    currentDate = getDateString(currentStart);
                }

                // Log remaining time for the final day
                const duration_minutes = (end_timestamp - currentStart) / 1000 / 60;
                console.log(`Exist.io: Watched for ${duration_minutes.toFixed(2)} minutes on ${endDate}`);

                window.postMessage({
                    type: 'EXIST_LOG_TIME',
                    duration: duration_minutes,
                    date: endDate
                }, '*');
            }

            start_timestamp = null;
        }
    }
}
