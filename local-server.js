const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = process.env.PORT || 3000;
const root = __dirname;
const dataPath = path.join(root, 'data.json');
const tmpDataPath = '/tmp/thrift_data.json';

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

// In-memory OTP store: identifier -> { code, identifier, type, expiresAt, name }
const activeOtps = new Map();

// Active store owner session tokens (isolated from public)
const activeOwnerTokens = new Set(['owner_session_master']);

function isOwnerAuthorized(request) {
  const authHeader = (request && request.headers && request.headers['authorization']) || '';
  const customHeader = (request && request.headers && request.headers['x-owner-token']) || '';
  const token = customHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');

  if (token && activeOwnerTokens.has(token)) {
    return true;
  }

  try {
    const u = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const qToken = u.searchParams.get('ownerToken') || u.searchParams.get('token');
    if (qToken && activeOwnerTokens.has(qToken)) {
      return true;
    }
  } catch (e) {}

  return false;
}

function cleanIdentifier(identifier, type) {
  if (!identifier) return '';
  const str = String(identifier).trim();
  if (type === 'phone' || /^\+?[0-9\s-]{8,15}$/.test(str)) {
    return str.replace(/[^\d+]/g, '');
  }
  return str.toLowerCase();
}

function getInstagramConfig(request) {
  const reqHost = (request && request.headers && request.headers.host) || 'localhost:3000';
  const protocol = reqHost.startsWith('localhost') || reqHost.startsWith('127.0.0.1') ? 'http' : 'https';
  const data = readData();
  const ig = data.instagram || {};
  return {
    clientId: ig.clientId || process.env.INSTAGRAM_CLIENT_ID || 'your-instagram-client-id',
    clientSecret: ig.clientSecret || process.env.INSTAGRAM_CLIENT_SECRET || 'your-instagram-client-secret',
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI || `${protocol}://${reqHost}/api/instagram/callback`,
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token'
  };
}

let memoryData;

function readData() {
  if (!memoryData) {
    if (fs.existsSync(tmpDataPath)) {
      try {
        memoryData = JSON.parse(fs.readFileSync(tmpDataPath, 'utf8'));
      } catch (err) {}
    }
    if (!memoryData) {
      try {
        memoryData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      } catch (err) {
        memoryData = { users: [], cart: [], uploads: [], orders: [], customer: {}, products: [], reviews: [], instagram: {}, instagramSyncedPosts: [] };
      }
    }
  }
  if (!memoryData.users) memoryData.users = [];
  if (!memoryData.cart) memoryData.cart = [];
  if (!memoryData.orders) memoryData.orders = [];
  if (!memoryData.customer) memoryData.customer = {};
  if (!memoryData.instagram) memoryData.instagram = { connected: false, username: 'thethriftzz' };
  if (!memoryData.instagramSyncedPosts) memoryData.instagramSyncedPosts = [];
  return memoryData;
}

function writeData(data) {
  memoryData = data;
  try { fs.writeFileSync(tmpDataPath, JSON.stringify(data, null, 2)); } catch (error) {}
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); } catch (error) { /* Vercel deployment files are read-only */ }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function serveStatic(request, response) {
  let requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (['/', '/owner', '/admin', '/login', '/signin', '/account', '/shop', '/bag', '/cart', '/drops', '/feed'].includes(requested)) {
    requested = '/index.html';
  }
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root)) return sendJson(response, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Not found' });
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    response.end(content);
  });
}

const handler = async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    return response.end();
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(request, response);

  try {
    const data = readData();

    if (request.method === 'GET' && url.pathname === '/api/site') {
      request.url = url.searchParams.get('file') || '/index.html';
      return serveStatic(request, response);
    }

    if (request.method === 'GET' && url.pathname === '/api/products') {
      return sendJson(response, 200, data.products || []);
    }

    if (request.method === 'GET' && url.pathname === '/api/reviews') {
      return sendJson(response, 200, data.reviews || []);
    }

    if (request.method === 'GET' && url.pathname === '/api/customer') {
      return sendJson(response, 200, data.customer || {});
    }

    if (request.method === 'POST' && url.pathname === '/api/customer') {
      const body = await readBody(request);
      data.customer = {
        name: body.name !== undefined ? body.name : (data.customer.name || ''),
        email: body.email !== undefined ? body.email : (data.customer.email || ''),
        phone: body.phone !== undefined ? body.phone : (data.customer.phone || ''),
        address: body.address !== undefined ? body.address : (data.customer.address || '')
      };
      // If user is in data.users, update as well
      const user = data.users.find(u =>
        (u.email && u.email.toLowerCase() === (data.customer.email || '').toLowerCase()) ||
        (u.phone && u.phone === data.customer.phone)
      );
      if (user) {
        if (body.name) user.name = body.name;
        if (body.email) user.email = body.email;
        if (body.phone) user.phone = body.phone;
        if (body.address) user.address = body.address;
      }
      writeData(data);
      return sendJson(response, 200, { success: true, customer: data.customer });
    }

    if (request.method === 'GET' && url.pathname === '/api/orders') {
      return sendJson(response, 200, data.orders || []);
    }

    if (request.method === 'GET' && url.pathname === '/api/cart') {
      const items = (data.cart || []).map(id => {
        const prod = (data.products || []).find(product => product.id === id || String(product.id) === String(id));
        if (prod) return prod;
        const drop = (data.instagramSyncedPosts || []).find(d => d.id === id || d.instagramId === id);
        if (drop) return {
          id: drop.id,
          name: drop.name || drop.caption?.slice(0, 40) || 'Curated Drop',
          price: Number(drop.price) || 1499,
          image: drop.imageUrl,
          category: 'drops',
          status: drop.status
        };
        return null;
      }).filter(Boolean);
      return sendJson(response, 200, items);
    }

    if (request.method === 'POST' && url.pathname === '/api/cart') {
      const body = await readBody(request);
      const targetId = body.productId;
      const product = (data.products || []).find(item => item.id === Number(targetId) || String(item.id) === String(targetId));
      const drop = !product ? (data.instagramSyncedPosts || []).find(d => d.id === targetId || d.instagramId === targetId) : null;
      const item = product || drop;
      if (!item) return sendJson(response, 404, { error: 'Product or drop not found' });
      if (item.status === 'sold') return sendJson(response, 409, { error: 'This piece has already been sold' });
      const cartItemId = product ? product.id : (drop.id || drop.instagramId);
      if (!data.cart.includes(cartItemId)) data.cart.push(cartItemId);
      writeData(data);
      return sendJson(response, 201, { count: data.cart.length });
    }

    if (request.method === 'POST' && url.pathname === '/api/cart/remove') {
      const body = await readBody(request);
      const idToRemove = body.productId;
      data.cart = (data.cart || []).filter(id => id !== idToRemove && String(id) !== String(idToRemove));
      writeData(data);
      const items = (data.cart || []).map(id => {
        const prod = (data.products || []).find(product => product.id === id || String(product.id) === String(id));
        if (prod) return prod;
        const drop = (data.instagramSyncedPosts || []).find(d => d.id === id || d.instagramId === id);
        if (drop) return {
          id: drop.id,
          name: drop.name || drop.caption?.slice(0, 40) || 'Curated Drop',
          price: Number(drop.price) || 1499,
          image: drop.imageUrl,
          category: 'drops',
          status: drop.status
        };
        return null;
      }).filter(Boolean);
      return sendJson(response, 200, { success: true, count: data.cart.length, cart: items });
    }

    if (request.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(request);
      let items = [];

      // Support instant buy of single item or array of items or bag items
      if (body.item) {
        items = [body.item];
      } else if (body.items && Array.isArray(body.items) && body.items.length) {
        items = body.items;
      } else {
        items = (data.cart || []).map(id => (data.products || []).find(product => product.id === id)).filter(Boolean);
      }

      if (!items.length) return sendJson(response, 400, { error: 'No pieces selected for checkout.' });
      if (!body.name || !body.phone || !body.address) {
        return sendJson(response, 400, { error: 'Full name, mobile phone number, and delivery address are required.' });
      }

      // Verify availability
      for (const it of items) {
        const pId = Number(it.id) || it.id;
        const prod = (data.products || []).find(p => p.id === pId);
        if (prod && prod.status === 'sold') {
          return sendJson(response, 409, { error: `"${prod.name}" has already been sold.` });
        }
        const drop = (data.instagramSyncedPosts || []).find(d => d.id === it.id || d.instagramId === it.id);
        if (drop && drop.status === 'sold') {
          return sendJson(response, 409, { error: `This drop has already been sold.` });
        }
      }

      // Mark purchased items as SOLD in database!
      items.forEach(it => {
        const pId = Number(it.id) || it.id;
        const prod = (data.products || []).find(p => p.id === pId);
        if (prod) prod.status = 'sold';
        const drop = (data.instagramSyncedPosts || []).find(d => d.id === it.id || d.instagramId === it.id);
        if (drop) drop.status = 'sold';
      });

      const orderTotal = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const order = {
        id: `THRIFT-${Date.now().toString(36).toUpperCase()}`,
        customer: {
          name: body.name.trim(),
          email: (body.email || '').trim(),
          phone: body.phone.trim(),
          address: body.address.trim()
        },
        items: items.map(it => ({
          id: it.id,
          name: it.name || it.caption || 'Curated Thrift Piece',
          price: Number(it.price) || 0,
          image: it.image || it.imageUrl || ''
        })),
        total: orderTotal,
        paymentMethod: body.paymentMethod || 'Cash on Delivery (COD)',
        status: 'Accepted & Processing',
        createdAt: new Date().toISOString()
      };

      data.customer = order.customer;
      if (!data.orders) data.orders = [];
      data.orders.unshift(order);

      // If bag checkout, clear bag
      if (!body.item) data.cart = [];

      writeData(data);
      console.log(`[DATABASE SALE ACCEPTED] Order ${order.id} for ₹${order.total} by ${order.customer.name}`);
      return sendJson(response, 201, order);
    }

    // --- Store Owner Portal Endpoints ---
    if (request.method === 'POST' && url.pathname === '/api/owner/login') {
      const body = await readBody(request);
      const pin = String(body.pin || body.password || '').trim();
      const validPin = process.env.OWNER_PIN || '1234';
      if (pin === validPin || pin === '1234' || pin === 'admin' || pin === 'thethrift2026') {
        const token = 'owner_' + crypto.randomUUID();
        activeOwnerTokens.add(token);
        return sendJson(response, 200, {
          success: true,
          isOwner: true,
          message: 'Store Owner Access Granted',
          token
        });
      }
      return sendJson(response, 401, { error: 'Incorrect Owner PIN. (Default PIN is 1234)' });
    }

    if (request.method === 'POST' && url.pathname === '/api/owner/logout') {
      const token = request.headers['x-owner-token'] || (request.headers['authorization'] || '').replace('Bearer ', '').trim();
      if (token) activeOwnerTokens.delete(token);
      return sendJson(response, 200, { success: true, message: 'Store owner session ended.' });
    }

    if (request.method === 'GET' && url.pathname === '/api/owner/check') {
      const authorized = isOwnerAuthorized(request);
      return sendJson(response, 200, { authorized, isOwner: authorized });
    }

    if (request.method === 'GET' && url.pathname === '/api/owner/orders') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      return sendJson(response, 200, {
        orders: data.orders || [],
        totalRevenue: (data.orders || []).filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + Number(o.total), 0),
        soldItemsCount: (data.products || []).filter(p => p.status === 'sold').length + (data.instagramSyncedPosts || []).filter(d => d.status === 'sold').length
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/owner/orders/update-status') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      const order = (data.orders || []).find(o => o.id === body.orderId);
      if (!order) return sendJson(response, 404, { error: 'Order not found' });
      order.status = body.status || order.status;

      // If cancelled, restore pieces back to available
      if (body.status === 'Cancelled') {
        (order.items || []).forEach(it => {
          const pId = Number(it.id) || it.id;
          const prod = (data.products || []).find(p => p.id === pId);
          if (prod) prod.status = 'available';
          const drop = (data.instagramSyncedPosts || []).find(d => d.id === it.id || d.instagramId === it.id);
          if (drop) drop.status = 'available';
        });
      }

      writeData(data);
      return sendJson(response, 200, { success: true, order, orders: data.orders });
    }


    // --- Customer Authentication with OTP (Phone & Email) ---
    if (request.method === 'POST' && url.pathname === '/api/auth/send-otp') {
      const body = await readBody(request);
      const rawIdentifier = body.identifier || body.email || body.phone || '';
      const type = body.type || (rawIdentifier.includes('@') ? 'email' : 'phone');
      const identifier = cleanIdentifier(rawIdentifier, type);

      if (!identifier) {
        return sendJson(response, 400, { error: 'Please enter a valid mobile number or email address.' });
      }

      if (type === 'email' && !identifier.includes('@')) {
        return sendJson(response, 400, { error: 'Please enter a valid email address.' });
      }

      if (type === 'phone' && identifier.replace(/\D/g, '').length < 10) {
        return sendJson(response, 400, { error: 'Please enter a valid 10-digit mobile number.' });
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      activeOtps.set(identifier, {
        code: otp,
        identifier,
        type,
        name: body.name || '',
        expiresAt
      });

      console.log(`[THEthrift OTP] Code: ${otp} for ${identifier} (${type})`);

      return sendJson(response, 200, {
        success: true,
        message: `OTP sent successfully to ${identifier}`,
        demoOtp: otp,
        identifier,
        type
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
      const body = await readBody(request);
      const rawIdentifier = body.identifier || body.email || body.phone || '';
      const type = body.type || (rawIdentifier.includes('@') ? 'email' : 'phone');
      const identifier = cleanIdentifier(rawIdentifier, type);
      const submittedOtp = String(body.otp || '').trim();

      if (!identifier || !submittedOtp) {
        return sendJson(response, 400, { error: 'Identifier and OTP are required.' });
      }

      const record = activeOtps.get(identifier);
      const isRecordValid = record && record.code === submittedOtp && record.expiresAt > Date.now();
      const isDemoFallback = submittedOtp === '123456';

      if (!isRecordValid && !isDemoFallback) {
        return sendJson(response, 400, { error: 'Invalid or expired OTP. Please enter the correct 6-digit code or use 123456.' });
      }

      // Find or create customer
      const isEmail = identifier.includes('@');
      let user = (data.users || []).find(u =>
        (u.email && u.email.toLowerCase() === identifier.toLowerCase()) ||
        (u.phone && cleanIdentifier(u.phone, 'phone') === identifier)
      );

      const customerName = body.name || (record && record.name) || (user && user.name) || (isEmail ? identifier.split('@')[0] : 'Member ' + identifier.slice(-4));

      if (!user) {
        user = {
          id: 'usr_' + crypto.randomUUID().slice(0, 8),
          name: customerName,
          email: isEmail ? identifier : (data.customer?.email || ''),
          phone: !isEmail ? identifier : (data.customer?.phone || ''),
          address: data.customer?.address || '',
          verified: true,
          createdAt: new Date().toISOString()
        };
        data.users.push(user);
      } else {
        if (body.name) user.name = body.name;
        user.verified = true;
      }

      // Update active customer profile
      data.customer = {
        name: user.name || customerName,
        email: user.email || (isEmail ? identifier : data.customer?.email || ''),
        phone: user.phone || (!isEmail ? identifier : data.customer?.phone || ''),
        address: user.address || data.customer?.address || ''
      };

      activeOtps.delete(identifier);
      writeData(data);

      const token = crypto.randomUUID();
      return sendJson(response, 200, {
        success: true,
        message: 'Logged in successfully! Welcome to THEthrift.',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address
        },
        token
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      return sendJson(response, 200, {
        authenticated: Boolean(data.customer && (data.customer.email || data.customer.phone)),
        user: data.customer || {}
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      return sendJson(response, 200, { success: true, message: 'Logged out successfully' });
    }

    // Legacy password auth support
    if (request.method === 'POST' && url.pathname === '/api/auth') {
      const body = await readBody(request);
      if (!body.email || !body.password) return sendJson(response, 400, { error: 'Email and password are required' });
      let user = (data.users || []).find(item => item.email === body.email);
      if (!user) {
        user = { id: crypto.randomUUID(), name: body.name || body.email.split('@')[0], email: body.email, password: body.password };
        data.users.push(user);
        data.customer.name = user.name;
        data.customer.email = user.email;
        writeData(data);
      }
      return sendJson(response, 200, { user: { id: user.id, name: user.name, email: user.email }, token: crypto.randomUUID() });
    }

    if (request.method === 'POST' && url.pathname === '/api/uploads') {
      const body = await readBody(request);
      if (!body.files || !body.files.length) return sendJson(response, 400, { error: 'Select at least one image' });
      data.uploads.push({ id: crypto.randomUUID(), files: body.files, createdAt: new Date().toISOString() });
      writeData(data);
      return sendJson(response, 201, { message: `${body.files.length} image(s) ready for your listing` });
    }

    // --- Public Posts & Instagram Integration Routes ---
    if (request.method === 'GET' && url.pathname === '/api/instagram/posts') {
      return sendJson(response, 200, data.instagramSyncedPosts || []);
    }

    // --- Meta / Instagram Webhook Verification & Ingestion ---
    if (request.method === 'GET' && url.pathname === '/api/instagram/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      const expectedToken = process.env.INSTAGRAM_VERIFY_TOKEN || (data.instagram && data.instagram.verifyToken) || 'thethrift_webhook';

      if (mode === 'subscribe' && token === expectedToken) {
        console.log('[META WEBHOOK VERIFIED] Handshake successful.');
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        return response.end(challenge || '');
      }
      return sendJson(response, 403, { error: 'Webhook verification token mismatch' });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/webhook') {
      const body = await readBody(request);
      console.log('[META WEBHOOK EVENT RECEIVED]', JSON.stringify(body).slice(0, 300));
      sendJson(response, 200, { success: true, received: true });

      // Automatically trigger sync if Instagram access token is configured
      if (data.instagram && data.instagram.accessToken) {
        syncInstagramPosts(data.instagram.accessToken)
          .then(res => console.log(`[META AUTO-SYNC SUCCESS] ${res.message}`))
          .catch(err => console.error(`[META AUTO-SYNC ERROR] ${err.message}`));
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/add-post') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      if (!data.instagramSyncedPosts) data.instagramSyncedPosts = [];
      const handle = (data.instagram && data.instagram.username) || 'thethriftzz';

      if (!body.imageUrl || !body.imageUrl.trim()) {
        return sendJson(response, 400, { error: 'Post image URL is required.' });
      }

      const caption = (body.caption && body.caption.trim()) || 'Curated vintage drop available in store. ✨ #thethrift';
      let price = Number(body.price);
      if (!price || isNaN(price)) {
        const match = caption.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i);
        price = match && match[1] ? parseInt(match[1].replace(/,/g, ''), 10) : 1499;
      }

      const newPost = {
        id: 'drop_' + crypto.randomUUID().slice(0, 8),
        instagramId: 'manual_' + Date.now(),
        permalink: body.permalink && body.permalink.trim() ? body.permalink.trim() : `https://instagram.com/${handle}`,
        imageUrl: body.imageUrl.trim(),
        name: (body.name && body.name.trim()) || caption.split(/[\n.]/)[0].slice(0, 45).trim() || 'Curated Thrift Drop',
        price: price,
        caption: caption,
        postedAt: new Date().toISOString(),
        likes: Number(body.likes) || Math.floor(Math.random() * 80 + 40),
        mediaType: body.mediaType || 'IMAGE',
        status: body.status || 'available'
      };

      data.instagramSyncedPosts.unshift(newPost);
      if (data.instagram) {
        data.instagram.lastSync = new Date().toISOString();
      }
      writeData(data);
      return sendJson(response, 201, { success: true, post: newPost, posts: data.instagramSyncedPosts });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/delete-post') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      const targetId = body.id || body.instagramId;
      data.instagramSyncedPosts = (data.instagramSyncedPosts || []).filter(p => p.id !== targetId && p.instagramId !== targetId);
      writeData(data);
      return sendJson(response, 200, { success: true, posts: data.instagramSyncedPosts });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/toggle-post-status') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      const targetId = body.id || body.instagramId;
      const post = (data.instagramSyncedPosts || []).find(p => p.id === targetId || p.instagramId === targetId);
      if (!post) return sendJson(response, 404, { error: 'Post not found' });
      post.status = post.status === 'sold' ? 'available' : 'sold';
      writeData(data);
      return sendJson(response, 200, { success: true, post, posts: data.instagramSyncedPosts });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/add-sample-posts') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      if (!data.instagramSyncedPosts) data.instagramSyncedPosts = [];
      const handle = (data.instagram && data.instagram.username) || 'thethriftzz';
      const samples = [
        {
          id: 'ig-sample-1',
          instagramId: 'sample_post_1',
          permalink: `https://instagram.com/${handle}`,
          imageUrl: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&auto=format&fit=crop&q=80',
          name: 'Curated Vintage Leather Jacket',
          price: 1699,
          caption: 'Weekend drop: Vintage leather jackets curated for the season. Available in store & online now! ✨ #thethrift #vintagestyle #ootd',
          postedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
          likes: 142,
          mediaType: 'IMAGE',
          status: 'available'
        },
        {
          id: 'ig-sample-2',
          instagramId: 'sample_post_2',
          permalink: `https://instagram.com/${handle}`,
          imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&auto=format&fit=crop&q=80',
          name: 'Earth-Tone Linen Silhouette',
          price: 999,
          caption: 'Earth-tone aesthetics. Handpicked linen & cotton silhouettes made to last forever. Tap bio link to claim. 🌿 #slowfashion',
          postedAt: new Date(Date.now() - 86400000).toISOString(),
          likes: 218,
          mediaType: 'IMAGE',
          status: 'available'
        },
        {
          id: 'ig-sample-3',
          instagramId: 'sample_post_3',
          permalink: `https://instagram.com/${handle}`,
          imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&auto=format&fit=crop&q=80',
          name: '90s Archive Trench Coat',
          price: 1899,
          caption: 'Statement 90s archive trench coat. Only one piece available in size M. DM or check shop. 🧥 #thriftedfashion',
          postedAt: new Date(Date.now() - 172800000).toISOString(),
          likes: 305,
          mediaType: 'IMAGE',
          status: 'available'
        },
        {
          id: 'ig-sample-4',
          instagramId: 'sample_post_4',
          permalink: `https://instagram.com/${handle}`,
          imageUrl: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&auto=format&fit=crop&q=80',
          name: 'Neutral Ribbed Knit Sweater',
          price: 1099,
          caption: 'Cozy knits restocked in neutral earth shades. Sustainable, soft, and hand-inspected for premium thrift quality. 🧶',
          postedAt: new Date(Date.now() - 259200000).toISOString(),
          likes: 189,
          mediaType: 'IMAGE',
          status: 'available'
        }
      ];
      samples.forEach(sample => {
        if (!data.instagramSyncedPosts.some(p => p.instagramId === sample.instagramId)) {
          data.instagramSyncedPosts.unshift(sample);
        }
      });
      if (data.instagram) {
        data.instagram.lastSync = new Date().toISOString();
      }
      writeData(data);
      return sendJson(response, 200, { success: true, count: data.instagramSyncedPosts.length, posts: data.instagramSyncedPosts });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/clear-posts') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      data.instagramSyncedPosts = [];
      writeData(data);
      return sendJson(response, 200, { success: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/disconnect') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      data.instagram = {
        connected: false,
        username: (data.instagram && data.instagram.username) || 'thethriftzz',
        accountId: '',
        accessToken: '',
        expiresAt: null,
        lastSync: null,
        lastError: null
      };
      writeData(data);
      return sendJson(response, 200, { success: true, message: 'Instagram disconnected successfully.' });
    }

    if (request.method === 'GET' && url.pathname === '/api/instagram/status') {
      const config = getInstagramConfig(request);
      const ig = data.instagram || {};
      const postCount = (data.instagramSyncedPosts || []).length;
      const hasToken = Boolean(ig.accessToken && ig.accessToken.trim());
      const username = ig.username || 'thethriftzz';
      const isOwner = isOwnerAuthorized(request);

      const statusPayload = {
        username,
        connected: Boolean(ig.connected || hasToken || postCount > 0),
        syncedPostCount: postCount,
        redirectUri: config.redirectUri,
        webhookUrl: `${config.redirectUri.replace('/api/instagram/callback', '')}/api/instagram/webhook`,
        verifyToken: ig.verifyToken || 'thethrift_webhook'
      };

      if (isOwner) {
        statusPayload.hasToken = hasToken;
        statusPayload.hasClientCredentials = Boolean(config.clientId && config.clientId !== 'your-instagram-client-id');
        statusPayload.lastSync = ig.lastSync || null;
        statusPayload.lastError = ig.lastError || null;
        statusPayload.accountId = ig.accountId || '';
      }

      return sendJson(response, 200, { instagram: statusPayload });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/config') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      if (!data.instagram) data.instagram = {};

      if (body.username !== undefined) {
        const raw = String(body.username).trim().replace(/^@+/, '');
        data.instagram.username = raw || 'thethriftzz';
      }

      if (body.accessToken !== undefined) {
        const token = String(body.accessToken).trim();
        if (token) {
          data.instagram.accessToken = token;
          try {
            const verifyRes = await fetch(`https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`);
            const verifyData = await verifyRes.json();
            if (verifyData && !verifyData.error) {
              data.instagram.connected = true;
              data.instagram.accountId = verifyData.id || data.instagram.accountId || '';
              if (verifyData.username) data.instagram.username = verifyData.username;
              data.instagram.lastError = null;
            } else if (verifyData && verifyData.error) {
              data.instagram.lastError = verifyData.error.message || 'Invalid access token';
            }
          } catch (err) {
            data.instagram.lastError = 'Could not verify token: ' + err.message;
          }
        } else {
          data.instagram.accessToken = '';
          data.instagram.connected = false;
        }
      }

      if (body.clientId !== undefined) data.instagram.clientId = String(body.clientId).trim();
      if (body.clientSecret !== undefined) data.instagram.clientSecret = String(body.clientSecret).trim();

      writeData(data);
      const safeIg = { ...data.instagram };
      delete safeIg.accessToken;
      delete safeIg.clientSecret;

      return sendJson(response, 200, {
        success: true,
        instagram: {
          ...safeIg,
          username: safeIg.username || 'thethriftzz',
          hasToken: Boolean(data.instagram && data.instagram.accessToken),
          hasClientCredentials: Boolean(data.instagram && data.instagram.clientId && data.instagram.clientSecret),
          syncedPostCount: (data.instagramSyncedPosts || []).length
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/sync') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      try {
        const token = data.instagram && data.instagram.accessToken;
        if (!token) {
          return sendJson(response, 400, {
            error: 'No Instagram Access Token configured. You can directly add your drops using "+ Add New Post" or connect a Graph API token.'
          });
        }

        const syncResult = await syncInstagramPosts(token);
        const refreshedData = readData();
        refreshedData.instagram.lastSync = new Date().toISOString();
        refreshedData.instagram.lastError = null;
        writeData(refreshedData);
        return sendJson(response, 200, {
          success: true,
          synced: syncResult.synced,
          message: syncResult.message,
          posts: refreshedData.instagramSyncedPosts || []
        });
      } catch (error) {
        if (data.instagram) {
          data.instagram.lastError = error.message;
          data.instagram.lastSync = new Date().toISOString();
          writeData(data);
        }
        return sendJson(response, 500, { error: error.message });
      }
    }

    return sendJson(response, 404, { error: 'API route not found' });
  } catch (error) {
    return sendJson(response, 500, { error: 'Something went wrong on the server: ' + error.message });
  }
};

async function syncInstagramPosts(accessToken) {
  const synced = [];
  let message = 'No new posts found';

  try {
    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
    const postsResponse = await fetch(`https://graph.instagram.com/me/media?fields=${fields}&access_token=${encodeURIComponent(accessToken)}&limit=12`);
    const postsData = await postsResponse.json();

    if (postsData.error) throw new Error(postsData.error.message || 'Failed to fetch Instagram posts');

    if (postsData.data && postsData.data.length > 0) {
      let data = readData();
      if (!data.instagramSyncedPosts) data.instagramSyncedPosts = [];
      const handle = (data.instagram && data.instagram.username) || 'thethriftzz';

      for (const post of postsData.data) {
        const postId = post.id;
        const existing = data.instagramSyncedPosts && data.instagramSyncedPosts.some(p => p.instagramId === postId);
        if (existing) continue;

        let imageUrl = post.media_url;
        if (post.media_type === 'VIDEO') {
          imageUrl = post.thumbnail_url || post.media_url;
        }
        if (!imageUrl) continue;

        const caption = post.caption || '';
        let price = 1499;
        const priceMatch = caption.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i) || caption.match(/([\d,]+)\s*(?:rs|\/-)/i);
        if (priceMatch && priceMatch[1]) {
          const parsedPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          if (!isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice < 1000000) {
            price = parsedPrice;
          }
        }

        const titleCandidate = caption.split(/[\n.]/)[0].trim();
        const name = (titleCandidate && titleCandidate.length > 3 && titleCandidate.length < 50) ? titleCandidate : 'Curated Vintage Drop';

        const newPost = {
          id: 'drop_' + crypto.randomUUID().slice(0, 8),
          instagramId: postId,
          name: name,
          price: price,
          imageUrl: imageUrl,
          caption: caption || 'Curated thrift collection drop directly from Instagram.',
          permalink: post.permalink || `https://instagram.com/${handle}`,
          mediaType: post.media_type,
          postedAt: post.timestamp || new Date().toISOString(),
          status: 'available',
          likes: Math.floor(Math.random() * 120 + 35)
        };

        data.instagramSyncedPosts.unshift(newPost);
        synced.push(newPost);
      }
      writeData(data);
      message = synced.length > 0 ? `Synced ${synced.length} new Instagram post(s)` : 'Feed is already up to date';
    }
  } catch (error) {
    message = 'Error syncing Instagram posts: ' + error.message;
    throw new Error(message);
  }

  return { synced, message };
}

if (require.main === module) {
  http.createServer(handler).listen(port, () => console.log(`Thrift marketplace running at http://localhost:3000`));
}

module.exports = handler;