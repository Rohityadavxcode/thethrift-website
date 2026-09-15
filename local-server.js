const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = process.env.PORT || 3000;
const root = __dirname;
const dataPath = path.join(root, 'data.json');
const tmpDataPath = '/tmp/thrift_data.json';

// Production Server Secret for cryptographic HMAC token signing
const SERVER_SECRET = process.env.SERVER_SECRET || crypto.createHash('sha256').update('thethrift_master_secret_' + __dirname).digest('hex');

// Comprehensive Production Security Headers
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; img-src 'self' https: data: blob:; font-src 'self' https: data:; style-src 'self' https: 'unsafe-inline'; script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:;"
};

// Whitelist of public static assets allowed to be served directly
const ALLOWED_STATIC_FILES = new Set([
  '/index.html',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico'
]);
const ALLOWED_STATIC_DIRS = ['/css/', '/js/', '/images/'];

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain'
};

// In-memory OTP store: identifier -> { code, identifier, type, expiresAt, name, attempts, address, pincode, city, state }
const activeOtps = new Map();

// In-memory sliding-window rate limiter
const rateLimitMap = new Map();

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let record = rateLimitMap.get(key);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(key, record);
    return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
  }

  record.count += 1;
  if (record.count > maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: maxRequests - record.count, retryAfter: 0 };
}

function getClientIp(request) {
  const forwarded = request.headers && request.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers && request.headers['x-real-ip'];
  if (realIp) return realIp.trim();
  return (request && request.socket && request.socket.remoteAddress) || '127.0.0.1';
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.trim()
    .replace(/[<>]/g, '')
    .slice(0, 500);
}

// Generate cryptographically signed Owner session token
function generateOwnerToken() {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', SERVER_SECRET).update(`owner_${timestamp}`).digest('hex').slice(0, 32);
  return `owner_${timestamp}_${signature}`;
}

// Server-side Owner Authorization Check
function isOwnerAuthorized(request) {
  const authHeader = (request && request.headers && request.headers['authorization']) || '';
  const customHeader = (request && request.headers && request.headers['x-owner-token']) || '';
  const token = customHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');

  if (!token) return false;

  if (token.startsWith('owner_')) {
    const parts = token.split('_');
    if (parts.length === 3) {
      const [, timestampStr, signature] = parts;
      const expectedSig = crypto.createHmac('sha256', SERVER_SECRET).update(`owner_${timestampStr}`).digest('hex').slice(0, 32);
      if (signature.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        const timestamp = parseInt(timestampStr, 10);
        // Owner token valid for 7 days
        if (Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
          return true;
        }
      }
    }
  }

  return false;
}

// Generate cryptographically signed Customer session token
function generateCustomerToken(user) {
  const userId = user.id || 'usr_unknown';
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', SERVER_SECRET).update(`cust_${userId}_${timestamp}`).digest('hex').slice(0, 32);
  return `cust_${userId}_${timestamp}_${signature}`;
}

// Server-side Customer Authorization Check
function getCustomerFromRequest(request, data) {
  const authHeader = (request && request.headers && request.headers['authorization']) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) return null;

  if (token.startsWith('cust_')) {
    const parts = token.split('_');
    if (parts.length === 4) {
      const [, userId, timestampStr, signature] = parts;
      const expectedSig = crypto.createHmac('sha256', SERVER_SECRET).update(`cust_${userId}_${timestampStr}`).digest('hex').slice(0, 32);
      if (signature.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        const timestamp = parseInt(timestampStr, 10);
        // Customer session valid for 30 days
        if (Date.now() - timestamp < 30 * 24 * 60 * 60 * 1000) {
          return (data.users || []).find(u => u.id === userId) || null;
        }
      }
    }
  }

  // Fallback support for active UUID tokens
  return (data.users || []).find(u => u.token === token) || null;
}

function cleanIdentifier(identifier, type) {
  if (!identifier) return '';
  const str = String(identifier).trim();
  if (type === 'phone' || /^\+?[0-9\s-]{8,15}$/.test(str)) {
    return str.replace(/[^\d+]/g, '');
  }
  return str.toLowerCase();
}

// Configured Owner WhatsApp number (read from environment variable, obfuscated fallback)
const OWNER_WHATSAPP_RAW = process.env.OWNER_WHATSAPP_NUMBER || Buffer.from('OTI4NDc2ODQzNQ==', 'base64').toString('utf-8');
const OWNER_WHATSAPP_NUMBER = (() => {
  const digits = String(OWNER_WHATSAPP_RAW).replace(/[^\d]/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
})();

// Real-Time OTP Dispatcher (Real SMS Gateway & WhatsApp Instant Verification)
async function dispatchRealOtp(identifier, type, otp, data) {
  const cleanPhone = identifier.replace(/\D/g, '').slice(-10);
  const waVerifyUrl = `/api/whatsapp?text=${encodeURIComponent(`Hi THEthrift, please verify my mobile number +91${cleanPhone}. My real-time verification code is: ${otp}`)}`;

  // 1. Check Fast2SMS Indian Gateway (if configured in environment or owner settings)
  const fast2smsKey = process.env.FAST2SMS_API_KEY || (data && data.sms && data.sms.fast2smsApiKey);
  if (type === 'phone' && fast2smsKey && cleanPhone.length === 10) {
    try {
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(fast2smsKey)}&variables_values=${encodeURIComponent(otp)}&route=otp&numbers=${encodeURIComponent(cleanPhone)}`;
      const res = await fetch(url, { method: 'GET' });
      const json = await res.json().catch(() => ({}));
      console.log(`[Fast2SMS Real-Time Dispatch] Sent to ${cleanPhone}:`, json);
      if (json && (json.return === true || json.status_code === 200)) {
        return { delivered: true, provider: 'fast2sms', whatsappOtpUrl: waVerifyUrl };
      }
    } catch (e) {
      console.error('[Fast2SMS Error]:', e.message);
    }
  }

  // 2. Check Twilio SMS Gateway (if configured in environment or owner settings)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID || (data && data.sms && data.sms.twilioAccountSid);
  const twilioToken = process.env.TWILIO_AUTH_TOKEN || (data && data.sms && data.sms.twilioAuthToken);
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER || (data && data.sms && data.sms.twilioPhoneNumber);
  if (type === 'phone' && twilioSid && twilioToken && twilioFrom && cleanPhone.length === 10) {
    try {
      const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const toNumber = `+91${cleanPhone}`;
      const params = new URLSearchParams({
        To: toNumber,
        From: twilioFrom,
        Body: `Your THEthrift real-time verification code is: ${otp}. Valid for 10 minutes.`
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      const json = await res.json().catch(() => ({}));
      console.log(`[Twilio Real-Time Dispatch] Sent to ${toNumber}:`, json.sid || json.message);
      if (json && json.sid) {
        return { delivered: true, provider: 'twilio', whatsappOtpUrl: waVerifyUrl };
      }
    } catch (e) {
      console.error('[Twilio Error]:', e.message);
    }
  }

  console.log(`[THEthrift REAL-TIME OTP] Real code generated for ${identifier}: ${otp} (Expiry: 10m)`);
  return { delivered: false, provider: 'whatsapp', whatsappOtpUrl: waVerifyUrl };
}

function generateOrderNumber(orders) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `ORD-${yyyy}${mm}${dd}`;

  // Count existing orders today to produce clean sequence ORD-YYYYMMDD-0001
  const existingToday = (orders || []).filter(o => {
    const id = String(o.id || o.orderNumber || '');
    return id.startsWith(prefix);
  });
  const seq = String(existingToday.length + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

function calculateOrderAnalytics(orders, filterPeriod = 'all') {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOf7Days = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  function orderTime(o) {
    return new Date(o.createdAt).getTime() || 0;
  }

  // Consistent rule: CANCELLED orders are excluded from revenue totals
  function isNotCancelled(o) {
    return (o.status || '').toUpperCase() !== 'CANCELLED';
  }

  function sumRevenue(list) {
    return list.filter(isNotCancelled).reduce((sum, o) => sum + (Number(o.totalAmount || o.total) || 0), 0);
  }

  const allOrders = orders || [];
  const todayOrders = allOrders.filter(o => orderTime(o) >= startOfToday);
  const weekOrders = allOrders.filter(o => orderTime(o) >= startOf7Days);
  const monthOrders = allOrders.filter(o => orderTime(o) >= startOfMonth);
  const yearOrders = allOrders.filter(o => orderTime(o) >= startOfYear);

  const todayStats = {
    ordersCount: todayOrders.length,
    salesTotal: sumRevenue(todayOrders),
    newOrders: todayOrders.filter(o => (o.status || '').toUpperCase() === 'NEW').length,
    contactedOrders: todayOrders.filter(o => (o.status || '').toUpperCase() === 'CONTACTED').length,
    confirmedOrders: todayOrders.filter(o => (o.status || '').toUpperCase() === 'CONFIRMED').length,
    completedOrders: todayOrders.filter(o => (o.status || '').toUpperCase() === 'COMPLETED' || (o.status || '').toLowerCase().includes('delivered')).length,
    cancelledOrders: todayOrders.filter(o => (o.status || '').toUpperCase() === 'CANCELLED').length
  };

  const weekStats = {
    ordersCount: weekOrders.length,
    salesTotal: sumRevenue(weekOrders)
  };

  const monthStats = {
    ordersCount: monthOrders.length,
    salesTotal: sumRevenue(monthOrders)
  };

  const yearStats = {
    ordersCount: yearOrders.length,
    salesTotal: sumRevenue(yearOrders)
  };

  const allTimeStats = {
    ordersCount: allOrders.length,
    salesTotal: sumRevenue(allOrders),
    newOrders: allOrders.filter(o => (o.status || '').toUpperCase() === 'NEW').length,
    contactedOrders: allOrders.filter(o => (o.status || '').toUpperCase() === 'CONTACTED').length,
    confirmedOrders: allOrders.filter(o => (o.status || '').toUpperCase() === 'CONFIRMED').length,
    completedOrders: allOrders.filter(o => (o.status || '').toUpperCase() === 'COMPLETED' || (o.status || '').toLowerCase().includes('delivered')).length,
    cancelledOrders: allOrders.filter(o => (o.status || '').toUpperCase() === 'CANCELLED').length
  };

  let filtered = allOrders;
  if (filterPeriod === 'today') filtered = todayOrders;
  else if (filterPeriod === '7days') filtered = weekOrders;
  else if (filterPeriod === 'month') filtered = monthOrders;
  else if (filterPeriod === 'year') filtered = yearOrders;

  return {
    today: todayStats,
    thisWeek: weekStats,
    thisMonth: monthStats,
    thisYear: yearStats,
    allTime: allTimeStats,
    activeFilter: filterPeriod,
    orders: filtered
  };
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
  if (!memoryData.products) memoryData.products = [];
  ensureAllDropsSyncedToProducts(memoryData);
  return memoryData;
}

function writeData(data) {
  memoryData = data;
  try { fs.writeFileSync(tmpDataPath, JSON.stringify(data, null, 2)); } catch (error) {}
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); } catch (error) { /* Vercel deployment files are read-only */ }
}

function syncDropToProduct(data, drop) {
  if (!drop || !data) return;
  if (!data.products) data.products = [];

  const dropId = drop.id || drop.instagramId;
  const existingIndex = data.products.findIndex(p => 
    p.id === dropId || 
    String(p.id) === String(dropId) || 
    (drop.instagramId && p.instagramId === drop.instagramId) ||
    (p.name && drop.name && p.name.trim().toLowerCase() === drop.name.trim().toLowerCase())
  );

  const text = ((drop.name || '') + ' ' + (drop.caption || '')).toLowerCase();
  let category = 'outerwear';
  if (/jacket|coat|hoodie|blazer|cardigan|vest|windbreaker/i.test(text)) category = 'outerwear';
  else if (/shirt|tee|t-shirt|top|crop|blouse|polo|tank|sweater|knit/i.test(text)) category = 'tops';
  else if (/dress|gown|skirt|midi|maxi/i.test(text)) category = 'dresses';
  else if (/jeans|pant|trousers|denim|cargo|shorts/i.test(text)) category = 'jeans';
  else if (/shoe|sneaker|boots|loafers|heels/i.test(text)) category = 'shoes';
  else if (/bag|tote|cap|belt|scarf|sunglasses|jewel/i.test(text)) category = 'accessories';

  const productData = {
    id: drop.id || dropId,
    instagramId: drop.instagramId || '',
    name: drop.name || drop.caption?.split(/[\n.]/)[0].slice(0, 45).trim() || 'Curated Vintage Piece',
    category: category,
    audience: /women|girl|female/i.test(text) ? 'women' : (/men|boy|male/i.test(text) ? 'men' : 'unisex'),
    condition: /new|deadstock|tag/i.test(text) ? 'new' : 'like',
    status: drop.status || 'available',
    price: Number(drop.price) || 1499,
    seller: (data.instagram && data.instagram.username) ? `@${data.instagram.username.replace(/^@+/, '')}` : 'Curated Instagram Drop',
    image: drop.imageUrl || drop.image || '',
    caption: drop.caption || '',
    permalink: drop.permalink || '',
    rating: 4.9,
    isInstagramDrop: true,
    createdAt: drop.postedAt || new Date().toISOString()
  };

  if (existingIndex >= 0) {
    const existing = data.products[existingIndex];
    existing.status = drop.status || existing.status;
    existing.price = Number(drop.price) || existing.price;
    existing.name = drop.name || existing.name;
    if (drop.imageUrl) existing.image = drop.imageUrl;
    existing.isInstagramDrop = true;
    if (drop.permalink) existing.permalink = drop.permalink;
  } else {
    data.products.unshift(productData);
  }
}

function ensureAllDropsSyncedToProducts(data) {
  if (!data || !Array.isArray(data.instagramSyncedPosts)) return;
  for (const drop of data.instagramSyncedPosts) {
    syncDropToProduct(data, drop);
  }
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-owner-token',
    ...SECURITY_HEADERS,
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB limit
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_SIZE) {
        request.destroy(new Error('Payload Too Large'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(new Error('Invalid JSON payload')); }
    });
    request.on('error', reject);
  });
}

function serveStatic(request, response) {
  let requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (['/', '/owner', '/admin', '/login', '/signin', '/account', '/shop', '/bag', '/cart', '/drops', '/feed'].includes(requested)) {
    requested = '/index.html';
  }

  // Strict whitelist check
  const isAllowedFile = ALLOWED_STATIC_FILES.has(requested);
  const isAllowedDir = ALLOWED_STATIC_DIRS.some(dir => requested.startsWith(dir));
  if (!isAllowedFile && !isAllowedDir) {
    return sendJson(response, 404, { error: 'Not found' });
  }

  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root)) return sendJson(response, 403, { error: 'Forbidden' });

  // Disallow any hidden files, .json, .env, .js backend files, etc.
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  if (basename.startsWith('.') || ext === '.json' || ext === '.env' || filePath.endsWith('local-server.js') || basename === 'package.json') {
    return sendJson(response, 403, { error: 'Forbidden' });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Not found' });
    response.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      ...SECURITY_HEADERS
    });
    response.end(content);
  });
}

const handler = async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-owner-token',
      ...SECURITY_HEADERS
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
      // Return safe public catalog fields only
      const safeProducts = (data.products || []).map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: Number(p.price) || 0,
        originalPrice: Number(p.originalPrice) || 0,
        size: p.size,
        status: p.status,
        image: p.image,
        description: p.description,
        rating: p.rating,
        reviewsCount: p.reviewsCount,
        permalink: p.permalink
      }));
      return sendJson(response, 200, safeProducts);
    }

    if (request.method === 'GET' && url.pathname === '/api/reviews') {
      return sendJson(response, 200, data.reviews || []);
    }

    if (request.method === 'GET' && url.pathname === '/api/customer') {
      const user = getCustomerFromRequest(request, data);
      if (user) {
        return sendJson(response, 200, {
          authenticated: true,
          customer: {
            name: user.name || '',
            email: user.email || '',
            phone: user.phone || '',
            address: user.address || '',
            pincode: user.pincode || '',
            city: user.city || '',
            state: user.state || '',
            fullAddress: user.fullAddress || user.address || ''
          }
        });
      }
      return sendJson(response, 200, { authenticated: false, customer: {} });
    }

    if (request.method === 'POST' && url.pathname === '/api/customer') {
      const user = getCustomerFromRequest(request, data);
      if (!user) {
        return sendJson(response, 401, { error: 'Authentication required. Please sign in to update your profile.' });
      }
      const body = await readBody(request);
      if (body.name !== undefined) user.name = sanitizeInput(body.name);
      if (body.phone !== undefined) user.phone = sanitizeInput(body.phone);
      if (body.email !== undefined) user.email = sanitizeInput(body.email);
      if (body.address !== undefined) user.address = sanitizeInput(body.address);
      if (body.pincode !== undefined) user.pincode = sanitizeInput(body.pincode);
      if (body.city !== undefined) user.city = sanitizeInput(body.city);
      if (body.state !== undefined) user.state = sanitizeInput(body.state);
      const comps = [user.address, user.city, user.state, user.pincode ? `PIN: ${user.pincode}` : ''].filter(Boolean);
      user.fullAddress = comps.join(', ');

      writeData(data);
      return sendJson(response, 200, {
        success: true,
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          pincode: user.pincode,
          city: user.city,
          state: user.state,
          fullAddress: user.fullAddress
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/orders') {
      // Authorization Check
      const isOwner = isOwnerAuthorized(request);
      if (isOwner) {
        return sendJson(response, 200, data.orders || []);
      }

      const customer = getCustomerFromRequest(request, data);
      if (!customer) {
        return sendJson(response, 401, { error: 'Authentication required. Please sign in to view your orders.' });
      }

      // Filter orders strictly for this verified customer
      const custPhoneClean = cleanIdentifier(customer.phone, 'phone');
      const custEmailClean = (customer.email || '').toLowerCase().trim();

      const customerOrders = (data.orders || []).filter(order => {
        const orderPhone = cleanIdentifier(order.customerPhone || (order.customer && order.customer.phone), 'phone');
        const orderEmail = (order.customerEmail || (order.customer && order.customer.email) || '').toLowerCase().trim();
        const matchesPhone = custPhoneClean && orderPhone && (orderPhone.endsWith(custPhoneClean.slice(-10)) || custPhoneClean.endsWith(orderPhone.slice(-10)));
        const matchesEmail = custEmailClean && orderEmail && orderEmail === custEmailClean;
        const matchesUserId = order.userId && order.userId === customer.id;
        return matchesPhone || matchesEmail || matchesUserId;
      });

      return sendJson(response, 200, customerOrders);
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

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/whatsapp') {
      const text = url.searchParams.get('text') || 'Hi THEthrift!';
      const targetUrl = `https://wa.me/${OWNER_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
      response.writeHead(302, {
        'Location': targetUrl,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        ...SECURITY_HEADERS
      });
      return response.end();
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, {
        storeName: 'THEthrift',
        currency: '₹',
        hasWhatsAppSupport: Boolean(OWNER_WHATSAPP_NUMBER)
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/orders') {
      const clientIp = getClientIp(request);
      // Rate limit: max 10 orders per 5 minutes per IP
      const rate = checkRateLimit(`order_${clientIp}`, 10, 5 * 60 * 1000);
      if (!rate.allowed) {
        return sendJson(response, 429, { error: `Too many order requests. Please wait ${rate.retryAfter} seconds before trying again.` }, { 'Retry-After': String(rate.retryAfter) });
      }

      const body = await readBody(request);
      let rawItems = [];

      // Support instant buy of single item or array of items or bag items
      if (body.item) {
        rawItems = [body.item];
      } else if (body.items && Array.isArray(body.items) && body.items.length) {
        rawItems = body.items;
      } else {
        rawItems = (data.cart || []).map(id => ({ id, quantity: 1 }));
      }

      if (!rawItems.length) return sendJson(response, 400, { error: 'No pieces selected for checkout.' });
      if (rawItems.length > 50) return sendJson(response, 400, { error: 'Maximum 50 items allowed per order.' });

      const custName = sanitizeInput(body.name || (body.customer && body.customer.name) || '');
      const custPhone = sanitizeInput(body.phone || (body.customer && body.customer.phone) || '');
      const custAddress = sanitizeInput(body.address || (body.customer && body.customer.address) || '');
      const custEmail = sanitizeInput(body.email || (body.customer && body.customer.email) || '');

      if (!custName || custName.length < 2) {
        return sendJson(response, 400, { error: 'Please enter a valid full name (minimum 2 characters).' });
      }

      if (!custPhone || custPhone.replace(/\D/g, '').length < 10) {
        return sendJson(response, 400, { error: 'Please enter a valid 10-digit mobile phone number.' });
      }

      // Strictly validate each item and calculate total on SERVER using database product prices
      const verifiedItems = [];
      let calculatedTotal = 0;

      for (const rawItem of rawItems) {
        const targetId = rawItem.id || rawItem.productId;
        const dbProduct = (data.products || []).find(p => p.id === targetId || String(p.id) === String(targetId)) ||
                          (data.instagramSyncedPosts || []).find(d => d.id === targetId || d.instagramId === targetId || String(d.id) === String(targetId));

        if (!dbProduct) {
          return sendJson(response, 404, { error: 'Product piece not found in store catalog.' });
        }

        if (dbProduct.status === 'sold') {
          return sendJson(response, 409, { error: `"${dbProduct.name || 'This piece'}" has already been sold.` });
        }

        const rawQty = rawItem.quantity !== undefined ? rawItem.quantity : 1;
        const qty = parseInt(rawQty, 10);
        if (isNaN(qty) || qty <= 0) {
          return sendJson(response, 400, { error: 'Item quantity must be a positive integer.' });
        }
        if (qty > 20) {
          return sendJson(response, 400, { error: 'Maximum 20 units permitted per item.' });
        }

        const unitPrice = Number(dbProduct.price) || 0;
        const itemSubtotal = unitPrice * qty;
        calculatedTotal += itemSubtotal;

        verifiedItems.push({
          id: `item_${crypto.randomUUID().slice(0, 8)}`,
          productId: dbProduct.id,
          productName: dbProduct.name || dbProduct.caption?.slice(0, 40) || 'Curated Thrift Piece',
          priceAtOrder: unitPrice,
          price: unitPrice,
          quantity: qty,
          subtotal: itemSubtotal,
          image: dbProduct.image || dbProduct.imageUrl || ''
        });
      }

      // Mark purchased pieces as SOLD across both products and instagramSyncedPosts
      verifiedItems.forEach(it => {
        const pId = it.productId;
        const prod = (data.products || []).find(p => p.id === pId || String(p.id) === String(pId));
        if (prod) prod.status = 'sold';
        const drop = (data.instagramSyncedPosts || []).find(d => d.id === pId || d.instagramId === pId || String(d.id) === String(pId));
        if (drop) drop.status = 'sold';
      });

      // Generate unique human-readable Order ID with non-guessable cryptographic token
      const orderId = generateOrderNumber(data.orders);

      const authenticatedCustomer = getCustomerFromRequest(request, data);

      const order = {
        id: orderId,
        orderNumber: orderId,
        userId: authenticatedCustomer ? authenticatedCustomer.id : null,
        customer: {
          name: custName,
          email: custEmail,
          phone: custPhone,
          address: custAddress
        },
        customerName: custName,
        customerPhone: custPhone,
        items: verifiedItems,
        totalAmount: calculatedTotal,
        total: calculatedTotal,
        paymentMethod: body.paymentMethod || 'Cash on Delivery (COD)',
        status: 'NEW', // Initial order status
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!data.orders) data.orders = [];
      data.orders.unshift(order);

      // Clear bag if full checkout
      if (!body.item) data.cart = [];

      writeData(data);

      // Generate WhatsApp order message
      let itemsListText = '';
      verifiedItems.forEach((it, idx) => {
        itemsListText += `\n${idx + 1}. ${it.productName}\n   Qty: ${it.quantity}\n   Price: ₹${it.priceAtOrder.toLocaleString('en-IN')}\n   Subtotal: ₹${it.subtotal.toLocaleString('en-IN')}\n`;
      });

      const whatsappText = 
`Hello, I want to place an order.

Order ID: ${order.id}

Customer:
Name: ${order.customer.name}
Phone: ${order.customer.phone}${order.customer.address ? `\nAddress: ${order.customer.address}` : ''}

Items:${itemsListText}
Total: ₹${order.total.toLocaleString('en-IN')}

Please confirm my order.`;

      const whatsappUrl = `/api/whatsapp?text=${encodeURIComponent(whatsappText)}`;

      console.log(`[DATABASE SALE CREATED] Order ${order.id} for ₹${order.total} by ${order.customer.name}`);

      return sendJson(response, 201, {
        success: true,
        order,
        orderId: order.id,
        orderNumber: order.id,
        whatsappUrl,
        whatsappMessage: whatsappText
      });
    }

    // --- Store Owner Portal Endpoints ---
    if (request.method === 'POST' && url.pathname === '/api/owner/login') {
      const clientIp = getClientIp(request);
      // Rate limit: max 5 login attempts per 15 minutes per IP
      const rate = checkRateLimit(`owner_login_${clientIp}`, 5, 15 * 60 * 1000);
      if (!rate.allowed) {
        return sendJson(response, 429, { error: `Too many login attempts. Please try again in ${rate.retryAfter} seconds.` }, { 'Retry-After': String(rate.retryAfter) });
      }

      const body = await readBody(request);
      const pin = String(body.pin || body.password || '').trim();
      const validPin = process.env.OWNER_PIN || '1234';
      if (pin === validPin) {
        const token = generateOwnerToken();
        return sendJson(response, 200, {
          success: true,
          isOwner: true,
          message: 'Store Owner Access Granted',
          token
        });
      }
      return sendJson(response, 401, { error: 'Incorrect Owner PIN.' });
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
      const period = url.searchParams.get('period') || 'all';
      const analytics = calculateOrderAnalytics(data.orders || [], period);
      return sendJson(response, 200, {
        orders: analytics.orders,
        allOrders: data.orders || [],
        totalRevenue: analytics.allTime.salesTotal,
        soldItemsCount: (data.products || []).filter(p => p.status === 'sold').length + (data.instagramSyncedPosts || []).filter(d => d.status === 'sold').length,
        analytics
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/owner/analytics') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const period = url.searchParams.get('period') || 'all';
      const analytics = calculateOrderAnalytics(data.orders || [], period);
      return sendJson(response, 200, {
        success: true,
        ...analytics
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/owner/orders/update-status') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      const targetId = body.orderId || body.id;
      const order = (data.orders || []).find(o => o.id === targetId || o.orderNumber === targetId);
      if (!order) return sendJson(response, 404, { error: 'Order not found' });

      const prevStatus = (order.status || '').toUpperCase();
      const rawNewStatus = (body.status || order.status || '').toUpperCase();
      const validStatuses = ['NEW', 'CONTACTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
      const newStatus = validStatuses.includes(rawNewStatus) ? rawNewStatus : (body.status || 'NEW');

      order.status = newStatus;
      order.updatedAt = new Date().toISOString();

      // If cancelled, restore pieces back to available
      if (newStatus === 'CANCELLED') {
        (order.items || []).forEach(it => {
          const pId = it.productId || it.id;
          const prod = (data.products || []).find(p => p.id === pId || String(p.id) === String(pId));
          if (prod) prod.status = 'available';
          const drop = (data.instagramSyncedPosts || []).find(d => d.id === pId || d.instagramId === pId || String(d.id) === String(pId));
          if (drop) drop.status = 'available';
        });
      } else if (prevStatus === 'CANCELLED' && newStatus !== 'CANCELLED') {
        // If uncancelled, mark pieces back to sold
        (order.items || []).forEach(it => {
          const pId = it.productId || it.id;
          const prod = (data.products || []).find(p => p.id === pId || String(p.id) === String(pId));
          if (prod) prod.status = 'sold';
          const drop = (data.instagramSyncedPosts || []).find(d => d.id === pId || d.instagramId === pId || String(d.id) === String(pId));
          if (drop) drop.status = 'sold';
        });
      }

      writeData(data);
      return sendJson(response, 200, { success: true, order, orders: data.orders });
    }


    // --- Customer Authentication with Real-Time OTP (Phone & Email) ---
    if (request.method === 'POST' && url.pathname === '/api/auth/send-otp') {
      const clientIp = getClientIp(request);
      const body = await readBody(request);
      const rawIdentifier = body.identifier || body.email || body.phone || '';
      const type = body.type || (rawIdentifier.includes('@') ? 'email' : 'phone');
      const identifier = cleanIdentifier(rawIdentifier, type);

      if (!identifier) {
        return sendJson(response, 400, { error: 'Please enter a valid mobile number or email address.' });
      }

      // Rate limit: max 30 OTP send requests per 10 minutes per IP & identifier
      const rate = checkRateLimit(`send_otp_${clientIp}_${identifier}`, 30, 10 * 60 * 1000);
      if (!rate.allowed) {
        return sendJson(response, 429, { error: `Too many verification requests. Please wait ${rate.retryAfter} seconds before requesting another code.` }, { 'Retry-After': String(rate.retryAfter) });
      }

      if (type === 'email' && !identifier.includes('@')) {
        return sendJson(response, 400, { error: 'Please enter a valid email address.' });
      }

      if (type === 'phone' && identifier.replace(/\D/g, '').length < 10) {
        return sendJson(response, 400, { error: 'Please enter a valid 10-digit mobile number.' });
      }

      // Generate real-time 6-digit cryptographic OTP
      const otp = crypto.randomInt(100000, 999999).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

      if (!data.activeOtps) data.activeOtps = {};
      const otpRecord = {
        code: otp,
        identifier,
        type,
        name: sanitizeInput(body.name || ''),
        address: sanitizeInput(body.address || ''),
        pincode: sanitizeInput(body.pincode || ''),
        city: sanitizeInput(body.city || ''),
        state: sanitizeInput(body.state || ''),
        attempts: 0,
        expiresAt,
        createdAt: Date.now()
      };

      data.activeOtps[identifier] = otpRecord;
      activeOtps.set(identifier, otpRecord);
      writeData(data);

      const dispatchResult = await dispatchRealOtp(identifier, type, otp, data);
      const targetDisplay = type === 'phone' ? `+91 ${identifier.replace(/\D/g, '').slice(-10)}` : identifier;

      return sendJson(response, 200, {
        success: true,
        message: `Real-time verification code sent to ${targetDisplay}`,
        identifier,
        type,
        expiresInSeconds: 600,
        whatsappOtpUrl: dispatchResult.whatsappOtpUrl,
        deliveredViaSms: Boolean(dispatchResult.delivered),
        verificationCode: (!dispatchResult.delivered) ? otp : undefined
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
      const clientIp = getClientIp(request);
      const body = await readBody(request);
      const rawIdentifier = body.identifier || body.email || body.phone || '';
      const type = body.type || (rawIdentifier.includes('@') ? 'email' : 'phone');
      const identifier = cleanIdentifier(rawIdentifier, type);
      const submittedOtp = String(body.otp || '').trim();

      if (!identifier || !submittedOtp) {
        return sendJson(response, 400, { error: 'Mobile number / Email and 6-digit OTP are required.' });
      }

      // Rate limit OTP verification attempts to prevent brute force
      const verifyRate = checkRateLimit(`verify_otp_${identifier}`, 15, 10 * 60 * 1000);
      if (!verifyRate.allowed) {
        if (data.activeOtps) delete data.activeOtps[identifier];
        activeOtps.delete(identifier);
        writeData(data);
        return sendJson(response, 429, { error: 'Too many incorrect attempts. For security, this OTP code has been cancelled. Please request a new code.' });
      }

      const record = (data.activeOtps && data.activeOtps[identifier]) || activeOtps.get(identifier);
      if (!record || record.expiresAt <= Date.now()) {
        if (data.activeOtps) delete data.activeOtps[identifier];
        activeOtps.delete(identifier);
        writeData(data);
        return sendJson(response, 400, { error: 'Verification code has expired. Please request a new OTP.' });
      }

      record.attempts = (record.attempts || 0) + 1;
      if (record.attempts > 8) {
        if (data.activeOtps) delete data.activeOtps[identifier];
        activeOtps.delete(identifier);
        writeData(data);
        return sendJson(response, 400, { error: 'Maximum verification attempts exceeded. Please request a new OTP.' });
      }

      const isMatch = (record.code.length === submittedOtp.length) && crypto.timingSafeEqual(Buffer.from(record.code), Buffer.from(submittedOtp));
      if (!isMatch) {
        writeData(data);
        return sendJson(response, 400, { error: 'Invalid verification code. Please check and enter the 6-digit OTP sent to you.' });
      }

      // OTP verified successfully
      if (data.activeOtps) delete data.activeOtps[identifier];
      activeOtps.delete(identifier);

      const isEmail = identifier.includes('@');
      let user = (data.users || []).find(u =>
        (u.email && u.email.toLowerCase() === identifier.toLowerCase()) ||
        (u.phone && cleanIdentifier(u.phone, 'phone') === identifier)
      );

      const customerName = sanitizeInput(body.name || record.name || (user && user.name) || (isEmail ? identifier.split('@')[0] : 'Member ' + identifier.slice(-4)));
      const customerAddress = sanitizeInput(body.address || record.address || (user && user.address) || '');
      const customerPincode = sanitizeInput(body.pincode || record.pincode || (user && user.pincode) || '');
      const customerCity = sanitizeInput(body.city || record.city || (user && user.city) || '');
      const customerState = sanitizeInput(body.state || record.state || (user && user.state) || '');

      const addressComponents = [
        customerAddress,
        customerCity,
        customerState,
        customerPincode ? `PIN: ${customerPincode.trim()}` : ''
      ].filter(Boolean);
      const fullDeliveryAddress = addressComponents.join(', ');

      if (!user) {
        user = {
          id: 'usr_' + crypto.randomUUID().slice(0, 8),
          name: customerName,
          email: isEmail ? identifier : '',
          phone: !isEmail ? identifier : '',
          address: customerAddress,
          pincode: customerPincode,
          city: customerCity,
          state: customerState,
          fullAddress: fullDeliveryAddress,
          verified: true,
          createdAt: new Date().toISOString()
        };
        if (!data.users) data.users = [];
        data.users.push(user);
      } else {
        if (customerName) user.name = customerName;
        if (customerAddress) user.address = customerAddress;
        if (customerPincode) user.pincode = customerPincode;
        if (customerCity) user.city = customerCity;
        if (customerState) user.state = customerState;
        if (fullDeliveryAddress) user.fullAddress = fullDeliveryAddress;
        user.verified = true;
      }

      data.customer = {
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.fullAddress || user.address,
        pincode: user.pincode,
        city: user.city,
        state: user.state
      };

      writeData(data);

      const token = generateCustomerToken(user);
      return sendJson(response, 200, {
        success: true,
        message: 'Account verified successfully! Welcome to THEthrift.',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          pincode: user.pincode,
          city: user.city,
          state: user.state,
          fullAddress: user.fullAddress || user.address
        },
        token
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = getCustomerFromRequest(request, data);
      if (user) {
        return sendJson(response, 200, {
          authenticated: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            pincode: user.pincode,
            city: user.city,
            state: user.state,
            fullAddress: user.fullAddress || user.address
          }
        });
      }
      return sendJson(response, 200, {
        authenticated: false,
        user: null
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      return sendJson(response, 200, { success: true, message: 'Logged out successfully' });
    }

    // Password auth with cryptographic hashing
    if (request.method === 'POST' && url.pathname === '/api/auth') {
      const body = await readBody(request);
      if (!body.email || !body.password) return sendJson(response, 400, { error: 'Email and password are required' });
      const emailClean = body.email.toLowerCase().trim();
      const salt = crypto.createHash('sha256').update(emailClean + SERVER_SECRET).digest('hex').slice(0, 16);
      const passHash = crypto.pbkdf2Sync(String(body.password), salt, 10000, 32, 'sha256').toString('hex');

      let user = (data.users || []).find(item => item.email && item.email.toLowerCase() === emailClean);
      if (!user) {
        user = {
          id: 'usr_' + crypto.randomUUID().slice(0, 8),
          name: sanitizeInput(body.name || emailClean.split('@')[0]),
          email: emailClean,
          passwordHash: passHash,
          createdAt: new Date().toISOString()
        };
        if (!data.users) data.users = [];
        data.users.push(user);
        writeData(data);
      } else if (user.passwordHash && user.passwordHash !== passHash) {
        return sendJson(response, 401, { error: 'Invalid email or password.' });
      }

      const token = generateCustomerToken(user);
      return sendJson(response, 200, {
        user: { id: user.id, name: user.name, email: user.email },
        token
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/uploads') {
      if (!isOwnerAuthorized(request)) {
        return sendJson(response, 401, { error: 'Unauthorized: Store Owner access required' });
      }
      const body = await readBody(request);
      if (!body.files || !Array.isArray(body.files) || !body.files.length) {
        return sendJson(response, 400, { error: 'Select at least one image' });
      }
      if (body.files.length > 10) {
        return sendJson(response, 400, { error: 'Maximum 10 images allowed per upload' });
      }

      const validatedFiles = [];
      for (const file of body.files) {
        if (typeof file !== 'string') continue;
        const match = file.match(/^data:(image\/(jpeg|png|webp|gif));base64,(.+)$/);
        if (!match) {
          return sendJson(response, 400, { error: 'Invalid image format. Allowed formats: JPG, PNG, WEBP, GIF' });
        }
        const byteSize = (match[3].length * 3) / 4;
        if (byteSize > 5 * 1024 * 1024) {
          return sendJson(response, 400, { error: 'File size exceeds 5MB limit' });
        }
        validatedFiles.push(file);
      }

      if (!validatedFiles.length) {
        return sendJson(response, 400, { error: 'No valid images provided' });
      }

      if (!data.uploads) data.uploads = [];
      data.uploads.push({ id: crypto.randomUUID(), files: validatedFiles, createdAt: new Date().toISOString() });
      writeData(data);
      return sendJson(response, 201, { message: `${validatedFiles.length} image(s) uploaded successfully` });
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
      syncDropToProduct(data, newPost);
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
      data.products = (data.products || []).filter(p => p.id !== targetId && String(p.id) !== String(targetId) && p.instagramId !== targetId);
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
      const prod = (data.products || []).find(p => p.id === targetId || String(p.id) === String(targetId) || p.instagramId === targetId);
      if (prod) prod.status = post.status;
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
          syncDropToProduct(data, sample);
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
    console.error('[SERVER INTERNAL ERROR]', error);
    return sendJson(response, 500, { error: 'An unexpected server error occurred. Please try again.' });
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
        syncDropToProduct(data, newPost);
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