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

// Stealth configuration for BuySpeed
const STEALTH_CONFIG = {
  MIN_DELAY: 3000,
  MAX_DELAY: 8000,
  JITTER_RANGE: 2000,
  MAX_CONCURRENT: 1,
  BACKOFF_BASE: 5000,
  BACKOFF_MAX: 60000,
  RETRY_ATTEMPTS: 3
};

// ============================================================================
// QUEUE STATE
// ============================================================================
let linkQueue = [];
let contractQueue = [];
let isProcessing = false;
let queueStats = { pending: 0, completed: 0, failed: 0 };
let contractStats = { pending: 0, completed: 0, failed: 0 };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getJitter = () => Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;

// Gaussian random for more human-like delays
function gaussianRandom(min, max) {
  // Box-Muller transform for gaussian distribution
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  num = num / 10.0 + 0.5; // Translate to 0-1
  if (num > 1 || num < 0) return gaussianRandom(min, max);
  return Math.floor(num * (max - min) + min);
}

function getStealthDelay() {
  return gaussianRandom(STEALTH_CONFIG.MIN_DELAY, STEALTH_CONFIG.MAX_DELAY) +
         Math.floor(Math.random() * STEALTH_CONFIG.JITTER_RANGE);
}

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
// STEALTH FETCH FOR BUYSPEED
// ============================================================================
async function stealthFetch(url, attempt = 0) {
  // Apply stealth delay before fetch
  const delay = getStealthDelay();
  await sleep(delay);
  
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
  
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'include', // CRITICAL: Maintains session/authentication state for logged-in portals
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    clearTimeout(tid);
    
    // Handle rate limiting with exponential backoff
    if (res.status === 429 || res.status === 503) {
      if (attempt < STEALTH_CONFIG.RETRY_ATTEMPTS) {
        const backoffDelay = Math.min(
          STEALTH_CONFIG.BACKOFF_BASE * Math.pow(2, attempt),
          STEALTH_CONFIG.BACKOFF_MAX
        );
        console.log(`[Stealth] Rate limited, backing off ${backoffDelay}ms`);
        await sleep(backoffDelay);
        return stealthFetch(url, attempt + 1);
      }
    }
    
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

// ============================================================================
// CONTRACT QUEUE PROCESSOR
// ============================================================================
async function processContractQueue() {
  if (isProcessing || contractQueue.length === 0) return;
  isProcessing = true;
  
  console.log(`[Contract] Processing queue: ${contractQueue.length} contracts`);
  broadcastContractStatus();
  
  while (contractQueue.length > 0) {
    const item = contractQueue.shift();
    contractStats.pending = contractQueue.length;
    broadcastContractStatus();
    
    try {
      const result = await handleContractFetch(item.url);
      
      if (result.success) {
        contractStats.completed++;
      } else {
        contractStats.failed++;
        console.error(`[Contract] Failed to fetch ${item.url}: ${result.error}`);
      }
    } catch (e) {
      console.error(`[Contract] Queue error: ${e.message}`);
      contractStats.failed++;
    }
    
    broadcastContractStatus();
  }
  
  isProcessing = false;
  console.log('[Contract] Queue processing complete');
  broadcastContractStatus();
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

// ============================================================================
// CONTRACT STORAGE
// ============================================================================
async function saveContract(contract) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['contracts', 'contractStats'], (result) => {
      const existing = result.contracts || [];
      const existingSet = new Set(existing.map(c => c.poNumber));
      
      // Only add if not duplicate
      if (!existingSet.has(contract.poNumber) && contract.poNumber) {
        const all = [...existing, {
          ...contract,
          foundAt: new Date().toISOString()
        }];
        
        const stats = result.contractStats || { totalFound: 0, pagesProcessed: 0 };
        stats.totalFound = all.length;
        
        chrome.storage.local.set({ contracts: all, contractStats: stats }, () => {
          broadcastContractUpdate(all.length, 1);
          resolve(1);
        });
      } else {
        resolve(0);
      }
    });
  });
}

async function handleContractFetch(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL', url };
  }
  
  try {
    const res = await stealthFetch(url);
    
    if (!res.ok) {
      return { 
        success: false, 
        error: `HTTP ${res.status}`, 
        url,
        status: res.status 
      };
    }
    
    const html = await res.text();
    
    // Extract contract data from HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const contract = extractContractFromDOM(doc, url);
    
    if (contract.poNumber) {
      await saveContract(contract);
      return { success: true, contract, url };
    } else {
      return { success: false, error: 'No contract data found', url };
    }
    
  } catch (e) {
    if (e.name === 'AbortError') {
      return { success: false, error: 'Timeout', url };
    }
    return { success: false, error: e.message || 'Fetch error', url };
  }
}

function extractContractFromDOM(doc, url) {
  const contract = {
    poNumber: '',
    description: '',
    purchaserName: '',
    vendorName: '',
    vendorContactName: '',
    vendorEmail: '',
    vendorPhone: '',
    vendorAddress: '',
    contractValue: '',
    url: url
  };
  
  try {
    const cells = doc.querySelectorAll('td.tableText-01, td[class*="tableText"]');
    const allText = doc.body.innerText || doc.body.textContent || '';
    
    // Extract PO Number
    contract.poNumber = extractFieldFromCells('Purchase Order Number:', cells) ||
                       extractFieldFromCells('PO Number:', cells) ||
                       extractFromText(allText, /PO[-\s]?([A-Z0-9\-]+)/i);
    
    // Extract Description
    contract.description = extractFieldFromCells('Short Description:', cells) ||
                          extractFieldFromCells('Description:', cells);
    
    // Extract Purchaser
    contract.purchaserName = extractFieldFromCells('Purchaser:', cells);
    
    // Extract Vendor Info
    const vendorNameField = extractFieldFromCells('Company Name:', cells) ||
                           extractFieldFromCells('Vendor Name:', cells) ||
                           extractFieldFromCells('Vendor:', cells);
    if (vendorNameField) {
      const match = vendorNameField.match(/(?:V\d+\s*-\s*)?(.+)/);
      contract.vendorName = match ? match[1].trim() : vendorNameField;
    }
    
    contract.vendorContactName = extractFieldFromCells('Contact Name:', cells) ||
                                extractFieldFromCells('Contact:', cells);
    
    // Extract email and phone from text
    contract.vendorEmail = extractEmailFromText(allText);
    contract.vendorPhone = extractPhoneFromText(allText);
    
    // Extract address
    contract.vendorAddress = extractFieldFromCells('Address:', cells) ||
                            extractFieldFromCells('Street Address:', cells) ||
                            extractAddressFromText(allText);
    
    // Extract contract value
    contract.contractValue = extractFieldFromCells('Total PO Amount:', cells) ||
                            extractFieldFromCells('Contract Value:', cells) ||
                            extractFieldFromCells('Amount:', cells) ||
                            extractFromText(allText, /\$[\d,]+\.?\d*/);
    
  } catch (e) {
    console.error('[Contract] Extraction error:', e);
  }
  
  return contract;
}

function extractFieldFromCells(label, cells) {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const text = (cell.textContent || '').trim();
    
    if (text === label || text.includes(label)) {
      const nextCell = cells[i + 1];
      if (nextCell) {
        const value = (nextCell.textContent || '').trim();
        if (value && value !== label) return value;
      }
    }
  }
  return '';
}

function extractEmailFromText(text) {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const matches = text.match(emailRegex);
  if (matches && matches.length > 0) {
    // Filter out common placeholder/test email domains (not URL sanitization)
    // These checks are on email addresses like "test@example.com", not URLs
    const valid = matches.filter(e => 
      !e.includes('example.com') && 
      !e.includes('test.com') &&
      !e.includes('domain.com')
    );
    return valid[0] || '';
  }
  return '';
}

function extractPhoneFromText(text) {
  const phoneRegex = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
  const matches = text.match(phoneRegex);
  return matches ? matches[0] : '';
}

function extractAddressFromText(text) {
  // Matches US address format: street number + name + type (St/Ave/Rd/Floor/Suite), city, state (2 letters), ZIP (5 or 5-4 digits)
  // Example: "515 S Flower St. 17th Floor, Los Angeles, CA 90071" or "123 Main Street, Suite 100, Boston, MA 02101-1234"
  const addressMatch = text.match(/(\d+\s+[A-Za-z0-9\s,\.]+(?:Street|St|Avenue|Ave|Road|Rd|Floor|Suite|Ste)[^,]*,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
  return addressMatch ? addressMatch[1].trim() : '';
}

function extractFromText(text, pattern) {
  const match = text.match(pattern);
  return match ? (match[1] || match[0]) : '';
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

function broadcastContractStatus() {
  chrome.runtime.sendMessage({
    type: 'CONTRACT_STATUS',
    data: {
      pending: contractQueue.length,
      processing: isProcessing,
      stats: contractStats
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

function broadcastContractUpdate(total, added) {
  chrome.runtime.sendMessage({
    type: 'CONTRACTS_UPDATED',
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
    
    case 'QUEUE_CONTRACT_LINKS':
      const contractLinks = request.links || [];
      for (const link of contractLinks) {
        if (!contractQueue.some(l => l.url === link.url)) {
          contractQueue.push(link);
        }
      }
      contractStats.pending = contractQueue.length;
      sendResponse({ queued: contractLinks.length, total: contractQueue.length });
      processContractQueue();
      return false;
    
    case 'GET_QUEUE_STATUS':
      sendResponse({
        pending: linkQueue.length,
        processing: isProcessing,
        stats: queueStats
      });
      return false;
    
    case 'GET_CONTRACT_STATUS':
      sendResponse({
        pending: contractQueue.length,
        processing: isProcessing,
        stats: contractStats
      });
      return false;
    
    case 'CLEAR_QUEUE':
      linkQueue = [];
      contractQueue = [];
      queueStats = { pending: 0, completed: 0, failed: 0 };
      contractStats = { pending: 0, completed: 0, failed: 0 };
      sendResponse({ success: true });
      broadcastStatus();
      broadcastContractStatus();
      return false;
    
    case 'SAVE_EMAILS':
      saveEmails(request.emails, request.source, 'direct').then(count => {
        sendResponse({ saved: count });
      });
      return true;
    
    case 'SAVE_CONTRACT':
      saveContract(request.contract).then(count => {
        sendResponse({ saved: count });
      });
      return true;
    
    case 'GET_DATA':
      chrome.storage.local.get(['emails', 'stats', 'contracts', 'contractStats'], (result) => {
        sendResponse({
          emails: result.emails || [],
          stats: result.stats || { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 },
          contracts: result.contracts || [],
          contractStats: result.contractStats || { totalFound: 0, pagesProcessed: 0 }
        });
      });
      return true;
    
    case 'CLEAR_DATA':
      chrome.storage.local.set({
        emails: [],
        stats: { totalFound: 0, pagesProcessed: 0, linksScraped: 0, errors: 0 },
        contracts: [],
        contractStats: { totalFound: 0, pagesProcessed: 0 }
      }, () => {
        linkQueue = [];
        contractQueue = [];
        queueStats = { pending: 0, completed: 0, failed: 0 };
        contractStats = { pending: 0, completed: 0, failed: 0 };
        sendResponse({ success: true });
        broadcastStatus();
        broadcastContractStatus();
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
      contracts: [],
      contractStats: { totalFound: 0, pagesProcessed: 0 },
      filter: '',
      mode: 'email' // 'email' or 'contract'
    });
  }
});

console.log('[SerpScoop] Background service worker initialized');
