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
function openInstagram() { window.open('https://instagram.com', '_blank', 'noopener'); }
function showAnalytics() { showModal('Sales analytics', '<p>Your closet has generated ₹12,450 this month, with 8 pieces sold.</p>'); }
function showMessages() { showModal('Customer messages', '<p>You have 3 unread conversations waiting in your inbox.</p>'); }
async function showOrderHistory() { try { const orders = await api('/api/orders'); showModal('Order history', orders.length ? `<div class="cart-list">${orders.slice().reverse().map(order => `<p><strong>${order.id}</strong><span>${order.status} · ₹${order.total.toLocaleString('en-IN')}</span></p>`).join('')}</div>` : '<p>Your recent orders will appear here after your first purchase.</p>'); } catch (error) { showModal('Order history unavailable', `<p>${error.message}</p>`); } }
async function loadCustomerInfo() { try { const customer = await api('/api/customer'); document.getElementById('emailDisplay').textContent = customer.email; document.getElementById('phoneDisplay').textContent = customer.phone; document.getElementById('addressDisplay').textContent = customer.address; } catch (error) { showModal('Customer info unavailable', `<p>${error.message}</p>`); } }
function verifyOTP() { const input = document.getElementById('otpInput'); document.getElementById('otpResult').textContent = input.value === '123456' ? 'OTP verified.' : 'Try 123456 for this demo.'; }

document.addEventListener('DOMContentLoaded', async () => {
    try { [state.products, state.reviews] = await Promise.all([api('/api/products'), api('/api/reviews')]); const cart = await api('/api/cart'); state.cartCount = cart.length; updateCartLabel(); renderProducts(); renderReviews(); } catch (error) { document.getElementById('productsGrid').innerHTML = '<p class="empty-state">The collection is temporarily unavailable.</p>'; }
    document.querySelector('.menu-toggle').addEventListener('click', event => { const menu = document.querySelector('.nav-menu'); const open = menu.classList.toggle('is-open'); event.currentTarget.setAttribute('aria-expanded', open); });
    document.querySelectorAll('.nav-menu a').forEach(link => link.addEventListener('click', () => document.querySelector('.nav-menu').classList.remove('is-open')));
});
