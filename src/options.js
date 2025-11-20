const EXIST_AUTH_URL = 'https://exist.io/oauth2/authorize';
const EXIST_TOKEN_URL = 'https://exist.io/oauth2/access_token';
const EXIST_ATTRIBUTES_URL = 'https://exist.io/api/2/attributes/';
const EXIST_CREATE_URL = 'https://exist.io/api/2/attributes/create/';
const EXIST_ACQUIRE_URL = 'https://exist.io/api/2/attributes/acquire/';
const SCOPES = 'media_write';

const ATTRIBUTE_CONFIG = {
    label: 'YouTube Minutes',
    group: 'media',
    value_type: 3  // Period (min)
};

// Chrome API promise wrappers (works on both Chrome and Firefox)
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r)),
    set: (items) => new Promise(r => chrome.storage.local.set(items, r)),
    remove: (keys) => new Promise(r => chrome.storage.local.remove(keys, r))
};

const identity = {
    getRedirectURL: () => chrome.identity.getRedirectURL()
};

// Open OAuth in a new tab (background script handles the rest)
function launchOAuthFlow(url) {
    chrome.tabs.create({ url: url });
}

// UI Elements
const statusEl = document.getElementById('status');
const disconnectBtn = document.getElementById('disconnect');
const clientIdInput = document.getElementById('clientId');
const clientSecretInput = document.getElementById('clientSecret');
const saveCredentialsBtn = document.getElementById('saveCredentials');
const authorizeBtn = document.getElementById('authorize');
const messageEl = document.getElementById('message');
const redirectUriEl = document.getElementById('redirectUri');

// Get the redirect URI for this extension
const redirectUri = identity.getRedirectURL();
redirectUriEl.textContent = redirectUri;

// Initialize
document.addEventListener('DOMContentLoaded', loadState);

saveCredentialsBtn.addEventListener('click', saveCredentials);
authorizeBtn.addEventListener('click', startOAuthFlow);
disconnectBtn.addEventListener('click', disconnect);

async function loadState() {
    const data = await storage.get(['clientId', 'clientSecret', 'accessToken', 'refreshToken']);

    if (data.clientId) {
        clientIdInput.value = data.clientId;
    }
    if (data.clientSecret) {
        clientSecretInput.value = data.clientSecret;
    }

    updateStatus(data.accessToken);
}

function updateStatus(hasToken) {
    if (hasToken) {
        statusEl.textContent = 'Connected to Exist.io';
        statusEl.className = 'status connected';
        disconnectBtn.style.display = 'inline-block';
        authorizeBtn.textContent = 'Re-authorize';
    } else {
        statusEl.textContent = 'Not connected';
        statusEl.className = 'status disconnected';
        disconnectBtn.style.display = 'none';
        authorizeBtn.textContent = 'Authorize with Exist.io';
    }
}

async function saveCredentials() {
    const clientId = clientIdInput.value.trim();
    const clientSecret = clientSecretInput.value.trim();

    if (!clientId || !clientSecret) {
        showMessage('Please enter both Client ID and Client Secret', 'error');
        return;
    }

    await storage.set({ clientId, clientSecret });
    showMessage('Credentials saved', 'success');
}

async function startOAuthFlow() {
    const data = await storage.get(['clientId', 'clientSecret']);

    if (!data.clientId || !data.clientSecret) {
        showMessage('Please save your credentials first', 'error');
        return;
    }

    const authUrl = new URL(EXIST_AUTH_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', data.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', SCOPES);

    // Launch the OAuth flow (background script handles token exchange)
    launchOAuthFlow(authUrl.toString());

    // The popup will close when the tab opens
    // User will reopen popup to see connected status
}

async function exchangeCodeForTokens(code, clientId, clientSecret) {
    const response = await fetch(EXIST_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokenData = await response.json();

    // Store the tokens
    await storage.set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiry: Date.now() + (tokenData.expires_in * 1000)
    });
}

async function setupAttribute() {
    const data = await storage.get(['accessToken']);
    const token = data.accessToken;

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
        const existing = attributes.find(attr => attr.name === expectedName);
        if (existing) {
            attributeExists = true;
            attributeName = existing.name;
            console.log('Attribute already exists:', attributeName);
        }
    }

    // Create attribute if it doesn't exist
    if (!attributeExists) {
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
            }
        }
    }

    // Store the attribute name for the content script
    await storage.set({ attributeName });
}

async function disconnect() {
    await storage.remove(['accessToken', 'refreshToken', 'tokenExpiry']);
    updateStatus(false);
    showMessage('Disconnected from Exist.io', 'success');
}

function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = type;

    // Auto-hide success messages
    if (type === 'success') {
        setTimeout(() => {
            messageEl.className = '';
        }, 5000);
    }
}
