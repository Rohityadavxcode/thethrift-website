// THEthrift - Client State & Interactive Marketplace Architecture
const state = {
    products: [],
    reviews: [],
    filters: { status: 'all' },
    sort: 'newest',
    cart: [],
    cartCount: 0,
    customer: {},
    currentUser: null,
    isOwner: localStorage.getItem('thethrift_owner') === 'true' && Boolean(localStorage.getItem('thethrift_owner_token')),
    instagram: { connected: false, username: 'thethriftzz' },
    instagramPosts: [],
    activeAuthTab: 'phone',
    activeQrTab: 'website',
    instantBuyItem: null,
    otpData: { identifier: '', type: 'phone', demoOtp: '', name: '' }
};

// API Client Helper
const api = async (endpoint, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = localStorage.getItem('thethrift_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const ownerToken = localStorage.getItem('thethrift_owner_token');
    if (ownerToken) headers['x-owner-token'] = ownerToken;

    const response = await fetch(endpoint, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
};

// Star rating icon generator
const icons = rating => Array.from({ length: 5 }, (_, index) => {
    if (index < Math.floor(rating)) return '<i class="fa fa-star"></i>';
    if (index < rating) return '<i class="fa fa-star-half-stroke"></i>';
    return '<i class="fa-regular fa-star"></i>';
}).join('');

// --- Touch & Motion Effects: Price Pop & Floating Chips ---
function triggerPricePop(element, price, event) {
    if (!element) return;
    element.classList.remove('price-popped');
    void element.offsetWidth; // Trigger DOM reflow
    element.classList.add('price-popped');

    // Create floating pop chip
    const pop = document.createElement('div');
    pop.className = 'floating-price-pop';
    pop.innerHTML = `<i class="fa fa-tag"></i> ₹${Number(price).toLocaleString('en-IN')}`;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    if (event) {
        if (event.touches && event.touches[0]) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        } else if (event.clientX && event.clientY) {
            x = event.clientX;
            y = event.clientY;
        }
    } else {
        const rect = element.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top;
    }

    pop.style.left = `${Math.max(10, Math.min(window.innerWidth - 120, x - 50))}px`;
    pop.style.top = `${Math.max(10, y - 30)}px`;

    document.body.appendChild(pop);
    setTimeout(() => { if (pop && pop.parentNode) pop.parentNode.removeChild(pop); }, 850);
}

// Attach motion listeners to prices
function setupPriceMotionEffects() {
    document.querySelectorAll('.price, .drop-price-tag, .product-card').forEach(el => {
        el.addEventListener('click', e => {
            const priceText = el.textContent.replace(/[^\d]/g, '') || '999';
            triggerPricePop(el, priceText, e);
        });
        el.addEventListener('touchstart', e => {
            const priceText = el.textContent.replace(/[^\d]/g, '') || '999';
            triggerPricePop(el, priceText, e);
        }, { passive: true });
    });
}

// --- Catalog & Product Rendering with Instant Buy ---
function renderProducts() {
    const products = (state.products || []).filter(product => {
        return state.filters.status === 'all' || (product.status || 'available') === state.filters.status;
    }).sort((first, second) => {
        if (state.sort === 'low') return first.price - second.price;
        if (state.sort === 'high') return second.price - first.price;
        return new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
    });

    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    grid.innerHTML = products.length ? products.map(product => {
        const status = product.status || 'available';
        const isSold = status === 'sold';
        const isIgDrop = Boolean(product.isInstagramDrop || product.instagramId || (typeof product.id === 'string' && product.id.startsWith('ig-')) || (typeof product.id === 'string' && product.id.startsWith('drop_')));
        return `
        <article class="product-card" data-product-id="${product.id}">
            <div class="product-image" onclick="openDropDetailsModal('${product.id}')" style="cursor: pointer;" title="Click to view piece details">
                ${product.image ? `
                    <img src="${product.image}" alt="${product.name}" class="product-photo" loading="lazy" onerror="this.onerror=null; this.src='images/placeholder.svg';">
                ` : `
                    <div class="product-thumb" style="background:${product.color || '#d7c1a8'}">
                        <i class="fa ${product.icon || 'fa-shirt'}"></i>
                    </div>
                `}
                ${isIgDrop ? `
                    <span class="product-badge" style="background: #fdf2e9; color: #d35400; border: 1px solid #f5cba7;"><i class="fa-brands fa-instagram" style="color: #e4405f;"></i> IG Drop</span>
                ` : `
                    <span class="product-badge">${product.condition === 'new' ? 'New' : 'Pre-loved'}</span>
                `}
                <span class="product-status status-${status}">${status}</span>
            </div>
            <div class="product-info">
                <h3 class="product-name" onclick="openDropDetailsModal('${product.id}')" style="cursor: pointer;" title="Click to view piece details">${product.name}</h3>
                <div class="product-meta">
                    <span class="price" onclick="triggerPricePop(this, ${product.price}, event)">₹${Number(product.price).toLocaleString('en-IN')}</span>
                    <span class="seller">${product.seller || 'Curated Seller'}</span>
                </div>
                <div class="product-rating">${icons(product.rating || 4.8)} <span>${product.rating || '4.8'}</span></div>
                ${isSold ? `
                    <span class="sold-note"><i class="fa fa-check"></i> Sold & Delivered to customer.</span>
                ` : `
                    <div class="product-actions-row">
                        <button class="btn-instant-buy-prod" onclick="instantBuyProduct('${product.id}')"><i class="fa fa-bolt"></i> Buy Now</button>
                        <button class="add-to-cart" onclick="addToCart('${product.id}')" title="Add to bag"><i class="fa fa-bag-shopping"></i></button>
                    </div>
                `}
            </div>
        </article>`;
    }).join('') : '<p class="empty-state">No pieces match this availability filter.</p>';

    const headerTitle = document.querySelector('.products-header h2');
    if (headerTitle) {
        headerTitle.textContent = `${products.length} Featured Find${products.length === 1 ? '' : 's'}`;
    }
    setupPriceMotionEffects();
}

function renderReviews() {
    const grid = document.getElementById('feedbackGrid');
    if (!grid) return;
    grid.innerHTML = (state.reviews || []).map(review => `
        <article class="feedback-card">
            <div class="feedback-header">${icons(review.rating || 5)}</div>
            <h4>"${review.text}"</h4>
            <p>Verified community member sharing an authentic pre-loved fashion experience.</p>
            <div class="feedback-author">
                <span>${review.name} · ${review.location || 'India'}</span>
                <span><i class="fa fa-circle-check" style="color: #2e7d32;"></i> Verified buyer</span>
            </div>
        </article>
    `).join('');
}

function applyStatusFilter() {
    const select = document.getElementById('statusFilter');
    if (select) state.filters.status = select.value;
    renderProducts();
}

function sortProducts() {
    const select = document.getElementById('sortFilter');
    if (select) state.sort = select.value;
    renderProducts();
}

// --- Cart / Shopping Bag ---
async function addToCart(productId) {
    try {
        const idPayload = (typeof productId === 'number' || /^\d+$/.test(productId)) ? Number(productId) : String(productId);
        const result = await api('/api/cart', {
            method: 'POST',
            body: JSON.stringify({ productId: idPayload })
        });
        state.cartCount = result.count;
        updateCartLabel();
        showModal('Added to your bag', `
            <p>This curated piece is reserved in your bag. Continue exploring or proceed to checkout.</p>
            <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <button class="btn-secondary" onclick="closeModal()">Continue Shopping</button>
                <button class="btn-primary" onclick="showCart()"><i class="fa fa-bag-shopping"></i> View Bag & Checkout</button>
            </div>
        `);
    } catch (error) {
        showModal('Could not add item', `<p>${error.message}</p>`);
    }
}

async function removeFromCart(productId) {
    try {
        const idPayload = (typeof productId === 'number' || /^\d+$/.test(productId)) ? Number(productId) : String(productId);
        const res = await api('/api/cart/remove', {
            method: 'POST',
            body: JSON.stringify({ productId: idPayload })
        });
        state.cartCount = res.count;
        state.cart = res.cart || [];
        updateCartLabel();
        showCart();
    } catch (error) {
        showModal('Error', `<p>${error.message}</p>`);
    }
}

function updateCartLabel() {
    const badge = document.getElementById('cartCountBadge');
    if (badge) badge.textContent = state.cartCount;
}

async function showCart() {
    try {
        const [cart, customer] = await Promise.all([api('/api/cart'), api('/api/customer')]);
        state.cart = cart;
        state.cartCount = cart.length;
        updateCartLabel();

        if (!cart.length) {
            return showModal('Your bag is empty', `
                <div style="text-align: center; padding: 20px 0;">
                    <i class="fa fa-bag-shopping" style="font-size: 42px; color: #84543c; margin-bottom: 12px;"></i>
                    <p>There are no pieces waiting in your bag yet.</p>
                    <button class="btn-primary" onclick="closeModal(); location.href='#shop';" style="margin-top: 15px;">Browse Available Finds</button>
                </div>
            `);
        }

        const total = cart.reduce((sum, item) => sum + Number(item.price), 0);
        const activeCust = state.currentUser || customer || {};

        showModal('Review & Checkout', `
            <div class="cart-list">
                ${cart.map(item => `
                    <div class="cart-item-row">
                        <div class="item-details">
                            <strong>${item.name}</strong>
                            <span style="font-size: 13px; color: #666;">₹${Number(item.price).toLocaleString('en-IN')} · ${item.condition === 'new' ? 'New' : 'Pre-loved'}</span>
                        </div>
                        <button type="button" class="btn-remove-item" onclick="removeFromCart('${item.id}')" title="Remove item">&times;</button>
                    </div>
                `).join('')}
            </div>

            <p class="order-total" style="display: flex; justify-content: space-between; margin: 15px 0; padding: 12px 0; border-top: 2px solid var(--line); border-bottom: 2px solid var(--line); font-size: 16px;">
                <span>Total Amount:</span>
                <strong onclick="triggerPricePop(this, ${total}, event)">₹${total.toLocaleString('en-IN')}</strong>
            </p>

            <form id="orderForm" class="order-form" onsubmit="acceptOrder(event)">
                <div class="form-group" style="margin-bottom: 10px;">
                    <label style="font-size: 12px; font-weight: 600;">Full Name *</label>
                    <input name="name" value="${activeCust.name || ''}" placeholder="Enter full name" required style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px;">
                </div>
                <div class="form-group" style="margin-bottom: 10px;">
                    <label style="font-size: 12px; font-weight: 600;">Mobile Number *</label>
                    <input type="tel" name="phone" value="${activeCust.phone || ''}" placeholder="10-digit mobile number" required style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px;">
                </div>
                <div class="form-group" style="margin-bottom: 10px;">
                    <label style="font-size: 12px; font-weight: 600;">Email Address</label>
                    <input type="email" name="email" value="${activeCust.email || ''}" placeholder="name@domain.com" style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px;">
                </div>
                <div class="form-group" style="margin-bottom: 15px;">
                    <label style="font-size: 12px; font-weight: 600;">Delivery Address *</label>
                    <textarea name="address" required placeholder="Apartment / Flat, Street, City, State, PIN" style="width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px;" rows="2">${activeCust.address || ''}</textarea>
                </div>
                <button class="btn-primary" type="submit" id="btnSubmitOrder" style="width: 100%; padding: 12px;"><i class="fa fa-shield-check"></i> Place & Confirm Order (Cash/UPI on Delivery)</button>
            </form>
        `);
    } catch (error) {
        showModal('Bag unavailable', `<p>${error.message}</p>`);
    }
}

async function acceptOrder(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Connecting to database...';
    }

    try {
        const formData = Object.fromEntries(new FormData(form));
        const order = await api('/api/orders', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        state.cartCount = 0;
        state.cart = [];
        updateCartLabel();

        // Refresh products and drops list so sold piece shows sold immediately across entire store
        const [updatedProducts, updatedDrops] = await Promise.all([
            api('/api/products'),
            api('/api/instagram/posts')
        ]);
        state.products = updatedProducts;
        state.instagramPosts = updatedDrops;
        renderProducts();
        renderInstagramFeed();

        showModal('Order Accepted by Database!', `
            <div style="text-align: center; padding: 10px 0;">
                <i class="fa fa-circle-check" style="font-size: 48px; color: #2e7d32; margin-bottom: 12px;"></i>
                <h3>Thank you, ${order.customer.name}!</h3>
                <p style="margin: 8px 0;">Your order <strong>${order.id}</strong> has been stored and accepted.</p>
                <p style="font-size: 13px; color: #666;">Status: <strong>${order.status}</strong> · Total: <strong>₹${order.total.toLocaleString('en-IN')}</strong></p>
                <p style="font-size: 13px; color: #666; margin-top: 4px;">Updates sent to <strong>${order.customer.phone}</strong>.</p>
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn-secondary" onclick="showCustomerAccount('orders')"><i class="fa fa-clock-rotate-left"></i> View in Order History</button>
                    <button class="btn-primary" onclick="closeModal()">Back to Marketplace</button>
                </div>
            </div>
        `);
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fa fa-shield-check"></i> Place & Confirm Order';
        }
        showModal('Order Failed', `<p>${error.message}</p>`);
    }
}

// --- Instant Buy 1-Click Checkout (For Products & Drops) ---
function instantBuyProduct(productId) {
    const product = (state.products || []).find(p => p.id === productId || String(p.id) === String(productId) || (Number(productId) && Number(p.id) === Number(productId)));
    if (!product) return;
    openInstantBuyModal({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image || product.imageUrl || '',
        category: product.category,
        condition: product.condition || 'pre-loved'
    });
}

function instantBuyDrop(dropId) {
    const drop = (state.instagramPosts || state.instagramSyncedPosts || []).find(d => d.id === dropId || d.instagramId === dropId);
    if (!drop) return;
    openInstantBuyModal({
        id: drop.id || drop.instagramId,
        name: drop.name || drop.caption?.slice(0, 45) || 'Curated Instagram Drop',
        price: drop.price || 1499,
        image: drop.imageUrl || 'images/denim-jacket.jpeg',
        condition: 'vintage'
    });
}

function openInstantBuyModal(item) {
    state.instantBuyItem = item;
    const modal = document.getElementById('instantBuyModal');
    if (!modal) return;

    const summaryBox = document.getElementById('instantBuyItemSummary');
    if (summaryBox) {
        summaryBox.innerHTML = `
            <img src="${item.image || 'images/placeholder.svg'}" alt="${item.name}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 6px;" onerror="this.onerror=null; this.src='images/placeholder.svg';">
            <div style="flex: 1;">
                <h4 style="font-size: 15px; color: var(--forest);">${item.name}</h4>
                <div style="display: flex; gap: 10px; align-items: center; margin-top: 4px;">
                    <strong class="price" style="font-size: 17px; color: #244b3a;">₹${Number(item.price).toLocaleString('en-IN')}</strong>
                    <span style="font-size: 12px; color: #666; text-transform: capitalize;">${item.condition || 'Pre-loved'}</span>
                </div>
            </div>
        `;
    }

    const cust = state.currentUser || state.customer || {};
    document.getElementById('buyCustName').value = cust.name || '';
    document.getElementById('buyCustPhone').value = cust.phone || '';
    document.getElementById('buyCustEmail').value = cust.email || '';
    document.getElementById('buyCustAddress').value = cust.address || '';

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeInstantBuyModal() {
    const modal = document.getElementById('instantBuyModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

async function submitInstantOrder(event) {
    if (event) event.preventDefault();
    const item = state.instantBuyItem;
    if (!item) return;

    const btn = document.getElementById('btnConfirmInstantOrder');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Securing piece in database...';
    }

    const payload = {
        item,
        name: document.getElementById('buyCustName').value.trim(),
        phone: document.getElementById('buyCustPhone').value.trim(),
        email: document.getElementById('buyCustEmail').value.trim(),
        address: document.getElementById('buyCustAddress').value.trim(),
        paymentMethod: document.getElementById('buyPaymentMode').value
    };

    try {
        const res = await api('/api/orders', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        closeInstantBuyModal();

        // Refresh catalog & drops immediately so the piece shows as SOLD
        const [updatedProds, updatedDrops] = await Promise.all([
            api('/api/products'),
            api('/api/instagram/posts')
        ]);
        state.products = updatedProds;
        state.instagramPosts = updatedDrops;
        renderProducts();
        renderInstagramFeed();

        showModal('Piece Claimed & Order Accepted!', `
            <div style="text-align: center; padding: 10px 0;">
                <i class="fa fa-circle-check" style="font-size: 48px; color: #2e7d32; margin-bottom: 12px;"></i>
                <h3>Order Confirmed: ${res.order.id}</h3>
                <p style="margin: 8px 0;">You have successfully purchased <strong>${item.name}</strong> for <strong>₹${Number(item.price).toLocaleString('en-IN')}</strong>.</p>
                <p style="font-size: 13px; color: #666;">Payment: <strong>${payload.paymentMethod}</strong>.</p>
                <p style="font-size: 13px; color: #666; margin-top: 4px;">Delivery dispatched to <strong>${payload.address}</strong>.</p>
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn-primary" onclick="closeModal()">Continue Shopping</button>
                    <button class="btn-secondary" onclick="closeModal(); showCustomerAccount('orders');"><i class="fa fa-clock-rotate-left"></i> My Orders</button>
                    <a href="https://wa.me/919876543210?text=Hi%20THEthrift!%20I%20just%20placed%20order%20${res.order.id}%20for%20${encodeURIComponent(item.name)}.%20Please%20confirm!" target="_blank" rel="noopener noreferrer" class="btn-wa-instant" style="padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px;"><i class="fa-brands fa-whatsapp"></i> Confirm on WhatsApp</a>
                </div>
            </div>
        `);
    } catch (error) {
        showModal('Could Not Complete Order', `<p>${error.message}</p>`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-shield-check"></i> Accept & Confirm Order';
        }
    }
}

function buyCurrentItemOnWhatsApp() {
    const item = state.instantBuyItem;
    if (!item) return;
    const name = document.getElementById('buyCustName')?.value.trim() || 'Customer';
    const address = document.getElementById('buyCustAddress')?.value.trim() || 'My Address';
    const phone = '919876543210';
    const msg = `Hi THEthrift! I want to buy "${item.name}" for ₹${item.price}. My delivery address is: ${address}. Please confirm availability and shipping!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

function buyDropViaWhatsApp(dropId) {
    const drop = (state.instagramPosts || state.instagramSyncedPosts || []).find(d => d.id === dropId || d.instagramId === dropId);
    if (!drop) return;
    const price = drop.price || 1499;
    const name = drop.name || drop.caption?.slice(0, 40) || 'Vintage Drop';
    const phone = '919876543210';
    const msg = `Hi THEthrift! I want to buy this live drop: "${name}" for ₹${price}. Please confirm availability!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

// --- QR Code Scanner Modal (For Public: Mobile Web, WhatsApp, Instagram) ---
function showQrModal(initialTab = 'website') {
    const modal = document.getElementById('qrModal');
    if (!modal) return;
    switchQrTab(initialTab);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function switchQrTab(tab) {
    state.activeQrTab = tab;
    const tabWeb = document.getElementById('qrTabWebsiteBtn');
    const tabWA = document.getElementById('qrTabWhatsAppBtn');
    const tabIG = document.getElementById('qrTabInstagramBtn');

    if (tabWeb) tabWeb.classList.toggle('is-active', tab === 'website');
    if (tabWA) tabWA.classList.toggle('is-active', tab === 'whatsapp');
    if (tabIG) tabIG.classList.toggle('is-active', tab === 'instagram');

    const container = document.getElementById('qrCodeContainer');
    const labelTitle = document.getElementById('qrLabelTitle');
    const labelDesc = document.getElementById('qrLabelDesc');

    let targetUrl = window.location.origin;
    let title = 'Open THEthrift on Mobile';
    let desc = 'Scan with your phone camera to browse and order directly on mobile.';

    const handle = (state.instagram && state.instagram.username) ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz';

    if (tab === 'whatsapp') {
        targetUrl = 'https://wa.me/919876543210?text=Hi%20THEthrift!%20I%20am%20interested%20in%20buying%20thrift%20pieces';
        title = 'Chat & Buy on WhatsApp';
        desc = 'Scan with phone camera to chat directly with THEthrift and claim fresh drops.';
    } else if (tab === 'instagram') {
        targetUrl = `https://instagram.com/${handle}`;
        title = `Follow @${handle} on Instagram`;
        desc = 'Scan with phone camera to view daily drops, reels, and styling curations.';
    }

    if (labelTitle) labelTitle.textContent = title;
    if (labelDesc) labelDesc.textContent = desc;

    if (container) {
        const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(targetUrl)}`;
        container.innerHTML = `<img src="${qrImgUrl}" alt="QR Code" loading="lazy">`;
    }
}

function copyQrCurrentLink() {
    let url = window.location.origin;
    const handle = (state.instagram && state.instagram.username) ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz';
    if (state.activeQrTab === 'whatsapp') {
        url = 'https://wa.me/919876543210?text=Hi%20THEthrift!';
    } else if (state.activeQrTab === 'instagram') {
        url = `https://instagram.com/${handle}`;
    }
    navigator.clipboard.writeText(url).then(() => {
        showModal('Link Copied!', `<p>Copied <strong>${url}</strong> to clipboard. Share it with your friends or scan directly!</p>`);
    }).catch(() => {
        prompt('Copy link:', url);
    });
}

function openQrDirectLink() {
    let url = window.location.origin;
    const handle = (state.instagram && state.instagram.username) ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz';
    if (state.activeQrTab === 'whatsapp') {
        url = 'https://wa.me/919876543210?text=Hi%20THEthrift!';
    } else if (state.activeQrTab === 'instagram') {
        url = `https://instagram.com/${handle}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

// --- Store Owner Portal & Admin Controls (Strictly Isolated from Public) ---
let currentOwnerTab = 'ig';

function renderOwnerControls() {
    const isOwner = state.isOwner;
    const ownerBar = document.getElementById('ownerBar');
    if (ownerBar) ownerBar.style.display = isOwner ? 'block' : 'none';

    // Toggle all elements with class .owner-only-control
    document.querySelectorAll('.owner-only-control').forEach(el => {
        el.style.display = isOwner ? 'inline-flex' : 'none';
    });

    // Update footer link text
    const footerLink = document.getElementById('ownerPortalFooterLink');
    if (footerLink) {
        footerLink.innerHTML = isOwner ? '<i class="fa fa-shield-halved" style="color: #2e7d32;"></i> Owner Dashboard Active' : '<i class="fa fa-lock"></i> Store Owner Portal';
    }

    if (isOwner) {
        api('/api/owner/orders').then(data => {
            const badge = document.getElementById('ownerOrdersBadge');
            if (badge) badge.textContent = (data.orders || []).length;
            const badge2 = document.getElementById('ownerOrdersCountBadge');
            if (badge2) badge2.textContent = (data.orders || []).length;
        }).catch(() => {});
    }
}

function handleOwnerPortalLink() {
    if (state.isOwner) {
        showOwnerDashboard();
    } else {
        showOwnerLoginModal();
    }
}

function showOwnerLoginModal() {
    const modal = document.getElementById('ownerLoginModal');
    if (!modal) return;
    const alert = document.getElementById('ownerLoginAlert');
    if (alert) alert.style.display = 'none';
    const pin = document.getElementById('ownerPinInput');
    if (pin) { pin.value = ''; pin.focus(); }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeOwnerLoginModal() {
    const modal = document.getElementById('ownerLoginModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

async function handleOwnerLogin(event) {
    if (event) event.preventDefault();
    const pin = document.getElementById('ownerPinInput')?.value.trim();
    const alert = document.getElementById('ownerLoginAlert');
    const submitBtn = document.getElementById('btnOwnerLoginSubmit');

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Verifying...';
    }

    try {
        const res = await api('/api/owner/login', {
            method: 'POST',
            body: JSON.stringify({ pin })
        });

        if (res.isOwner) {
            state.isOwner = true;
            localStorage.setItem('thethrift_owner', 'true');
            if (res.token) localStorage.setItem('thethrift_owner_token', res.token);
            renderOwnerControls();
            closeOwnerLoginModal();
            showOwnerDashboard('ig');
        }
    } catch (error) {
        if (alert) {
            alert.className = 'ig-modal-alert is-error';
            alert.innerHTML = error.message;
            alert.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa fa-key"></i> Unlock Owner Mode';
        }
    }
}

async function exitOwnerMode() {
    try {
        await api('/api/owner/logout', { method: 'POST' });
    } catch (e) {}

    state.isOwner = false;
    localStorage.removeItem('thethrift_owner');
    localStorage.removeItem('thethrift_owner_token');
    renderOwnerControls();
    closeOwnerDashboard();
    if (window.location.pathname === '/owner' || window.location.hash === '#owner') {
        history.pushState(null, '', '/');
    }
    showModal('Exited Owner Mode', '<p>You are now browsing as a public customer. Owner controls and seller dashboard are secured.</p>');
}

async function showOwnerDashboard(tab = currentOwnerTab) {
    if (!state.isOwner) {
        showOwnerLoginModal();
        return;
    }

    const modal = document.getElementById('ownerDashboardModal');
    if (!modal) return;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    switchOwnerDashboardTab(tab || 'ig');
}

function closeOwnerDashboard() {
    const modal = document.getElementById('ownerDashboardModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function switchOwnerDashboardTab(tab) {
    currentOwnerTab = tab;
    const btnIg = document.getElementById('btnOwnerTabIg');
    const btnDrops = document.getElementById('btnOwnerTabDrops');
    const btnOrders = document.getElementById('btnOwnerTabOrders');
    const paneIg = document.getElementById('ownerTabContentIg');
    const paneDrops = document.getElementById('ownerTabContentDrops');
    const paneOrders = document.getElementById('ownerTabContentOrders');

    if (btnIg) btnIg.classList.toggle('is-active', tab === 'ig');
    if (btnDrops) btnDrops.classList.toggle('is-active', tab === 'drops');
    if (btnOrders) btnOrders.classList.toggle('is-active', tab === 'orders');

    if (paneIg) paneIg.style.display = tab === 'ig' ? 'block' : 'none';
    if (paneDrops) paneDrops.style.display = tab === 'drops' ? 'block' : 'none';
    if (paneOrders) paneOrders.style.display = tab === 'orders' ? 'block' : 'none';

    if (tab === 'ig') renderOwnerIgTab();
    else if (tab === 'drops') renderOwnerDropsTab();
    else if (tab === 'orders') renderOwnerOrdersTab();
}

async function renderOwnerIgTab() {
    const pane = document.getElementById('ownerTabContentIg');
    if (!pane) return;

    pane.innerHTML = '<div style="text-align: center; padding: 25px;"><i class="fa fa-spinner fa-spin" style="font-size: 22px; color: var(--forest);"></i><p style="margin-top: 8px; font-size: 13px;">Checking Instagram connection & sync status...</p></div>';

    try {
        const res = await api('/api/instagram/status');
        const ig = res.instagram || {};
        state.instagram = ig;

        const handle = (ig.username || 'thethriftzz').replace(/^@+/, '');
        const isConnected = Boolean(ig.connected);
        const lastSyncFormatted = ig.lastSync ? new Date(ig.lastSync).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never synced yet';
        const postCount = (state.instagramPosts || []).length;
        const host = window.location.origin;
        const webhookUrl = ig.webhookUrl || `${host}/api/instagram/webhook`;
        const verifyToken = ig.verifyToken || 'thethrift_webhook';

        pane.innerHTML = `
            <div class="owner-ig-card">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e0ded8;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; border-radius: 50%; background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%,#d6249f 60%,#285AEB 90%); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 22px;">
                            <i class="fa-brands fa-instagram"></i>
                        </div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <strong style="font-size: 17px; color: #222;">@${handle}</strong>
                                <span class="owner-health-badge ${isConnected ? 'healthy' : 'error'}">
                                    <i class="fa ${isConnected ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isConnected ? 'Connected & Live' : 'Disconnected'}
                                </span>
                            </div>
                            <span style="font-size: 12px; color: #666;">Professional Graph API Storefront · ${postCount} Live Drops Active</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn-primary btn-sm" id="btnSyncNow" onclick="ownerTriggerManualSync()"><i class="fa fa-rotate"></i> Sync Posts Now</button>
                        <button type="button" class="btn-secondary btn-sm" onclick="showInstagramSettings()"><i class="fa fa-sliders"></i> Account Settings</button>
                        ${isConnected ? `<button type="button" class="btn-subtle btn-sm text-danger" onclick="ownerDisconnectInstagram()"><i class="fa fa-unlink"></i> Disconnect</button>` : ''}
                    </div>
                </div>

                <!-- Sync Health & Status Details -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px;">
                    <div style="background: #ffffff; padding: 10px 12px; border-radius: 8px; border: 1px solid #e5e0d8;">
                        <span style="font-size: 11px; text-transform: uppercase; color: #777; font-weight: 600;">Last Synchronization Time</span>
                        <div style="font-size: 13px; font-weight: 700; color: #222; margin-top: 2px;">
                            <i class="fa fa-clock" style="color: #888;"></i> ${lastSyncFormatted}
                        </div>
                    </div>
                    <div style="background: #ffffff; padding: 10px 12px; border-radius: 8px; border: 1px solid #e5e0d8;">
                        <span style="font-size: 11px; text-transform: uppercase; color: #777; font-weight: 600;">Synchronization Health</span>
                        <div style="font-size: 13px; font-weight: 700; margin-top: 2px;">
                            ${ig.lastError ? `
                                <span style="color: #c62828;"><i class="fa fa-triangle-exclamation"></i> Error Reported</span>
                            ` : `
                                <span style="color: #2e7d32;"><i class="fa fa-circle-check"></i> Healthy (Zero Errors)</span>
                            `}
                        </div>
                    </div>
                    <div style="background: #ffffff; padding: 10px 12px; border-radius: 8px; border: 1px solid #e5e0d8;">
                        <span style="font-size: 11px; text-transform: uppercase; color: #777; font-weight: 600;">Automatic Real-Time Sync</span>
                        <div style="font-size: 13px; font-weight: 700; color: var(--forest); margin-top: 2px;">
                            <i class="fa fa-bolt"></i> Meta Webhook Listener Ready
                        </div>
                    </div>
                </div>

                ${ig.lastError ? `
                    <div style="background: #ffebee; border: 1px solid #ffcdd2; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; color: #b71c1c;">
                        <strong><i class="fa fa-circle-exclamation"></i> Last Synchronization Error:</strong>
                        <p style="margin: 4px 0 0 0;">${ig.lastError}</p>
                    </div>
                ` : ''}

                <!-- Automatic Synchronization / Meta Webhook Integration Card -->
                <div class="owner-webhook-box">
                    <div>
                        <strong style="font-size: 14px; color: var(--forest);"><i class="fa fa-bolt"></i> Meta / Instagram Webhook Synchronization</strong>
                        <p style="font-size: 12px; color: #666; margin: 3px 0 10px 0;">Configure these details in your Meta App Dashboard under Instagram Graph API &rarr; Webhooks. Every photo post is automatically ingested into the public storefront in real time.</p>
                    </div>

                    <div style="margin-bottom: 8px;">
                        <label style="font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase;">Callback URL</label>
                        <div class="copy-pill-wrapper">
                            <code>${webhookUrl}</code>
                            <button type="button" class="btn-subtle btn-sm" onclick="copyTextToClipboard('${webhookUrl}', this)"><i class="fa fa-copy"></i> Copy</button>
                        </div>
                    </div>

                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase;">Hub Verify Token</label>
                        <div class="copy-pill-wrapper">
                            <code>${verifyToken}</code>
                            <button type="button" class="btn-subtle btn-sm" onclick="copyTextToClipboard('${verifyToken}', this)"><i class="fa fa-copy"></i> Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        pane.innerHTML = `<div class="ig-modal-alert is-error">Could not load Instagram status: ${e.message}</div>`;
    }
}

function renderOwnerDropsTab() {
    const pane = document.getElementById('ownerTabContentDrops');
    if (!pane) return;

    const posts = state.instagramPosts || [];
    const badge = document.getElementById('ownerDropsCountBadge');
    if (badge) badge.textContent = posts.length;

    pane.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <div style="font-size: 13px; color: #666;">
                <strong>${posts.length}</strong> total drops in catalog (${posts.filter(p => p.status !== 'sold').length} available, ${posts.filter(p => p.status === 'sold').length} sold)
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-primary btn-sm" onclick="showAddPostModal()"><i class="fa fa-plus"></i> Add New Drop</button>
                <button type="button" class="btn-secondary btn-sm" onclick="ownerTriggerManualSync()"><i class="fa fa-rotate"></i> Sync IG</button>
                <button type="button" class="btn-subtle btn-sm" onclick="loadSampleInstagramPosts()"><i class="fa fa-sparkles"></i> Demo Drops</button>
                <button type="button" class="btn-subtle btn-sm text-danger" onclick="clearInstagramPosts()"><i class="fa fa-trash"></i> Clear All</button>
            </div>
        </div>

        ${!posts.length ? `
            <p class="empty-state">No Instagram drops in catalog yet. Click "+ Add New Drop" or "Sync IG" to import pieces.</p>
        ` : `
            <div class="owner-drops-grid">
                ${posts.map(p => {
                    const isSold = p.status === 'sold';
                    const price = Number(p.price) || 1499;
                    const dropId = p.id || p.instagramId;
                    const name = p.name || p.caption?.slice(0, 35) || 'Curated Drop';
                    return `
                        <div class="owner-drop-item">
                            <img src="${p.imageUrl}" alt="${name}" onerror="this.onerror=null; this.src='images/placeholder.svg';">
                            <div class="owner-drop-content">
                                <strong style="font-size: 13px; color: var(--forest); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</strong>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: 700; color: #222;">₹${price.toLocaleString('en-IN')}</span>
                                    <span class="post-card-tag ${isSold ? 'sold' : ''}" style="position: static; padding: 2px 6px; font-size: 10px;">${isSold ? 'SOLD' : 'AVAIL'}</span>
                                </div>
                                <div style="display: flex; gap: 4px; margin-top: 6px;">
                                    <button type="button" class="btn-subtle btn-sm" onclick="toggleDropStatus('${dropId}')" style="flex: 1; padding: 3px 6px; font-size: 11px;">${isSold ? 'Mark Avail' : 'Mark Sold'}</button>
                                    <button type="button" class="btn-subtle btn-sm text-danger" onclick="deleteDrop('${dropId}')" style="padding: 3px 6px; font-size: 11px;" title="Delete drop"><i class="fa fa-trash"></i></button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `}
    `;
}

async function renderOwnerOrdersTab() {
    const container = document.getElementById('ownerStatsContainer');
    const list = document.getElementById('ownerOrdersList');
    if (!container || !list) return;

    list.innerHTML = '<p class="empty-state"><i class="fa fa-spinner fa-spin"></i> Loading orders database...</p>';

    try {
        const data = await api('/api/owner/orders');
        const orders = data.orders || [];

        const badge = document.getElementById('ownerOrdersCountBadge');
        if (badge) badge.textContent = orders.length;

        container.innerHTML = `
            <div class="owner-stat-card">
                <span style="font-size: 11px; text-transform: uppercase; color: #777;">Total Sales Revenue</span>
                <strong>₹${Number(data.totalRevenue || 0).toLocaleString('en-IN')}</strong>
            </div>
            <div class="owner-stat-card">
                <span style="font-size: 11px; text-transform: uppercase; color: #777;">Client Orders</span>
                <strong>${orders.length}</strong>
            </div>
            <div class="owner-stat-card">
                <span style="font-size: 11px; text-transform: uppercase; color: #777;">Pieces Sold</span>
                <strong>${data.soldItemsCount || 0}</strong>
            </div>
            <div class="owner-stat-card">
                <span style="font-size: 11px; text-transform: uppercase; color: #777;">Store Status</span>
                <strong style="color: #2e7d32;"><i class="fa fa-circle-dot"></i> Live</strong>
            </div>
        `;

        if (!orders.length) {
            list.innerHTML = '<p class="empty-state">No client orders recorded in database yet. Orders placed by clients via "Buy Now" or shopping bag will appear here instantly.</p>';
        } else {
            list.innerHTML = orders.map(order => `
                <div class="owner-order-item">
                    <div class="owner-order-header">
                        <div>
                            <strong style="color: var(--forest); font-size: 14px;">${order.id}</strong> · <span style="font-size: 12px; color: #666;">${new Date(order.createdAt).toLocaleString('en-IN')}</span>
                        </div>
                        <span class="order-status-badge">${order.status || 'Accepted'}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px; font-size: 13px;">
                        <div>
                            <strong>Buyer:</strong> ${order.customer.name} (${order.customer.phone})<br>
                            <strong>Delivery Address:</strong> ${order.customer.address}<br>
                            <strong>Items:</strong> ${(order.items || []).map(i => `${i.name} (₹${Number(i.price).toLocaleString('en-IN')})`).join(', ')}
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 11px; color: #777;">Payment: ${order.paymentMethod || 'COD'}</span><br>
                            <strong style="font-size: 16px; color: var(--forest);">Total: ₹${Number(order.total).toLocaleString('en-IN')}</strong>
                        </div>
                    </div>
                    <div class="owner-order-actions">
                        <button type="button" class="btn-owner-action whatsapp" onclick="whatsappClient('${order.customer.phone}', '${order.customer.name}', '${order.id}')"><i class="fa-brands fa-whatsapp"></i> WhatsApp Client</button>
                        <button type="button" class="btn-owner-action primary" onclick="updateOrderStatus('${order.id}', 'Shipped & In Transit')"><i class="fa fa-truck-fast"></i> Mark Shipped</button>
                        <button type="button" class="btn-owner-action" onclick="updateOrderStatus('${order.id}', 'Delivered & Completed')"><i class="fa fa-circle-check"></i> Mark Delivered</button>
                        <button type="button" class="btn-owner-action text-danger" onclick="updateOrderStatus('${order.id}', 'Cancelled')"><i class="fa fa-ban"></i> Cancel</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        list.innerHTML = `<div class="ig-modal-alert is-error">${e.message}</div>`;
    }
}

async function ownerTriggerManualSync() {
    const btn = document.getElementById('btnSyncNow');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Syncing...';
    }

    try {
        const res = await api('/api/instagram/sync', { method: 'POST' });
        await loadInstagramPosts();
        renderOwnerIgTab();
        renderOwnerDropsTab();
        showOwnerAlert(res.message || 'Instagram posts synced successfully!', false);
    } catch (e) {
        showOwnerAlert(`Sync failed: ${e.message}`, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-rotate"></i> Sync Posts Now';
        }
    }
}

async function ownerDisconnectInstagram() {
    if (!confirm('Are you sure you want to disconnect this Instagram account?')) return;
    try {
        await api('/api/instagram/disconnect', { method: 'POST' });
        state.instagram.connected = false;
        renderOwnerIgTab();
        showOwnerAlert('Instagram account disconnected.', false);
    } catch (e) {
        showOwnerAlert(e.message, true);
    }
}

function copyTextToClipboard(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
        if (btnElement) {
            const orig = btnElement.innerHTML;
            btnElement.innerHTML = '<i class="fa fa-check"></i> Copied!';
            setTimeout(() => { btnElement.innerHTML = orig; }, 2000);
        }
    }).catch(() => {
        prompt('Copy this text:', text);
    });
}

function showOwnerAlert(message, isError = false) {
    const alert = document.getElementById('ownerDashboardAlert');
    if (!alert) return;
    alert.className = `ig-modal-alert ${isError ? 'is-error' : 'is-success'}`;
    alert.innerHTML = message;
    alert.style.display = 'block';
    setTimeout(() => { if (alert) alert.style.display = 'none'; }, 4000);
}

async function updateOrderStatus(orderId, status) {
    try {
        const res = await api('/api/owner/orders/update-status', {
            method: 'POST',
            body: JSON.stringify({ orderId, status })
        });
        renderOwnerOrdersTab();
    } catch (error) {
        showOwnerAlert(error.message, true);
    }
}

function whatsappClient(phone, name, orderId) {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    const targetPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
    const msg = `Hello ${name}! This is THEthrift store owner regarding your order #${orderId}. Your order has been accepted and is being prepared for delivery!`;
    window.open(`https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

// --- Customer OTP Authentication ---
function switchAuthTab(type) {
    state.activeAuthTab = type;
    const tabPhoneBtn = document.getElementById('tabPhoneBtn');
    const tabEmailBtn = document.getElementById('tabEmailBtn');
    const phoneGroup = document.getElementById('phoneInputGroup');
    const emailGroup = document.getElementById('emailInputGroup');
    const alertBox = document.getElementById('authAlert');

    if (alertBox) alertBox.style.display = 'none';

    if (type === 'phone') {
        if (tabPhoneBtn) tabPhoneBtn.classList.add('is-active');
        if (tabEmailBtn) tabEmailBtn.classList.remove('is-active');
        if (phoneGroup) phoneGroup.style.display = 'block';
        if (emailGroup) emailGroup.style.display = 'none';
    } else {
        if (tabPhoneBtn) tabPhoneBtn.classList.remove('is-active');
        if (tabEmailBtn) tabEmailBtn.classList.add('is-active');
        if (phoneGroup) phoneGroup.style.display = 'none';
        if (emailGroup) emailGroup.style.display = 'block';
    }
}

function showSignInModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    document.getElementById('authModalTitle').textContent = 'Sign In to THEthrift';
    backToOtpRequest();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function showSignUpModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    document.getElementById('authModalTitle').textContent = 'Create Customer Account';
    backToOtpRequest();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function showAuthAlert(message, isError = false) {
    const alert = document.getElementById('authAlert');
    if (!alert) return;
    alert.className = `ig-modal-alert ${isError ? 'is-error' : 'is-success'}`;
    alert.innerHTML = message;
    alert.style.display = 'block';
}

async function handleSendOtp(event) {
    if (event) event.preventDefault();
    const type = state.activeAuthTab;
    const nameInput = document.getElementById('authNameInput');
    const name = nameInput ? nameInput.value.trim() : '';

    let identifier = '';
    if (type === 'phone') {
        const phoneInput = document.getElementById('authPhoneInput');
        identifier = phoneInput ? phoneInput.value.trim() : '';
        if (!identifier || identifier.replace(/\D/g, '').length < 10) {
            return showAuthAlert('Please enter a valid 10-digit mobile number.', true);
        }
    } else {
        const emailInput = document.getElementById('authEmailInput');
        identifier = emailInput ? emailInput.value.trim() : '';
        if (!identifier || !identifier.includes('@')) {
            return showAuthAlert('Please enter a valid email address.', true);
        }
    }

    const btn = document.getElementById('btnSendOtp');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Sending OTP...';
    }

    try {
        const res = await api('/api/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ identifier, type, name })
        });

        state.otpData = {
            identifier: res.identifier,
            type: res.type,
            demoOtp: res.demoOtp,
            name
        };

        document.getElementById('authStepRequest').style.display = 'none';
        document.getElementById('authStepVerify').style.display = 'flex';
        document.getElementById('otpTargetDisplay').textContent = res.identifier;

        const demoBox = document.getElementById('otpDemoBox');
        const demoCode = document.getElementById('otpDemoCode');
        if (demoBox && demoCode) {
            demoCode.textContent = res.demoOtp || '123456';
            demoBox.style.display = 'flex';
        }

        const otpInput = document.getElementById('otpCodeInput');
        if (otpInput) {
            otpInput.value = '';
            otpInput.focus();
        }

        showAuthAlert(`OTP sent successfully to <strong>${res.identifier}</strong>!`, false);
    } catch (error) {
        showAuthAlert(error.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-paper-plane"></i> Send Verification OTP';
        }
    }
}

function autoFillDemoOtp() {
    const code = state.otpData.demoOtp || '123456';
    const otpInput = document.getElementById('otpCodeInput');
    if (otpInput) {
        otpInput.value = code;
        otpInput.focus();
    }
}

function backToOtpRequest() {
    const stepRequest = document.getElementById('authStepRequest');
    const stepVerify = document.getElementById('authStepVerify');
    const alertBox = document.getElementById('authAlert');
    if (stepRequest) stepRequest.style.display = 'block';
    if (stepVerify) stepVerify.style.display = 'none';
    if (alertBox) alertBox.style.display = 'none';
}

async function handleVerifyOtp(event) {
    if (event) event.preventDefault();
    const otpInput = document.getElementById('otpCodeInput');
    const otp = otpInput ? otpInput.value.trim() : '';

    if (!otp || otp.length < 6) {
        return showAuthAlert('Please enter the full 6-digit OTP code.', true);
    }

    const btn = document.getElementById('btnVerifyOtp');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Verifying...';
    }

    try {
        const res = await api('/api/auth/verify-otp', {
            method: 'POST',
            body: JSON.stringify({
                identifier: state.otpData.identifier,
                type: state.otpData.type,
                name: state.otpData.name,
                otp
            })
        });

        if (res.token) localStorage.setItem('thethrift_token', res.token);
        if (res.user) {
            localStorage.setItem('thethrift_user', JSON.stringify(res.user));
            state.currentUser = res.user;
            state.customer = { ...state.customer, ...res.user };
        }

        renderAuthHeader();
        closeAuthModal();

        showModal(`Welcome back, ${res.user?.name || 'Friend'}!`, `
            <div style="text-align: center; padding: 10px 0;">
                <i class="fa fa-circle-check" style="font-size: 44px; color: #244b3a; margin-bottom: 12px;"></i>
                <p>You are successfully logged in with verified customer access.</p>
                <div style="display: flex; gap: 10px; margin-top: 18px; justify-content: center;">
                    <button class="btn-primary" onclick="closeModal()">Start Browsing</button>
                    <button class="btn-secondary" onclick="closeModal(); showCustomerAccount();"><i class="fa fa-user"></i> View Profile</button>
                </div>
            </div>
        `);
    } catch (error) {
        showAuthAlert(error.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-circle-check"></i> Verify OTP & Sign In';
        }
    }
}

function renderAuthHeader() {
    const user = state.currentUser;
    const badge = document.getElementById('topBarUserBadge');
    const signInBtn = document.getElementById('topBarSignInBtn');
    const createBtn = document.getElementById('topBarCreateBtn');
    const accountBtn = document.getElementById('topBarAccountBtn');
    const logoutBtn = document.getElementById('topBarLogoutBtn');

    if (user && (user.name || user.email || user.phone)) {
        const displayName = user.name || (user.email ? user.email.split('@')[0] : 'Member');
        if (badge) {
            badge.innerHTML = `<button type="button" class="user-badge-pill" onclick="showCustomerAccount()" title="View Account"><i class="fa fa-user-check"></i> Hi, ${displayName}</button>`;
            badge.style.display = 'inline-block';
        }
        if (signInBtn) signInBtn.style.display = 'none';
        if (createBtn) createBtn.style.display = 'none';
        if (accountBtn) accountBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
    } else {
        if (badge) badge.style.display = 'none';
        if (signInBtn) signInBtn.style.display = 'inline-block';
        if (createBtn) createBtn.style.display = 'inline-block';
        if (accountBtn) accountBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

function handleUserIconClick() {
    if (state.currentUser) {
        showCustomerAccount();
    } else {
        showSignInModal();
    }
}

function logoutCustomer() {
    localStorage.removeItem('thethrift_token');
    localStorage.removeItem('thethrift_user');
    state.currentUser = null;
    renderAuthHeader();
    closeCustomerAccountModal();
    api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    showModal('Signed Out', '<p>You have signed out of your account. Come back anytime!</p>');
}

// --- Customer Profile & Account Modal ---
function showCustomerAccount(initialTab = 'profile') {
    const modal = document.getElementById('customerAccountModal');
    if (!modal) return;

    const cust = state.currentUser || state.customer || {};
    document.getElementById('profName').value = cust.name || '';
    document.getElementById('profPhone').value = cust.phone || '';
    document.getElementById('profEmail').value = cust.email || '';
    document.getElementById('profAddress').value = cust.address || '';

    switchAccountTab(initialTab);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeCustomerAccountModal() {
    const modal = document.getElementById('customerAccountModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function switchAccountTab(tab) {
    const profBtn = document.getElementById('accountTabProfileBtn');
    const ordersBtn = document.getElementById('accountTabOrdersBtn');
    const profView = document.getElementById('accountProfileView');
    const ordersView = document.getElementById('accountOrdersView');

    if (tab === 'profile') {
        if (profBtn) profBtn.classList.add('is-active');
        if (ordersBtn) ordersBtn.classList.remove('is-active');
        if (profView) profView.style.display = 'block';
        if (ordersView) ordersView.style.display = 'none';
    } else {
        if (profBtn) profBtn.classList.remove('is-active');
        if (ordersBtn) ordersBtn.classList.add('is-active');
        if (profView) profView.style.display = 'none';
        if (ordersView) ordersView.style.display = 'block';
        loadAccountOrders();
    }
}

async function saveCustomerProfile(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnSaveProfile');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
    }

    const payload = {
        name: document.getElementById('profName').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        address: document.getElementById('profAddress').value.trim()
    };

    try {
        const res = await api('/api/customer', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        state.customer = res.customer;
        if (state.currentUser) {
            state.currentUser = { ...state.currentUser, ...res.customer };
            localStorage.setItem('thethrift_user', JSON.stringify(state.currentUser));
        }
        renderAuthHeader();

        const alert = document.getElementById('accountAlert');
        if (alert) {
            alert.className = 'ig-modal-alert is-success';
            alert.innerHTML = 'Profile and delivery address updated successfully!';
            alert.style.display = 'block';
            setTimeout(() => { if (alert) alert.style.display = 'none'; }, 3500);
        }
    } catch (error) {
        const alert = document.getElementById('accountAlert');
        if (alert) {
            alert.className = 'ig-modal-alert is-error';
            alert.innerHTML = error.message;
            alert.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-floppy-disk"></i> Save Details';
        }
    }
}

async function loadAccountOrders() {
    const list = document.getElementById('accountOrdersList');
    if (!list) return;
    list.innerHTML = '<p style="text-align: center; color: #777; padding: 20px;"><i class="fa fa-spinner fa-spin"></i> Loading order history...</p>';

    try {
        const orders = await api('/api/orders');
        if (!orders.length) {
            list.innerHTML = `
                <div style="text-align: center; padding: 25px 10px; color: #666;">
                    <i class="fa fa-box-open" style="font-size: 36px; color: #84543c; margin-bottom: 8px;"></i>
                    <p>No orders placed yet. Your confirmed orders will show here.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = orders.slice().reverse().map(order => `
            <div class="order-history-card">
                <div class="order-history-header">
                    <strong>${order.id}</strong>
                    <span class="order-status-badge">${order.status || 'Accepted'}</span>
                </div>
                <div style="font-size: 13px; color: #555; margin-bottom: 6px;">
                    ${(order.items || []).map(i => i.name).join(', ')}
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; color: #777;">
                    <span>${new Date(order.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <strong style="color: #244b3a;">₹${Number(order.total).toLocaleString('en-IN')}</strong>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<p class="empty-state">${error.message}</p>`;
    }
}

// --- Public Posts & Live Drops Rendering ---
function openInstagram() {
    const handle = (state.instagram && state.instagram.username) ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz';
    window.open(`https://instagram.com/${handle}`, '_blank', 'noopener,noreferrer');
}

function updateInstagramDOM() {
    const ig = state.instagram || {};
    const handle = (ig.username ? ig.username.replace(/^@+/, '') : 'thethriftzz');

    document.querySelectorAll('.ig-handle-text').forEach(el => el.textContent = handle);

    const communityHandle = document.getElementById('communityIgHandle');
    if (communityHandle) communityHandle.textContent = `@${handle}`;

    const feedHandle = document.getElementById('feedIgHandle');
    if (feedHandle) feedHandle.textContent = handle;

    const dot = document.getElementById('topBarIgDot');
    if (dot) {
        dot.className = ig.connected ? 'ig-dot is-connected' : 'ig-dot';
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
        console.warn('Could not load public drops', e);
        renderInstagramFeed();
    }
}

function renderInstagramFeed() {
    const grid = document.getElementById('instagramPostsGrid');
    if (!grid) return;

    const posts = state.instagramPosts || [];
    const handle = (state.instagram && state.instagram.username ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz');

    if (!posts.length) {
        grid.innerHTML = `
            <div class="ig-empty-feed" style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
                <div class="ig-empty-icon"><i class="fa-brands fa-instagram" style="font-size: 42px; color: #e4405f;"></i></div>
                <h3>Live Curation & Second-Hand Drops</h3>
                <p>Explore daily pre-loved finds, archive coats, and vintage denim drops directly from our racks.</p>
                <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px; flex-wrap: wrap;">
                    <a href="https://instagram.com/${handle}" target="_blank" class="btn-primary"><i class="fa-brands fa-instagram"></i> Follow @${handle}</a>
                    <button class="btn-secondary" onclick="showQrModal('instagram')"><i class="fa fa-qrcode"></i> Scan IG QR</button>
                </div>
            </div>
        `;
        return;
    }

    grid.innerHTML = posts.map(post => {
        const dateStr = post.postedAt ? new Date(post.postedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'Recent Drop';
        const link = post.permalink || `https://instagram.com/${handle}`;
        const isSold = post.status === 'sold';
        const price = Number(post.price) || 1499;
        const dropId = post.id || post.instagramId;
        const name = post.name || post.caption?.split(/[\n.]/)[0].slice(0, 42).trim() || 'Curated Thrift Drop';

        return `
            <article class="ig-card" data-drop-id="${dropId}">
                <div class="ig-media-wrapper" onclick="openDropDetailsModal('${dropId}')" style="cursor: pointer;" title="Click to view full piece details">
                    <img src="${post.imageUrl}" alt="${name.replace(/"/g, '&quot;')}" loading="lazy" onerror="this.onerror=null; this.src='images/placeholder.svg';">
                    <div class="ig-card-overlay">
                        <span class="ig-overlay-btn"><i class="fa fa-eye"></i> View Details</span>
                    </div>
                    <span class="ig-badge"><i class="fa-brands fa-instagram"></i></span>
                    <span class="post-card-tag ${isSold ? 'sold' : ''}">${isSold ? 'SOLD' : 'AVAILABLE'}</span>
                </div>
                <div class="ig-card-info">
                    <div class="ig-meta">
                        <span class="ig-date">${dateStr}</span>
                        <span class="drop-price-tag" onclick="triggerPricePop(this, ${price}, event)">₹${price.toLocaleString('en-IN')}</span>
                    </div>
                    <h4 class="ig-card-title" onclick="openDropDetailsModal('${dropId}')" style="cursor: pointer; margin: 4px 0 6px 0; font-size: 15px; color: var(--forest);">${name}</h4>
                    <p class="ig-caption">${post.caption || 'Curated thrift collection drop.'}</p>
                    
                    ${isSold ? `
                        <div style="margin-top: 10px; font-size: 12px; color: #c0392b; font-weight: 600; text-align: center; padding: 7px; background: #fadbd8; border-radius: 6px;">
                            <i class="fa fa-lock"></i> Sold & Claimed
                        </div>
                    ` : `
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px;">
                            <button type="button" class="btn-secondary btn-sm" onclick="openDropDetailsModal('${dropId}')" title="View details and sizing"><i class="fa fa-eye"></i> Details</button>
                            <button type="button" class="btn-secondary btn-sm" onclick="addToCart('${dropId}')" title="Add piece to shopping bag"><i class="fa fa-bag-shopping"></i> Add to Bag</button>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px;">
                            <button type="button" class="btn-buy-instant" onclick="instantBuyDrop('${dropId}')"><i class="fa fa-bolt"></i> Buy Now</button>
                            <button type="button" class="btn-wa-instant" onclick="buyDropViaWhatsApp('${dropId}')" title="Buy via WhatsApp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
                        </div>
                    `}
                </div>
            </article>
        `;
    }).join('');

    setupPriceMotionEffects();
}

function openDropDetailsModal(dropId) {
    const drop = (state.instagramPosts || []).find(d => d.id === dropId || d.instagramId === dropId || String(d.id) === String(dropId)) ||
                 (state.products || []).find(p => p.id === dropId || String(p.id) === String(dropId) || p.instagramId === dropId);
    if (!drop) return;

    const modal = document.getElementById('dropDetailsModal');
    const content = document.getElementById('dropDetailsContent');
    if (!modal || !content) return;

    const isSold = drop.status === 'sold';
    const price = Number(drop.price) || 1499;
    const name = drop.name || drop.caption?.split(/[\n.]/)[0].slice(0, 45).trim() || 'Curated Thrift Piece';
    const handle = (state.instagram && state.instagram.username ? state.instagram.username.replace(/^@+/, '') : 'thethriftzz');
    const permalink = drop.permalink || (drop.isInstagramDrop ? `https://instagram.com/${handle}` : '');
    const dateStr = drop.postedAt ? new Date(drop.postedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Curated Pick';
    const imageUrl = drop.imageUrl || drop.image || 'images/placeholder.svg';
    const isIgDrop = Boolean(drop.isInstagramDrop || drop.instagramId || (typeof drop.id === 'string' && drop.id.startsWith('ig-')) || (typeof drop.id === 'string' && drop.id.startsWith('drop_')));

    content.innerHTML = `
        <div class="drop-details-grid">
            <div class="drop-details-media">
                <img src="${imageUrl}" alt="${name}" onerror="this.onerror=null; this.src='images/placeholder.svg';">
                <span class="post-card-tag ${isSold ? 'sold' : ''}" style="position: absolute; top: 12px; left: 12px;">${isSold ? 'SOLD' : 'AVAILABLE'}</span>
                ${isIgDrop ? `
                    <span class="ig-badge" style="position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.6); color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;"><i class="fa-brands fa-instagram"></i></span>
                ` : ''}
            </div>
            <div class="drop-details-info">
                <div>
                    <span style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${isIgDrop ? `<i class="fa-brands fa-instagram" style="color: #e4405f;"></i> Live Instagram Drop · ${dateStr}` : `Curated Vintage Collection · <span style="text-transform: capitalize;">${drop.category || 'Shop'}</span>`}
                    </span>
                    <h2 id="dropDetailsModalTitle" style="font-size: 20px; color: var(--forest); margin: 6px 0 8px 0;">${name}</h2>
                    <div class="drop-details-price" onclick="triggerPricePop(this, ${price}, event)">₹${price.toLocaleString('en-IN')}</div>
                </div>

                <div class="drop-details-caption">
                    ${drop.caption || 'Authentic vintage curation from our racks. Hand-inspected, cleaned, and ready to wear with unique character.'}
                </div>

                ${permalink ? `
                    <div style="font-size: 12px; color: #666;">
                        <a href="${permalink}" target="_blank" rel="noopener noreferrer" style="color: #e4405f; text-decoration: none; font-weight: 600;"><i class="fa-brands fa-instagram"></i> View original post on Instagram @${handle}</a>
                    </div>
                ` : ''}

                ${isSold ? `
                    <div style="background: #fadbd8; color: #c0392b; font-weight: 600; padding: 12px; border-radius: 8px; text-align: center; margin-top: 10px;">
                        <i class="fa fa-lock"></i> This one-of-a-kind piece has been sold and claimed!
                    </div>
                ` : `
                    <div class="drop-details-actions">
                        <div style="display: flex; gap: 8px;">
                            <button type="button" class="btn-secondary" onclick="addToCart('${dropId}'); closeDropDetailsModal();" style="flex: 1; padding: 12px;"><i class="fa fa-bag-shopping"></i> Add to Bag</button>
                            <button type="button" class="btn-primary" onclick="closeDropDetailsModal(); instantBuyProduct('${dropId}');" style="flex: 1; padding: 12px;"><i class="fa fa-bolt"></i> Buy Now</button>
                        </div>
                        <button type="button" class="btn-wa-instant" onclick="buyDropViaWhatsApp('${dropId}')" style="width: 100%; padding: 12px; font-size: 14px;"><i class="fa-brands fa-whatsapp"></i> Buy via WhatsApp</button>
                    </div>
                `}
            </div>
        </div>
    `;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setupPriceMotionEffects();
}

function closeDropDetailsModal() {
    const modal = document.getElementById('dropDetailsModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

// --- Add Public Drop Modal (Owner Only) ---
function showAddPostModal() {
    const modal = document.getElementById('addPostModal');
    if (!modal) return;
    document.getElementById('newPostTitle').value = '';
    document.getElementById('newPostPrice').value = '';
    document.getElementById('newPostImageUrl').value = '';
    document.getElementById('newPostCaption').value = '';
    document.getElementById('newPostPermalink').value = '';
    const previewBox = document.getElementById('dropPreviewBox');
    if (previewBox) {
        previewBox.innerHTML = '<span style="color: #999; font-size: 13px;"><i class="fa fa-image"></i> Paste an image URL above to preview</span>';
    }
    const alert = document.getElementById('addPostAlert');
    if (alert) alert.style.display = 'none';

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeAddPostModal() {
    const modal = document.getElementById('addPostModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function previewDropImage(url) {
    const box = document.getElementById('dropPreviewBox');
    if (!box) return;
    if (url && (url.startsWith('http') || url.startsWith('images/'))) {
        box.innerHTML = `<img src="${url}" alt="Preview" onerror="this.onerror=null; this.src='images/placeholder.svg';">`;
    } else {
        box.innerHTML = '<span style="color: #999; font-size: 13px;"><i class="fa fa-image"></i> Paste an image URL above to preview</span>';
    }
}

async function handleCreateDrop(event) {
    if (event) event.preventDefault();
    const name = document.getElementById('newPostTitle').value.trim();
    const price = Number(document.getElementById('newPostPrice').value) || 1499;
    const imageUrl = document.getElementById('newPostImageUrl').value.trim();
    const caption = document.getElementById('newPostCaption').value.trim();
    const permalink = document.getElementById('newPostPermalink').value.trim();

    if (!imageUrl || !name) {
        const alert = document.getElementById('addPostAlert');
        if (alert) {
            alert.className = 'ig-modal-alert is-error';
            alert.innerHTML = 'Please enter drop title and image URL.';
            alert.style.display = 'block';
        }
        return;
    }

    const btn = document.getElementById('btnPublishDrop');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Publishing drop...';
    }

    try {
        const res = await api('/api/instagram/add-post', {
            method: 'POST',
            body: JSON.stringify({ name, price, imageUrl, caption, permalink, status: 'available' })
        });

        state.instagramPosts = res.posts || [];
        renderInstagramFeed();
        if (typeof renderOwnerDropsTab === 'function') renderOwnerDropsTab();
        closeAddPostModal();
        showModal('Drop Published Live!', '<p>Your new drop is live on the public feed with active "Buy Now" and "WhatsApp Buy" options.</p>');
    } catch (error) {
        const alert = document.getElementById('addPostAlert');
        if (alert) {
            alert.className = 'ig-modal-alert is-error';
            alert.innerHTML = error.message;
            alert.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-cloud-arrow-up"></i> Publish Drop for Sale';
        }
    }
}

// --- Instagram Settings & Management (Store Owner Only) ---
let currentIgTab = 'tab-profile';

function showInstagramSettings(initialTab) {
    if (!state.isOwner) {
        showOwnerLoginModal();
        return;
    }
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

function closeInstagramModal() {
    const modal = document.getElementById('instagramSettingsModal');
    if (modal) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function renderInstagramModalBody() {
    const ig = state.instagram || {};
    const handle = (ig.username ? ig.username.replace(/^@+/, '') : 'thethriftzz');
    const postCount = (state.instagramPosts || []).length;
    const isConnected = Boolean(ig.connected || postCount > 0);

    const body = document.getElementById('instagramModalBody');
    if (!body) return;

    body.innerHTML = `
        <div class="ig-modal-container">
            <div class="ig-status-banner ${isConnected ? 'is-connected' : 'is-linked'}">
                <div class="ig-status-info">
                    <span class="ig-status-indicator"></span>
                    <div>
                        <strong>${isConnected ? 'Live Feed Connected' : 'Profile Linked'}</strong>
                        <span class="ig-status-subtitle">@${handle} · ${postCount} Active Drops for Sale</span>
                    </div>
                </div>
                <div class="ig-status-meta">
                    <button type="button" class="btn-primary btn-sm" onclick="closeInstagramModal(); showAddPostModal();"><i class="fa fa-plus"></i> Add Drop</button>
                </div>
            </div>

            <div class="ig-tabs">
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-profile' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-profile')"><i class="fa fa-user"></i> Handle & Links</button>
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-posts' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-posts')"><i class="fa fa-images"></i> Manage Drops (${postCount})</button>
                <button type="button" class="ig-tab-btn ${currentIgTab === 'tab-token' ? 'is-active' : ''}" onclick="switchInstagramTab('tab-token')"><i class="fa fa-bolt"></i> Auto-Sync (API)</button>
            </div>

            <div id="igModalAlert" class="ig-modal-alert" style="display: none;"></div>

            <!-- Tab 1: Handle & Link -->
            <div class="ig-tab-content" id="tab-profile" style="display: ${currentIgTab === 'tab-profile' ? 'block' : 'none'};">
                <form id="igProfileForm" onsubmit="saveInstagramHandle(event)">
                    <div class="form-group">
                        <label for="igUsernameInput">Instagram Handle / Store Account</label>
                        <div class="input-with-prefix">
                            <span class="input-prefix">@</span>
                            <input type="text" id="igUsernameInput" value="${handle}" placeholder="your_store_handle" required autocomplete="off">
                        </div>
                        <p class="form-hint">Links all IG buttons, drop links, and QR codes across the site directly to <code>https://instagram.com/${handle}</code>.</p>
                    </div>

                    <div class="form-actions-inline">
                        <button type="button" class="btn-secondary" onclick="testInstagramHandle()"><i class="fa fa-arrow-up-right-from-square"></i> Test Page</button>
                        <button type="submit" class="btn-primary" id="saveHandleBtn"><i class="fa fa-check"></i> Save Handle</button>
                    </div>
                </form>
            </div>

            <!-- Tab 2: Manage Synced Drops -->
            <div class="ig-tab-content" id="tab-posts" style="display: ${currentIgTab === 'tab-posts' ? 'block' : 'none'};">
                <div class="ig-posts-manager-header">
                    <span><strong>${postCount}</strong> active drops in live feed</span>
                    <div class="ig-posts-actions" style="display: flex; gap: 8px;">
                        <button type="button" class="btn-secondary btn-sm" onclick="loadSampleInstagramPosts()"><i class="fa fa-sparkles"></i> Demo Drops</button>
                        <button type="button" class="btn-subtle btn-sm text-danger" onclick="clearInstagramPosts()"><i class="fa fa-trash"></i> Clear All</button>
                    </div>
                </div>

                <div class="ig-posts-preview-grid">
                    ${postCount > 0 ? (state.instagramPosts || []).map(p => `
                        <div class="ig-preview-item" title="${(p.caption || '').replace(/"/g, '&quot;')}">
                            <img src="${p.imageUrl}" alt="drop preview" onerror="this.onerror=null; this.src='images/placeholder.svg';">
                            <div class="ig-preview-caption">${(p.name || p.caption || 'Drop').slice(0, 35)}</div>
                            <div style="position: absolute; top: 4px; right: 4px; display: flex; gap: 4px;">
                                <button type="button" onclick="toggleDropStatus('${p.id || p.instagramId}')" style="background: rgba(0,0,0,0.7); color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 10px;" title="Toggle Available / Sold">${p.status === 'sold' ? 'Sold' : 'Avail'}</button>
                                <button type="button" onclick="deleteDrop('${p.id || p.instagramId}')" style="background: rgba(231,76,60,0.85); color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 10px;" title="Delete drop">&times;</button>
                            </div>
                        </div>
                    `).join('') : '<p class="empty-state">No public drops posted yet. Click "+ Add Drop" or "Demo Drops".</p>'}
                </div>
            </div>

            <!-- Tab 3: Meta Graph API (Optional) -->
            <div class="ig-tab-content" id="tab-token" style="display: ${currentIgTab === 'tab-token' ? 'block' : 'none'};">
                <form id="igTokenForm" onsubmit="saveInstagramToken(event)">
                    <div class="form-group">
                        <label for="igTokenInput">Meta / Instagram User Access Token (Optional)</label>
                        <textarea id="igTokenInput" rows="3" placeholder="Paste your Meta Graph API User Access Token here if available...">${ig.hasToken ? '••••••••••••••••••••••••••••••••••••••' : ''}</textarea>
                        <p class="form-hint">If configured, the server will query the official Meta Graph API to sync media automatically.</p>
                    </div>

                    <div class="form-actions-inline">
                        <button type="submit" class="btn-primary" id="saveTokenBtn"><i class="fa fa-shield-halved"></i> Verify Token</button>
                        <button type="button" class="btn-secondary" onclick="manualInstagramSync()"><i class="fa fa-rotate"></i> Sync API Feed</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function switchInstagramTab(tabId) {
    currentIgTab = tabId;
    renderInstagramModalBody();
}

function showModalNotice(message, isError = false) {
    const alert = document.getElementById('igModalAlert');
    if (!alert) return;
    alert.className = `ig-modal-alert ${isError ? 'is-error' : 'is-success'}`;
    alert.innerHTML = message;
    alert.style.display = 'block';
    setTimeout(() => { if (alert) alert.style.display = 'none'; }, 4000);
}

function testInstagramHandle() {
    const input = document.getElementById('igUsernameInput');
    const handle = (input ? input.value : (state.instagram?.username || 'thethriftzz')).trim().replace(/^@+/, '');
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
            showModalNotice(`Instagram handle saved as <strong>@${raw}</strong>! Website links and QR codes updated.`, false);
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
            showModalNotice('Access token verified and saved successfully!', false);
        }
    } catch (e) {
        showModalNotice(`Verification failed: ${e.message}`, true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-shield-halved"></i> Verify Token'; }
    }
}

async function manualInstagramSync() {
    try {
        showModalNotice('Syncing posts from Meta Graph API...', false);
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
            renderOwnerDropsTab();
            showOwnerAlert('Demo Instagram drops loaded and displayed in your feed!', false);
        }
    } catch (e) {
        showOwnerAlert(`Could not load samples: ${e.message}`, true);
    }
}

async function clearInstagramPosts() {
    if (!confirm('Are you sure you want to clear all synced drops?')) return;
    try {
        await api('/api/instagram/clear-posts', { method: 'POST' });
        state.instagramPosts = [];
        renderInstagramFeed();
        renderOwnerDropsTab();
        showOwnerAlert('Feed drops cleared.', false);
    } catch (e) {
        showOwnerAlert(`Failed to clear: ${e.message}`, true);
    }
}

async function toggleDropStatus(id) {
    try {
        const res = await api('/api/instagram/toggle-post-status', {
            method: 'POST',
            body: JSON.stringify({ id })
        });
        state.instagramPosts = res.posts || [];
        renderInstagramFeed();
        renderOwnerDropsTab();
    } catch (e) {
        showOwnerAlert(`Error: ${e.message}`, true);
    }
}

async function deleteDrop(id) {
    if (!confirm('Are you sure you want to delete this drop?')) return;
    try {
        const res = await api('/api/instagram/delete-post', {
            method: 'POST',
            body: JSON.stringify({ id })
        });
        state.instagramPosts = res.posts || [];
        renderInstagramFeed();
        renderOwnerDropsTab();
        showOwnerAlert('Drop deleted.', false);
    } catch (e) {
        showOwnerAlert(`Error: ${e.message}`, true);
    }
}

// --- General Modals & Search ---
function showModal(title, body) {
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const appModal = document.getElementById('appModal');
    if (modalTitle) modalTitle.textContent = title;
    if (modalBody) modalBody.innerHTML = body;
    if (appModal) {
        appModal.classList.add('is-open');
        appModal.setAttribute('aria-hidden', 'false');
    }
}

function closeModal() {
    const appModal = document.getElementById('appModal');
    if (appModal) {
        appModal.classList.remove('is-open');
        appModal.setAttribute('aria-hidden', 'true');
    }
}

function searchProducts() {
    showModal('Search the Collection', `
        <div style="padding: 10px 0;">
            <input class="search-input" id="searchInput" placeholder="Try linen, denim, dress, jacket, shoes..." autofocus style="width: 100%; padding: 12px 14px; border: 1px solid #ccc; border-radius: 8px; font-size: 15px;">
            <p style="font-size: 12px; color: #777; margin-top: 8px;">Filter live products on the rack by keyword.</p>
        </div>
    `);
    const input = document.getElementById('searchInput');
    if (input) {
        input.addEventListener('input', () => {
            const query = input.value.toLowerCase().trim();
            document.querySelectorAll('.product-card').forEach(card => {
                card.hidden = query && !card.textContent.toLowerCase().includes(query);
            });
        });
    }
}

// --- App Bootstrap ---
document.addEventListener('DOMContentLoaded', async () => {
    // Restore saved customer session
    const savedUser = localStorage.getItem('thethrift_user');
    if (savedUser) {
        try {
            state.currentUser = JSON.parse(savedUser);
            state.customer = { ...state.currentUser };
        } catch (e) {}
    }
    renderAuthHeader();

    // Render store owner controls (hidden by default unless owner mode is unlocked)
    renderOwnerControls();

    // Fetch initial catalog data & bag
    try {
        const [products, reviews, cart, customer] = await Promise.all([
            api('/api/products'),
            api('/api/reviews'),
            api('/api/cart'),
            api('/api/customer')
        ]);
        state.products = products || [];
        state.reviews = reviews || [];
        state.cart = cart || [];
        state.cartCount = (cart || []).length;
        if (!state.currentUser && customer) state.customer = customer;

        updateCartLabel();
        renderProducts();
        renderReviews();
    } catch (error) {
        console.error('Initial load error:', error);
        const grid = document.getElementById('productsGrid');
        if (grid) grid.innerHTML = '<p class="empty-state">The collection is temporarily loading. Please refresh.</p>';
    }

    // Load Public Drops & Instagram Status
    loadInstagramStatus();
    loadInstagramPosts();

    // Setup interactive price motion effects
    setupPriceMotionEffects();

    // Mobile nav toggle
    const toggle = document.querySelector('.menu-toggle');
    if (toggle) {
        toggle.addEventListener('click', event => {
            const menu = document.querySelector('.nav-menu');
            if (menu) {
                const open = menu.classList.toggle('is-open');
                event.currentTarget.setAttribute('aria-expanded', open);
            }
        });
    }

    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', () => {
            const menu = document.querySelector('.nav-menu');
            if (menu) menu.classList.remove('is-open');
        });
    });

    // Check URL routing for /login, /owner, or /account
    if (window.location.pathname === '/login' || window.location.hash === '#login') {
        showSignInModal();
    } else if (window.location.pathname === '/owner' || window.location.hash === '#owner') {
        handleOwnerPortalLink();
    } else if (window.location.pathname === '/account' || window.location.hash === '#account') {
        if (state.currentUser) showCustomerAccount();
        else showSignInModal();
    }
});
