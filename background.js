/**
 * SerpScoop - Background Service Worker
 * Handles background queue processing for deep link scraping
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  FETCH_TIMEOUT: 12000,
  MIN_DELAY: 2000,
  MAX_DELAY: 5000,
  MAX_CONCURRENT: 1,
  EMAIL_REGEX: /(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/gi,
  EXCLUDE_PATTERNS: [
    /example\.com$/i, /test\.com$/i, /domain\.com$/i, /yoursite\.com$/i,
    /sentry\.io$/i, /wixpress\.com$/i, /schema\.org$/i,
    /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js)$/i
  ]
};

// ============================================================================
// QUEUE STATE
// ============================================================================
let linkQueue = [];
let isProcessing = false;
let queueStats = { pending: 0, completed: 0, failed: 0 };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getJitter = () => Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;

function isValidEmail(email) {
  if (!email || email.length < 5 || email.length > 254) return false;
  for (const p of CONFIG.EXCLUDE_PATTERNS) if (p.test(email)) return false;
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].includes('.');
}

function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(CONFIG.EMAIL_REGEX) || [];
  const valid = [];
  for (const e of matches) {
    const clean = e.toLowerCase().trim();
    if (isValidEmail(clean) && !valid.includes(clean)) valid.push(clean);
  }
  return valid;
}

// ============================================================================
// FETCH WITH TIMEOUT
// ============================================================================
async function fetchWithTimeout(url, timeout = CONFIG.FETCH_TIMEOUT) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      },
      credentials: 'omit'
    });
    clearTimeout(tid);
    return res;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ============================================================================
// FETCH URL HANDLER
// ============================================================================
async function handleFetchRequest(url) {
  if (!url || typeof url !== 'string') return { success: false, error: 'Invalid URL', url };
  
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalizedUrl = 'https://' + url;
  }
  
  try { new URL(normalizedUrl); } catch { return { success: false, error: 'Malformed URL', url }; }
  
  try {
    const res = await fetchWithTimeout(normalizedUrl);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}`, url: normalizedUrl, status: res.status };
    
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) {
      return { success: false, error: 'Non-HTML', url: normalizedUrl };
    }
    
    return { success: true, html: await res.text(), url: normalizedUrl };
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, error: 'Timeout', url: normalizedUrl };
    return { success: false, error: e.message || 'Fetch error', url: normalizedUrl };
  }
}

// ============================================================================
// BACKGROUND QUEUE PROCESSOR
// ============================================================================
async function processQueue() {
  if (isProcessing || linkQueue.length === 0) return;
  isProcessing = true;
  
  console.log(`[SerpScoop] Processing queue: ${linkQueue.length} links`);
  broadcastStatus();
  
  while (linkQueue.length > 0) {
    const item = linkQueue.shift();
    queueStats.pending = linkQueue.length;
    broadcastStatus();
    
    try {
      await sleep(getJitter());
      const result = await handleFetchRequest(item.url);
      
      if (result.success && result.html) {
        const emails = extractEmails(result.html);
        if (emails.length > 0) {
          await saveEmails(emails, item.domain, 'background');
        }
        queueStats.completed++;
      } else {
        queueStats.failed++;
      }
    } catch (e) {
      console.error(`[SerpScoop] Queue error: ${e.message}`);
      queueStats.failed++;
    }
    
    broadcastStatus();
  }
  
  isProcessing = false;
  console.log('[SerpScoop] Queue processing complete');
  broadcastStatus();
}

async function saveEmails(emails, source, method = 'direct') {
  return new Promise((resolve) => {
    chrome.storage.local.get(['emails', 'stats'], (result) => {
      const existing = result.emails || [];
      const existingSet = new Set(existing.map(e => e.email));
      const toAdd = [];
      
      for (const email of emails) {
        if (!existingSet.has(email)) {
          existingSet.add(email);
          toAdd.push({
            email,
            source,
            domain: email.split('@')[1],
            method,
            foundAt: new Date().toISOString()
          });
        }
      }
      
      if (toAdd.length > 0) {
        const all = [...existing, ...toAdd];
        const stats = result.stats || { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 };
        stats.totalFound = all.length;
        stats.linksScraped += 1;
        
        chrome.storage.local.set({ emails: all, stats }, () => {
          broadcastEmailUpdate(all.length, toAdd.length);
          resolve(toAdd.length);
        });
      } else {
        resolve(0);
      }
    });
  });
}

function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'QUEUE_STATUS',
    data: {
      pending: linkQueue.length,
      processing: isProcessing,
      stats: queueStats
    }
  }).catch(() => {});
}

function broadcastEmailUpdate(total, added) {
  chrome.runtime.sendMessage({
    type: 'EMAILS_UPDATED',
    total,
    added
  }).catch(() => {});
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'FETCH_URL':
      handleFetchRequest(request.url).then(sendResponse);
      return true;
    
    case 'QUEUE_LINKS':
      const newLinks = request.links || [];
      for (const link of newLinks) {
        if (!linkQueue.some(l => l.url === link.url)) {
          linkQueue.push(link);
        }
      }
      queueStats.pending = linkQueue.length;
      sendResponse({ queued: newLinks.length, total: linkQueue.length });
      processQueue();
      return false;
    
    case 'GET_QUEUE_STATUS':
      sendResponse({
        pending: linkQueue.length,
        processing: isProcessing,
        stats: queueStats
      });
      return false;
    
    case 'CLEAR_QUEUE':
      linkQueue = [];
      queueStats = { pending: 0, completed: 0, failed: 0 };
      sendResponse({ success: true });
      broadcastStatus();
      return false;
    
    case 'SAVE_EMAILS':
      saveEmails(request.emails, request.source, 'direct').then(count => {
        sendResponse({ saved: count });
      });
      return true;
    
    case 'GET_DATA':
      chrome.storage.local.get(['emails', 'stats'], (result) => {
        sendResponse({
          emails: result.emails || [],
          stats: result.stats || { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 }
        });
      });
      return true;
    
    case 'CLEAR_DATA':
      chrome.storage.local.set({
        emails: [],
        stats: { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 }
      }, () => {
        linkQueue = [];
        queueStats = { pending: 0, completed: 0, failed: 0 };
        sendResponse({ success: true });
        broadcastStatus();
      });
      return true;
    
    case 'INCREMENT_PAGES':
      chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 };
        stats.pagesProcessed += 1;
        chrome.storage.local.set({ stats }, () => sendResponse({ pages: stats.pagesProcessed }));
      });
      return true;
  }
});

// ============================================================================
// INSTALLATION
// ============================================================================
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      emails: [],
      stats: { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 },
      filter: ''
    });
  }
});

console.log('[SerpScoop] Background service worker initialized');
