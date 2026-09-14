const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = process.env.PORT || 3000;
const root = __dirname;
const dataPath = path.join(root, 'data.json');
const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Instagram configuration - should be moved to environment variables in production
const instagramConfig = {
  clientId: process.env.INSTAGRAM_CLIENT_ID || 'your-instagram-client-id',
  clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || 'your-instagram-client-secret',
  redirectUri: process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/api/instagram/callback',
  authUrl: 'https://api.instagram.com/oauth/authorize',
  tokenUrl: 'https://api.instagram.com/oauth/access_token'
};

let memoryData;

function readData() {
  if (!memoryData) memoryData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return memoryData;
}

function writeData(data) {
  memoryData = data;
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

    // Instagram OAuth routes
    if (request.method === 'GET' && url.pathname === '/api/instagram/connect') {
      const state = crypto.randomUUID();
      const authUrl = `${instagramConfig.authUrl}?client_id=${instagramConfig.clientId}&redirect_uri=${encodeURIComponent(instagramConfig.redirectUri)}&response_type=code&scope=user_profile,user_posts&state=${state}`;
      return sendJson(response, 200, { authUrl });
    }

    if (request.method === 'GET' && url.pathname === '/api/instagram/callback') {
      const code = url.searchParams.get('code');
      if (!code) return sendJson(response, 400, { error: 'No code received from Instagram' });
      try {
        const tokenResponse = await fetch(`${instagramConfig.tokenUrl}?client_id=${instagramConfig.clientId}&client_secret=${instagramConfig.clientRedirectUri}&grant_type=authorization_code&redirect_uri=${instagramConfig.redirectUri}&code=${code}`);
        const tokenData = await tokenResponse.json();
        if (tokenData.error) return sendJson(response, 400, { error: tokenData.error_description || 'Failed to exchange code for token' });
        
        let data = readData();
        data.instagram = {
          connected: true,
          username: tokenData.user_username || '',
          accountId: tokenData.user_id || '',
          accessToken: tokenData.access_token,
          expiresAt: tokenData.expires_at ? new Date(Date.now() + tokenData.expires_at * 1000).toISOString() : null,
          lastSync: null,
          lastError: null
        };
        writeData(data);
        return sendJson(response, 200, { success: true, instagram: data.instagram });
      } catch (error) {
        return sendJson(response, 500, { error: 'Failed to exchange code for token' });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/sync') {
      try {
        let data = readData();
        if (!data.instagram || !data.instagram.accessToken) return sendJson(response, 400, { error: 'Instagram not connected' });
        
        const syncResult = await syncInstagramPosts(data.instagram.accessToken);
        data.instagram.lastSync = new Date().toISOString();
        data.instagram.lastError = null;
        writeData(data);
        return sendJson(response, 200, { success: true, synced: syncResult.synced, message: syncResult.message });
      } catch (error) {
        let data = readData();
        data.instagram.lastError = error.message;
        data.instagram.lastSync = new Date().toISOString();
        writeData(data);
        return sendJson(response, 500, { error: error.message });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/disconnect') {
      let data = readData();
      data.instagram = {
        connected: false,
        username: '',
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
      return sendJson(response, 200, { instagram: data.instagram || { connected: false, username: '', accountId: '' } });
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
    // Fetch recent posts from Instagram
    const postsResponse = await fetch(`https://graph.instagram.com/me/media?access_token=${accessToken}&limit=10`);
    const postsData = await postsResponse.json();
    
    if (postsData.error) throw new Error(postsData.error.message || 'Failed to fetch Instagram posts');
    
    if (postsData.data && postsData.data.length > 0) {
      let data = readData();
      
      for (const post of postsData.data) {
        const postId = post.id;
        const existing = data.instagramSyncedPosts && data.instagramSyncedPosts.some(p => p.instagramId === postId);
        
        if (existing) continue;
        
        let imageUrl = null;
        let caption = '';
        
        // Get media type and image URL
        if (post.media_type === 'IMAGE') {
          imageUrl = post.media_url;
          caption = post.caption || '';
        } else if (post.media_type === 'VIDEO') {
          continue; // Skip videos for now
        }
        
        // Add to database
        const newPost = {
          id: crypto.randomUUID(),
          instagramId: postId,
          imageUrl: imageUrl,
          caption: caption,
          postedAt: post.created_at,
          status: 'available'
        };
        
        if (!data.instagramSyncedPosts) data.instagramSyncedPosts = [];
        data.instagramSyncedPosts.push(newPost);
        writeData(data);
        
        synced.push({
          id: newPost.id,
          imageUrl: imageUrl,
          caption: caption
        });
      }
      
      message = `Synced ${synced.length} new Instagram post(s)`;
    } else {
      message = 'No new posts found';
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