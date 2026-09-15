const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = process.env.PORT || 3000;
const root = __dirname;
const dataPath = path.join(root, 'data.json');
const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const tmpDataPath = '/tmp/thrift_data.json';

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
      memoryData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
  }
  return memoryData;
}

function writeData(data) {
  memoryData = data;
  try { fs.writeFileSync(tmpDataPath, JSON.stringify(data, null, 2)); } catch (error) {}
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); } catch (error) { /* Vercel deployment files are read-only. */ }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
  const requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const filePath = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
  if (!filePath.startsWith(root)) return sendJson(response, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
}

const handler = async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
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
    if (request.method === 'GET' && url.pathname === '/api/products') return sendJson(response, 200, data.products);
    if (request.method === 'GET' && url.pathname === '/api/reviews') return sendJson(response, 200, data.reviews);
    if (request.method === 'GET' && url.pathname === '/api/customer') return sendJson(response, 200, data.customer);
    if (request.method === 'GET' && url.pathname === '/api/orders') return sendJson(response, 200, data.orders);
    if (request.method === 'GET' && url.pathname === '/api/cart') return sendJson(response, 200, data.cart.map(id => data.products.find(product => product.id === id)).filter(Boolean));
    if (request.method === 'POST' && url.pathname === '/api/cart') {
      const body = await readBody(request);
      const product = data.products.find(item => item.id === Number(body.productId));
      if (!product) return sendJson(response, 404, { error: 'Product not found' });
      if (product.status === 'sold') return sendJson(response, 409, { error: 'This piece has already been sold' });
      if (!data.cart.includes(Number(body.productId))) data.cart.push(Number(body.productId));
      writeData(data);
      return sendJson(response, 201, { count: data.cart.length });
    }
    if (request.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(request);
      const items = data.cart.map(id => data.products.find(product => product.id === id)).filter(Boolean);
      if (!items.length) return sendJson(response, 400, { error: 'Your bag is empty' });
      if (!body.name || !body.email || !body.phone || !body.address) return sendJson(response, 400, { error: 'Name, email, phone, and address are required' });
      const order = {
        id: `KHAK-${Date.now().toString(36).toUpperCase()}`,
        customer: { name: body.name, email: body.email, phone: body.phone, address: body.address },
        items,
        total: items.reduce((sum, item) => sum + item.price, 0),
        status: 'accepted',
        createdAt: new Date().toISOString()
      };
      data.customer = order.customer;
      data.orders.push(order);
      data.cart = [];
      writeData(data);
      return sendJson(response, 201, order);
    }
    if (request.method === 'POST' && url.pathname === '/api/auth') {
      const body = await readBody(request);
      if (!body.email || !body.password) return sendJson(response, 400, { error: 'Email and password are required' });
      let user = data.users.find(item => item.email === body.email);
      if (!user) {
        user = { id: crypto.randomUUID(), name: body.name || body.email.split('@')[0], email: body.email, password: body.password };
        data.users.push(user);
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

    // Instagram OAuth and Integration routes
    if (request.method === 'GET' && url.pathname === '/api/instagram/connect') {
      const config = getInstagramConfig(request);
      const state = crypto.randomUUID();
      const authUrl = `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=code&scope=user_profile,user_posts&state=${state}`;
      return sendJson(response, 200, { authUrl, redirectUri: config.redirectUri });
    }

    if (request.method === 'GET' && url.pathname === '/api/instagram/callback') {
      const code = url.searchParams.get('code');
      if (!code) return sendJson(response, 400, { error: 'No code received from Instagram' });
      const config = getInstagramConfig(request);
      try {
        const tokenResponse = await fetch(`${config.tokenUrl}?client_id=${config.clientId}&client_secret=${config.clientSecret}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(config.redirectUri)}&code=${code}`, { method: 'POST' });
        const tokenData = await tokenResponse.json();
        if (tokenData.error) return sendJson(response, 400, { error: tokenData.error_description || tokenData.error.message || 'Failed to exchange code for token' });
        
        let data = readData();
        data.instagram = {
          ...(data.instagram || {}),
          connected: true,
          username: tokenData.user_username || data.instagram?.username || 'thethriftzz',
          accountId: tokenData.user_id || '',
          accessToken: tokenData.access_token,
          expiresAt: tokenData.expires_at ? new Date(Date.now() + tokenData.expires_at * 1000).toISOString() : null,
          lastSync: null,
          lastError: null
        };
        writeData(data);
        response.writeHead(302, { Location: '/#instagram-connected' });
        return response.end();
      } catch (error) {
        return sendJson(response, 500, { error: 'Failed to exchange code for token: ' + error.message });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/config') {
      const body = await readBody(request);
      let data = readData();
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
          hasToken: !!(data.instagram && data.instagram.accessToken),
          hasClientCredentials: !!(data.instagram && data.instagram.clientId && data.instagram.clientSecret),
          syncedPostCount: (data.instagramSyncedPosts || []).length
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/sync') {
      try {
        let data = readData();
        const token = data.instagram && data.instagram.accessToken;
        if (!token) return sendJson(response, 400, { error: 'No Instagram Access Token configured. Enter your Access Token in Settings or add demo posts.' });
        
        const syncResult = await syncInstagramPosts(token);
        data = readData();
        data.instagram.lastSync = new Date().toISOString();
        data.instagram.lastError = null;
        writeData(data);
        return sendJson(response, 200, { success: true, synced: syncResult.synced, message: syncResult.message, posts: data.instagramSyncedPosts || [] });
      } catch (error) {
        let data = readData();
        if (data.instagram) {
          data.instagram.lastError = error.message;
          data.instagram.lastSync = new Date().toISOString();
          writeData(data);
        }
        return sendJson(response, 500, { error: error.message });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/add-sample-posts') {
      let data = readData();
      if (!data.instagramSyncedPosts) data.instagramSyncedPosts = [];
      const handle = (data.instagram && data.instagram.username) || 'thethriftzz';
      const samples = [
        {
          id: 'ig-sample-1',
          instagramId: 'sample_post_1',
          permalink: `https://instagram.com/${handle}`,
          imageUrl: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&auto=format&fit=crop&q=80',
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
      let data = readData();
      data.instagramSyncedPosts = [];
      writeData(data);
      return sendJson(response, 200, { success: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/disconnect') {
      let data = readData();
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
      return sendJson(response, 200, { success: true });
    }

    if (request.method === 'GET' && url.pathname === '/api/instagram/status') {
      const data = readData();
      const config = getInstagramConfig(request);
      const ig = data.instagram || {};
      const safeIg = { ...ig };
      delete safeIg.accessToken;
      delete safeIg.clientSecret;
      return sendJson(response, 200, {
        instagram: {
          ...safeIg,
          username: safeIg.username || 'thethriftzz',
          connected: Boolean(safeIg.connected || (ig.accessToken && !ig.lastError)),
          hasToken: Boolean(ig && ig.accessToken),
          hasClientCredentials: Boolean(config.clientId && config.clientId !== 'your-instagram-client-id'),
          redirectUri: config.redirectUri,
          syncedPostCount: (data.instagramSyncedPosts || []).length
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/instagram/posts') {
      const data = readData();
      return sendJson(response, 200, data.instagramSyncedPosts || []);
    }

    return sendJson(response, 404, { error: 'API route not found' });
  } catch (error) {
    return sendJson(response, 500, { error: 'Something went wrong on the server' });
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
        
        const newPost = {
          id: crypto.randomUUID(),
          instagramId: postId,
          imageUrl: imageUrl,
          caption: post.caption || '',
          permalink: post.permalink || `https://instagram.com/${handle}`,
          mediaType: post.media_type,
          postedAt: post.timestamp || new Date().toISOString(),
          status: 'available'
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