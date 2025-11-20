API_TOKEN = ""

const STATES = {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
};

start_timestamp = null;

var e_player = document.getElementById('movie_player');
e_player.addEventListener('onStateChange', (state) => {
    state_change_handler(state);
});
console.log('YouTube logger initialized!');
console.log(e_player);

function state_change_handler(state) {
    console.log('State changed:', state);
    if (state === STATES.PLAYING) {
        console.log('Video is playing');
        start_timestamp = Date.now();
    } else {
        console.log('Video is not playing');
        if (start_timestamp) {
            end_timestamp = Date.now();
            duration_minutes = (end_timestamp - start_timestamp) / 1000 / 60 + 1;
            console.log(`Watched for ${duration_minutes.toFixed(2)} minutes`);
            start_timestamp = null;
            log_watch_time(duration_minutes);
        }
    }
}

function log_watch_time(duration_minutes) {
    url = "https://exist.io/api/2/attributes/increment/"
    attributes = [{ "name": "youtube_mins", "date": new Date().toISOString().slice(0, 10), "value": duration_minutes }]

    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_TOKEN}`
        },
        body: JSON.stringify({ attributes: attributes })
    });
}