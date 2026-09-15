const state = { products: [], reviews: [], filters: { status: 'all' }, sort: 'newest', cartCount: 0 };

const api = async (endpoint, options = {}) => {
    const response = await fetch(endpoint, { headers: { 'Content-Type': 'application/json' }, ...options });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
};

const icons = rating => Array.from({ length: 5 }, (_, index) => `<i class="fa fa-star${index < rating ? '' : '-half-stroke'}"></i>`).join('');

function renderProducts() {
    const products = state.products.filter(product => {
        return state.filters.status === 'all' || (product.status || 'available') === state.filters.status;
    }).sort((first, second) => {
        if (state.sort === 'low') return first.price - second.price;
        if (state.sort === 'high') return second.price - first.price;
        return new Date(second.createdAt) - new Date(first.createdAt);
    });
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = products.length ? products.map(product => {
        const status = product.status || 'available';
        const isSold = status === 'sold';
        return `
        <article class="product-card">
            <div class="product-image"><div class="product-thumb" style="background:${product.color}"><i class="fa ${product.icon}"></i></div>
                <span class="product-badge">${product.condition === 'new' ? 'New' : 'Pre-loved'}</span>
                <span class="product-status status-${status}">${status}</span>
            </div>
            <div class="product-info"><h3 class="product-name">${product.name}</h3>
                <div class="product-meta"><span class="price">₹${product.price.toLocaleString('en-IN')}</span><span class="seller">${product.seller}</span></div>
                <div class="product-rating">${icons(product.rating)} <span>${product.rating}</span></div>
                ${isSold ? '<span class="sold-note">This piece has found a home.</span>' : `<button class="add-to-cart" data-product-id="${product.id}"><i class="fa fa-bag-shopping"></i> Add to bag</button>`}
            </div>
        </article>`;
    }).join('') : '<p class="empty-state">No pieces match this availability filter.</p>';
    document.querySelector('.products-header h2').textContent = `${products.length} Featured Find${products.length === 1 ? '' : 's'}`;
    grid.querySelectorAll('.add-to-cart').forEach(button => button.addEventListener('click', () => addToCart(button.dataset.productId)));
}

function renderReviews() {
    document.getElementById('feedbackGrid').innerHTML = state.reviews.map(review => `<article class="feedback-card"><div class="feedback-header">${icons(review.rating)}</div><h4>${review.text}</h4><p>Verified community member sharing a real thrift find.</p><div class="feedback-author"><span>${review.name} · ${review.location}</span><span>Verified buyer</span></div></article>`).join('');
}

async function addToCart(productId) {
    try {
        const result = await api('/api/cart', { method: 'POST', body: JSON.stringify({ productId }) });
        state.cartCount = result.count;
        updateCartLabel();
        showModal('Added to your bag', '<p>This piece is waiting for you. Keep browsing or open your bag to check out.</p><button class="btn-primary" onclick="showCart()">View bag</button>');
    } catch (error) { showModal('Could not add item', `<p>${error.message}</p>`); }
}

function updateCartLabel() { document.querySelector('.search-icon').innerHTML = `<i class="fa fa-shopping-bag"></i> ${state.cartCount}`; }
function applyStatusFilter() { state.filters.status = document.getElementById('statusFilter').value; renderProducts(); }
function sortProducts() { state.sort = document.getElementById('sortFilter').value; renderProducts(); }
function showModal(title, body) { document.getElementById('modalTitle').textContent = title; document.getElementById('modalBody').innerHTML = body; document.getElementById('appModal').classList.add('is-open'); document.getElementById('appModal').setAttribute('aria-hidden', 'false'); }
function closeModal() { document.getElementById('appModal').classList.remove('is-open'); document.getElementById('appModal').setAttribute('aria-hidden', 'true'); }
function authForm(create = false) { return `<form id="authForm"><label>Name${create ? '' : ' (optional)'}<input name="name" ${create ? 'required' : ''}></label><label>Email<input type="email" name="email" required></label><label>Password<input type="password" name="password" minlength="6" required></label><button class="btn-primary" type="submit">${create ? 'Create account' : 'Sign in'}</button></form>`; }
function showSignIn() { showModal('Sign in', authForm()); bindAuthForm(); }
function showLoginForm() { showSignIn(); }
function showCreateAccount() { showModal('Create your account', authForm(true)); bindAuthForm(); }
function showCreateAccountForm() { showCreateAccount(); }
function bindAuthForm() { document.getElementById('authForm').addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/auth', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); showModal(`Welcome, ${result.user.name}`, '<p>Your profile is ready. You can now save and list your favourite pieces.</p>'); } catch (error) { showModal('Sign in failed', `<p>${error.message}</p>`); } }); }
async function showCart() {
    try {
        const [cart, customer] = await Promise.all([api('/api/cart'), api('/api/customer')]);
        if (!cart.length) return showModal('Your bag', '<p>Your bag is empty. Find a piece that feels like you.</p>');
        const total = cart.reduce((sum, item) => sum + item.price, 0);
        showModal('Accept your order', `<div class="cart-list">${cart.map(item => `<p><strong>${item.name}</strong><span>₹${item.price.toLocaleString('en-IN')}</span></p>`).join('')}</div><p class="order-total">Total <strong>₹${total.toLocaleString('en-IN')}</strong></p><form id="orderForm" class="order-form"><label>Name<input name="name" value="${customer.name || ''}" required></label><label>Email<input type="email" name="email" value="${customer.email || ''}" required></label><label>Phone<input name="phone" value="${customer.phone || ''}" required></label><label>Delivery address<textarea name="address" required>${customer.address || ''}</textarea></label><button class="btn-primary" type="submit">Accept order</button></form>`);
        document.getElementById('orderForm').addEventListener('submit', acceptOrder);
    } catch (error) { showModal('Bag unavailable', `<p>${error.message}</p>`); }
}
async function acceptOrder(event) { event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; try { const order = await api('/api/orders', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); state.cartCount = 0; updateCartLabel(); showModal('Order accepted', `<p>Your order <strong>${order.id}</strong> has been accepted.</p><p>Status: ${order.status}</p><p>Delivery updates will be sent to ${order.customer.email}.</p>`); } catch (error) { button.disabled = false; showModal('Order could not be accepted', `<p>${error.message}</p>`); } }
function searchProducts() { showModal('Search the collection', '<input class="search-input" id="searchInput" placeholder="Try denim, dress, shoes..." autofocus>'); const input = document.getElementById('searchInput'); input.addEventListener('input', () => { const query = input.value.toLowerCase(); document.querySelectorAll('.product-card').forEach(card => { card.hidden = query && !card.textContent.toLowerCase().includes(query); }); }); }
function showUserMenu() { showSignIn(); }
function openWhatsApp() { window.open('https://wa.me/919876543210', '_blank', 'noopener'); }
function showAnalytics() { showModal('Sales analytics', '<p>Your closet has generated ₹12,450 this month, with 8 pieces sold.</p>'); }
function showMessages() { showModal('Customer messages', '<p>You have 3 unread conversations waiting in your inbox.</p>'); }
async function showOrderHistory() { try { const orders = await api('/api/orders'); showModal('Order history', orders.length ? `<div class="cart-list">${orders.slice().reverse().map(order => `<p><strong>${order.id}</strong><span>${order.status} · ₹${order.total.toLocaleString('en-IN')}</span></p>`).join('')}</div>` : '<p>Your recent orders will appear here after your first purchase.</p>'); } catch (error) { showModal('Order history unavailable', `<p>${error.message}</p>`); } }
async function loadCustomerInfo() { try { const customer = await api('/api/customer'); document.getElementById('emailDisplay').textContent = customer.email; document.getElementById('phoneDisplay').textContent = customer.phone; document.getElementById('addressDisplay').textContent = customer.address; } catch (error) { showModal('Customer info unavailable', `<p>${error.message}</p>`); } }
function verifyOTP() { const input = document.getElementById('otpInput'); document.getElementById('otpResult').textContent = input.value === '123456' ? 'OTP verified.' : 'Try 123456 for this demo.'; }

function openInstagram() {
    const username = (state.instagram && state.instagram.username) ? state.instagram.username.replace(/^@+/, '') : 'THEthritzz';
    window.open(`https://instagram.com/${username}`, '_blank', 'noopener,noreferrer');
}

function updateInstagramDOM() {
    const ig = state.instagram || {};
    const handle = (ig.username ? ig.username.replace(/^@+/, '') : 'THEthritzz');
    
    // Update community button
    const communityHandle = document.getElementById('communityIgHandle');
    if (communityHandle) communityHandle.textContent = `@${handle}`;
    
    // Update feed section handle
    const feedHandle = document.getElementById('feedIgHandle');
    if (feedHandle) feedHandle.textContent = handle;
    
    // Update header dot
    const dot = document.getElementById('topBarIgDot');
    if (dot) {
        if (ig.connected || ig.hasToken) {
            dot.className = 'ig-dot is-connected';
            dot.setAttribute('title', `Connected: @${handle}`);
        } else {
            dot.className = 'ig-dot';
            dot.setAttribute('title', `Linked handle: @${handle}`);
        }
    }
}

async function loadInstagramStatus() {
    try {
        const data = await api('/api/instagram/status');
        state.instagram = data.instagram || {};
        updateInstagramDOM();
    } catch (e) {
        console.warn('Could not load Instagram status', e);
    }
}

async function loadInstagramPosts() {
    try {
        const posts = await api('/api/instagram/posts');
        state.instagramPosts = Array.isArray(posts) ? posts : [];
        renderInstagramFeed();
    } catch (e) {
        console.warn('Could not load Instagram posts', e);
    }
}

function renderInstagramFeed() {
    const grid = document.getElementById('instagramPostsGrid');
    if (!grid) return;
    
    const posts = state.instagramPosts || [];
    const handle = (state.instagram && state.instagram.username ? state.instagram.username.replace(/^@+/, '') : 'THEthritzz');
    
    if (!posts.length) {
        grid.innerHTML = `
            <div class="ig-empty-feed">
                <div class="ig-empty-icon"><i class="fa-brands fa-instagram"></i></div>
                <h3>Connect your Instagram to Showcase Live Drops</h3>
                <p>Display your Instagram photos, thrifted curation posts, and styling reels right here on your store.</p>
                <div class="ig-empty-actions">
                    <button class="btn-primary" onclick="showInstagramSettings('tab-profile')"><i class="fa fa-link"></i> Link Handle</button>
                    <button class="btn-secondary" onclick="loadSampleInstagramPosts()"><i class="fa fa-sparkles"></i> Load Demo Drops</button>
                    <button class="btn-subtle" onclick="showInstagramSettings('tab-token')"><i class="fa fa-key"></i> Auto-Sync API</button>
                </div>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = posts.map(post => {
        const dateStr = post.postedAt ? new Date(post.postedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'Recent';
        const link = post.permalink || `https://instagram.com/${handle}`;
        return `
            <article class="ig-card">
                <div class="ig-media-wrapper">
                    <img src="${post.imageUrl}" alt="${post.caption ? post.caption.replace(/"/g, '&quot;') : 'Instagram post'}" loading="lazy" onerror="this.src='images/placeholder.jpg';">
                    <div class="ig-card-overlay">
                        <a href="${link}" target="_blank" rel="noopener noreferrer" class="ig-overlay-btn"><i class="fa-brands fa-instagram"></i> View Post</a>
                    </div>
                    <span class="ig-badge"><i class="fa-brands fa-instagram"></i></span>
                </div>
                <div class="ig-card-info">
                    <div class="ig-meta">
                        <span class="ig-date">${dateStr}</span>
                        <span class="ig-likes"><i class="fa fa-heart"></i> ${post.likes || Math.floor(Math.random() * 80 + 45)}</span>
                    </div>
                    <p class="ig-caption">${post.caption || 'Curated thrift collection drop.'}</p>
                </div>
            </article>
        `;
    }).join('');
}

let currentIgTab = 'tab-profile';

function showInstagramSettings(initialTab) {
    if (initialTab) currentIgTab = initialTab;
    api('/api/instagram/status')
        .then(data => {
            state.instagram = data.instagram || {};
            updateInstagramDOM();
            renderInstagramModalBody();
            document.getElementById('instagramSettingsModal').classList.add('is-open');
            document.getElementById('instagramSettingsModal').setAttribute('aria-hidden', 'false');
        })
        .catch(error => {
            showModal('Error', `<p>${error.message}</p>`);
        });
}

function renderInstagramModalBody() {
    const ig = state.instagram || {};
    const handle = (ig.username ? ig.username.replace(/^@+/, '') : 'THEthritzz');
    const isConnected = Boolean(ig.connected);
    const postCount = (state.instagramPosts || []).length;
    
    const body = document.getElementById('instagramModalBody');
    if (!body) return;
    
    body.innerHTML = `
        <div class="ig-modal-container">
            <div class="ig-status-banner ${isConnected ? 'is-connected' : 'is-linked'}">
                <div class="ig-status-info">
                    <span class="ig-status-indicator"></span>
                    <div>
                        <strong>${isConnected ? 'Auto-Sync Connected' : 'Profile Linked'}</strong>
                        <span class="ig-status-subtitle">@${handle} ${isConnected ? '· Graph API Active' : '· Direct link active'}</span>
                    </div>
                </div>
                <div class="ig-status-meta">
                    ${ig.lastSync ? `<span class="ig-sync-badge"><i class="fa fa-rotate"></i> Synced ${new Date(ig.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
                </div>
            </div>
            
            <div class="ig-tabs">
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-profile' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-profile')"><i class="fa fa-user"></i> Profile & Handle</button>
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-token' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-token')"><i class="fa fa-bolt"></i> Auto-Sync (API)</button>
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-posts' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-posts')"><i class="fa fa-images"></i> Feed Posts (${postCount})</button>
            </div>
            
            <div id="igModalAlert" class="ig-modal-alert" style="display: none;"></div>
            
            <!-- Tab 1: Profile Handle -->
            <div class="ig-tab-content" id="tab-profile" style="display: ${currentIgTab === 'tab-profile' ? 'block' : 'none'};">
                <form id="igProfileForm" onsubmit="saveInstagramHandle(event)">
                    <div class="form-group">
                        <label for="igUsernameInput">Instagram Handle / Username</label>
                        <div class="input-with-prefix">
                            <span class="input-prefix">@</span>
                            <input type="text" id="igUsernameInput" value="${handle}" placeholder="your_store_handle" required autocomplete="off">
                        </div>
                        <p class="form-hint">Links the header "IG" button, community section, and footer icons to <code>https://instagram.com/${handle}</code>.</p>
                    </div>
                    
                    <div class="form-actions-inline">
                        <button type="button" class="btn-secondary" onclick="testInstagramHandle()"><i class="fa fa-arrow-up-right-from-square"></i> Test Link</button>
                        <button type="submit" class="btn-primary" id="saveHandleBtn"><i class="fa fa-check"></i> Save Handle</button>
                    </div>
                </form>
            </div>
            
            <!-- Tab 2: Graph API & Auto-Sync -->
            <div class="ig-tab-content" id="tab-token" style="display: ${currentIgTab === 'tab-token' ? 'block' : 'none'};">
                <form id="igTokenForm" onsubmit="saveInstagramToken(event)">
                    <div class="form-group">
                        <label for="igTokenInput">Instagram User Access Token (Graph API)</label>
                        <textarea id="igTokenInput" rows="3" placeholder="Paste your Instagram Graph API or Basic Display Access Token here...">${ig.hasToken ? '••••••••••••••••••••••••••••••••••••••' : ''}</textarea>
                        <p class="form-hint">Generate a User Access Token in <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Meta Graph API Explorer</a> or Meta for Developers to automatically pull your feed posts.</p>
                    </div>
                    
                    <div class="form-actions-inline">
                        <button type="submit" class="btn-primary" id="saveTokenBtn"><i class="fa fa-shield-halved"></i> Save & Verify Token</button>
                        <button type="button" class="btn-secondary" onclick="manualInstagramSync()"><i class="fa fa-rotate"></i> Sync Feed Now</button>
                    </div>
                </form>
                
                <details class="ig-oauth-details">
                    <summary><i class="fa fa-key"></i> Advanced Meta App Credentials (OAuth)</summary>
                    <form id="igOAuthForm" onsubmit="saveInstagramOAuth(event)" style="margin-top: 15px;">
                        <div class="form-group">
                            <label for="igClientIdInput">Meta App ID (Client ID)</label>
                            <input type="text" id="igClientIdInput" placeholder="e.g. 123456789012345">
                        </div>
                        <div class="form-group">
                            <label for="igClientSecretInput">Meta App Secret</label>
                            <input type="password" id="igClientSecretInput" placeholder="e.g. abcd1234efgh5678">
                        </div>
                        <div class="form-group">
                            <label>Valid OAuth Redirect URI</label>
                            <input type="text" readonly value="${window.location.origin}/api/instagram/callback" onclick="this.select()">
                            <p class="form-hint">Add this URL to your Meta App's "Valid OAuth Redirect URIs".</p>
                        </div>
                        <button type="submit" class="btn-secondary"><i class="fa fa-save"></i> Save Credentials</button>
                    </form>
                </details>
            </div>
            
            <!-- Tab 3: Synced Feed Posts -->
            <div class="ig-tab-content" id="tab-posts" style="display: ${currentIgTab === 'tab-posts' ? 'block' : 'none'};">
                <div class="ig-posts-manager-header">
                    <span><strong>${postCount}</strong> posts in store gallery</span>
                    <div class="ig-posts-actions">
                        <button type="button" class="btn-secondary btn-sm" onclick="loadSampleInstagramPosts()"><i class="fa fa-sparkles"></i> Load Demo Posts</button>
                        <button type="button" class="btn-subtle btn-sm text-danger" onclick="clearInstagramPosts()"><i class="fa fa-trash"></i> Clear</button>
                    </div>
                </div>
                
                <div class="ig-posts-preview-grid">
                    ${postCount > 0 ? (state.instagramPosts || []).map(p => `
                        <div class="ig-preview-item">
                            <img src="${p.imageUrl}" alt="preview">
                            <div class="ig-preview-caption">${(p.caption || '').slice(0, 50)}...</div>
                        </div>
                    `).join('') : '<p class="empty-state">No Instagram posts synced yet. Click "Load Demo Posts" or sync from Graph API.</p>'}
                </div>
                
                <div class="ig-disconnect-wrapper">
                    <button type="button" class="btn-subtle text-danger" onclick="disconnectInstagram()"><i class="fa fa-unlink"></i> Disconnect Account</button>
                </div>
            </div>
        </div>
    `;
}

function switchInstagramTab(tabId) {
    currentIgTab = tabId;
    document.querySelectorAll('.ig-tab-btn').forEach(btn => btn.classList.remove('is-active'));
    document.querySelectorAll('.ig-tab-content').forEach(tab => tab.style.display = 'none');
    
    const activeBtn = Array.from(document.querySelectorAll('.ig-tab-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
    if (activeBtn) activeBtn.classList.add('is-active');
    
    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.style.display = 'block';
}

function showModalNotice(message, isError = false) {
    const alert = document.getElementById('igModalAlert');
    if (!alert) return;
    alert.className = `ig-modal-alert ${isError ? 'is-error' : 'is-success'}`;
    alert.innerHTML = message;
    alert.style.display = 'block';
    setTimeout(() => { if (alert) alert.style.display = 'none'; }, 4500);
}

function testInstagramHandle() {
    const input = document.getElementById('igUsernameInput');
    const handle = (input ? input.value : (state.instagram?.username || 'THEthritzz')).trim().replace(/^@+/, '');
    if (!handle) return showModalNotice('Please enter an Instagram handle first.', true);
    window.open(`https://instagram.com/${handle}`, '_blank', 'noopener,noreferrer');
}

async function saveInstagramHandle(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('igUsernameInput');
    const raw = input ? input.value.trim().replace(/^@+/, '') : '';
    if (!raw) return showModalNotice('Please enter a valid Instagram handle.', true);
    
    const btn = document.getElementById('saveHandleBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...'; }
    
    try {
        const res = await api('/api/instagram/config', {
            method: 'POST',
            body: JSON.stringify({ username: raw })
        });
        if (res.success) {
            state.instagram = res.instagram;
            updateInstagramDOM();
            renderInstagramModalBody();
            showModalNotice(`Instagram handle saved as <strong>@${raw}</strong>! Website links updated.`, false);
        }
    } catch (e) {
        showModalNotice(`Failed to save: ${e.message}`, true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-check"></i> Save Handle'; }
    }
}

async function saveInstagramToken(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('igTokenInput');
    const token = input ? input.value.trim() : '';
    if (!token || token.startsWith('•••')) return showModalNotice('Please enter an access token to verify.', true);
    
    const btn = document.getElementById('saveTokenBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Verifying...'; }
    
    try {
        const res = await api('/api/instagram/config', {
            method: 'POST',
            body: JSON.stringify({ accessToken: token })
        });
        if (res.success) {
            state.instagram = res.instagram;
            updateInstagramDOM();
            renderInstagramModalBody();
            showModalNotice('Access token verified and connected successfully! You can now sync posts.', false);
        }
    } catch (e) {
        showModalNotice(`Verification failed: ${e.message}`, true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-shield-halved"></i> Save & Verify Token'; }
    }
}

async function saveInstagramOAuth(event) {
    if (event) event.preventDefault();
    const clientId = document.getElementById('igClientIdInput')?.value.trim();
    const clientSecret = document.getElementById('igClientSecretInput')?.value.trim();
    try {
        const res = await api('/api/instagram/config', {
            method: 'POST',
            body: JSON.stringify({ clientId, clientSecret })
        });
        if (res.success) {
            showModalNotice('OAuth credentials saved.', false);
        }
    } catch (e) {
        showModalNotice(`Error: ${e.message}`, true);
    }
}

async function manualInstagramSync() {
    try {
        showModalNotice('Syncing latest posts from Instagram...', false);
        const result = await api('/api/instagram/sync', { method: 'POST' });
        if (result.success) {
            await loadInstagramPosts();
            renderInstagramModalBody();
            showModalNotice(result.message || 'Posts synced successfully!', false);
        }
    } catch (error) {
        showModalNotice(`Sync failed: ${error.message}`, true);
    }
}

async function loadSampleInstagramPosts() {
    try {
        const res = await api('/api/instagram/add-sample-posts', { method: 'POST' });
        if (res.success) {
            state.instagramPosts = res.posts || [];
            renderInstagramFeed();
            renderInstagramModalBody();
            showModalNotice('Demo Instagram drops loaded and displayed in your feed!', false);
        }
    } catch (e) {
        showModalNotice(`Could not load samples: ${e.message}`, true);
    }
}

async function clearInstagramPosts() {
    try {
        await api('/api/instagram/clear-posts', { method: 'POST' });
        state.instagramPosts = [];
        renderInstagramFeed();
        renderInstagramModalBody();
        showModalNotice('Feed posts cleared.', false);
    } catch (e) {
        showModalNotice(`Failed to clear: ${e.message}`, true);
    }
}

async function disconnectInstagram() {
    try {
        const result = await api('/api/instagram/disconnect', { method: 'POST' });
        if (result.success) {
            await loadInstagramStatus();
            renderInstagramModalBody();
            showModalNotice('Instagram account disconnected.', false);
        }
    } catch (error) {
        showModalNotice(`Error: ${error.message}`, true);
    }
}

function closeInstagramModal() {
    document.getElementById('instagramSettingsModal').classList.remove('is-open');
    document.getElementById('instagramSettingsModal').setAttribute('aria-hidden', 'true');
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        [state.products, state.reviews] = await Promise.all([api('/api/products'), api('/api/reviews')]);
        const cart = await api('/api/cart');
        state.cartCount = cart.length;
        updateCartLabel();
        renderProducts();
        renderReviews();
    } catch (error) {
        document.getElementById('productsGrid').innerHTML = '<p class="empty-state">The collection is temporarily unavailable.</p>';
    }
    
    // Load Instagram Status and Posts
    loadInstagramStatus();
    loadInstagramPosts();
    
    document.querySelector('.menu-toggle').addEventListener('click', event => {
        const menu = document.querySelector('.nav-menu');
        const open = menu.classList.toggle('is-open');
        event.currentTarget.setAttribute('aria-expanded', open);
    });
    document.querySelectorAll('.nav-menu a').forEach(link => link.addEventListener('click', () => document.querySelector('.nav-menu').classList.remove('is-open')));
    document.querySelectorAll('.instagram-connect-btn').forEach(btn => btn.addEventListener('click', () => showInstagramSettings()));
});
