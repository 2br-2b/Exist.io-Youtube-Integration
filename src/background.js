// Background script to handle OAuth redirects and API calls

const EXIST_TOKEN_URL = 'https://exist.io/oauth2/access_token';
const EXIST_ATTRIBUTES_URL = 'https://exist.io/api/2/attributes/';
const EXIST_CREATE_URL = 'https://exist.io/api/2/attributes/create/';
const EXIST_ACQUIRE_URL = 'https://exist.io/api/2/attributes/acquire/';
const EXIST_INCREMENT_URL = 'https://exist.io/api/2/attributes/increment/';

const ATTRIBUTE_CONFIG = {
    label: 'YouTube Minutes',
    group: 'media',
    value_type: 3  // Period (min)
};

// Chrome API promise wrappers
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r)),
    set: (items) => new Promise(r => chrome.storage.local.set(items, r))
};

// Listen for tab URL changes to capture OAuth redirect
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.startsWith(chrome.identity.getRedirectURL())) {
        handleOAuthRedirect(tabId, changeInfo.url);
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG_WATCH_TIME') {
        logWatchTime(message.duration, message.date).then(sendResponse);
        return true; // Keep channel open for async response
    }
});

async function logWatchTime(duration_minutes, date) {
    var int_duration = Math.floor(duration_minutes);
    if (int_duration <= 0) {
        int_duration = 1;
        // console.log("Exist.io: Ignoring sub-one minute duration");
        // return { success: false, reason: 'duration too short' };
    }

    const data = await storage.get(['accessToken', 'attributeName']);
    if (!data.accessToken) {
        console.error("Exist.io: No access token");
        return { success: false, reason: 'no token' };
    }

    const attributeName = data.attributeName || 'youtube_minutes';
    // Use provided date (for midnight-spanning sessions) or current date
    const logDate = date || new Date().toISOString().slice(0, 10);
    const attributes = [{
        name: attributeName,
        date: logDate,
        value: int_duration
    }];

    console.log("Exist.io: Logging", int_duration, "minutes for", logDate);

    try {
        const response = await fetch(EXIST_INCREMENT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${data.accessToken}`
            },
            body: JSON.stringify(attributes)
        });

        const result = await response.json();

        if (response.status === 202) {
            // Some attributes failed - check if it's our attribute
            if (result.failed && result.failed.length > 0) {
                const failed = result.failed.find(f => f.name === attributeName);
                if (failed) {
                    console.error("Exist.io: Attribute failed:", failed.error);
                    // Try to re-setup the attribute
                    console.log("Exist.io: Attempting to re-setup attribute...");
                    await setupAttribute(data.accessToken);
                    return { success: false, reason: 'attribute failed, re-setup attempted' };
                }
            }
        }

        if (response.ok || response.status === 202) {
            if (result.success && result.success.length > 0) {
                console.log("Exist.io: Successfully logged time, new total:", result.success[0].current);
                return { success: true, current: result.success[0].current };
            }
        }

        console.error("Exist.io: Failed to log watch time", response.status, result);
        return { success: false, reason: 'api error' };

    } catch (error) {
        console.error("Exist.io: Error logging watch time", error);
        return { success: false, reason: error.message };
    }
}

async function handleOAuthRedirect(tabId, url) {
    try {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        // Close the OAuth tab
        chrome.tabs.remove(tabId);

        if (error) {
            console.error('OAuth error:', error);
            return;
        }

        if (!code) {
            console.error('No authorization code received');
            return;
        }

        // Get stored credentials
        const data = await storage.get(['clientId', 'clientSecret']);
        if (!data.clientId || !data.clientSecret) {
            console.error('Missing client credentials');
            return;
        }

        // Exchange code for tokens
        const redirectUri = chrome.identity.getRedirectURL();
        const response = await fetch(EXIST_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: data.clientId,
                client_secret: data.clientSecret,
                redirect_uri: redirectUri
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Token exchange failed:', errorText);
            return;
        }

        const tokenData = await response.json();

        // Store the tokens
        await storage.set({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenExpiry: Date.now() + (tokenData.expires_in * 1000)
        });

        console.log('Successfully authenticated with Exist.io');

        // Set up the attribute
        await setupAttribute(tokenData.access_token);

    } catch (err) {
        console.error('Error handling OAuth redirect:', err);
    }
}

async function setupAttribute(token) {
    // Expected attribute name based on label
    const expectedName = ATTRIBUTE_CONFIG.label.toLowerCase().replace(/\s+/g, '_');
    let attributeName = expectedName;

    // Check if attribute already exists
    const attributesResponse = await fetch(EXIST_ATTRIBUTES_URL, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    let attributeExists = false;
    if (attributesResponse.ok) {
        const attributes = await attributesResponse.json();
        // API returns array of attributes
        const attrArray = Array.isArray(attributes) ? attributes : [];
        const existing = attrArray.find(attr => attr.name === expectedName);
        if (existing) {
            attributeExists = true;
            attributeName = existing.name;
            console.log('Attribute already exists:', attributeName);
        }
    }

    // Create the attribute if it doesn't exist
    if (!attributeExists) {
        console.log('Creating attribute:', ATTRIBUTE_CONFIG.label);
        const createResponse = await fetch(EXIST_CREATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify([ATTRIBUTE_CONFIG])
        });

        if (createResponse.ok) {
            const createData = await createResponse.json();
            if (createData.success && createData.success.length > 0) {
                attributeName = createData.success[0].name;
                console.log('Created attribute:', attributeName);
            } else if (createData.failed && createData.failed.length > 0) {
                console.error('Failed to create attribute:', createData.failed[0].error);
            }
        } else {
            console.error('Failed to create attribute:', await createResponse.text());
        }
    }

    // Acquire ownership of the attribute
    const acquireResponse = await fetch(EXIST_ACQUIRE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify([{ name: attributeName }])
    });

    if (acquireResponse.ok) {
        const acquireData = await acquireResponse.json();
        if (acquireData.success && acquireData.success.length > 0) {
            console.log('Acquired ownership of:', attributeName);
        } else if (acquireData.failed && acquireData.failed.length > 0) {
            const error = acquireData.failed[0];
            if (error.error_code !== 'already_owned') {
                console.warn('Failed to acquire attribute:', error.error);
            } else {
                console.log('Already own attribute:', attributeName);
            }
        }
    }

    // Store the attribute name for the content script
    await storage.set({ attributeName });
}
