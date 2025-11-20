// Background script to handle OAuth redirects and API calls

const EXIST_TOKEN_URL = 'https://exist.io/oauth2/access_token';
const EXIST_ATTRIBUTES_URL = 'https://exist.io/api/2/attributes/';
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

    // Acquire ownership of the attribute (creates it if it doesn't exist for manual attributes)
    if (!attributeExists) {
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
                }
            }
        }
    }

    // Store the attribute name for the content script
    await storage.set({ attributeName });
}
