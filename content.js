/**
 * SerpScoop - Content Script
 * Fast SERP extraction with background queue for deep links
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const EMAIL_REGEX = /(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/gi;

const EXCLUDE_PATTERNS = [
  /example\.com$/i, /test\.com$/i, /domain\.com$/i, /yoursite\.com$/i,
  /sentry\.io$/i, /wixpress\.com$/i, /schema\.org$/i,
  /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js)$/i
];

const SKIP_DOMAINS = [
  'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.de',
  'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'youtube.com',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'pinterest.com',
  'amazon.com', 'ebay.com', 'wikipedia.org', 'wikimedia.org'
];

// ============================================================================
// STATE
// ============================================================================
let isRunning = false;

// ============================================================================
// UTILITIES
// ============================================================================
function isValidEmail(email) {
  if (!email || email.length < 5 || email.length > 254) return false;
  for (const p of EXCLUDE_PATTERNS) if (p.test(email)) return false;
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].includes('.');
}

function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  const valid = [];
  for (const e of matches) {
    const clean = e.toLowerCase().trim();
    if (isValidEmail(clean) && !valid.includes(clean)) valid.push(clean);
  }
  return valid;
}

function shouldSkipUrl(url) {
  try {
    const u = new URL(url);
    for (const d of SKIP_DOMAINS) if (u.hostname.includes(d)) return true;
    const skipPaths = ['/search', '/maps', '/images', '/videos', '/news'];
    for (const p of skipPaths) if (u.pathname.startsWith(p)) return true;
    const skipExt = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.exe'];
    for (const ext of skipExt) if (u.pathname.toLowerCase().endsWith(ext)) return true;
    return false;
  } catch { return true; }
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================
function getResultLinks() {
  const links = [];
  const seen = new Set();
  
  const selectors = [
    '#search a[href^="http"]',
    '#rso a[href^="http"]',
    '.g a[href^="http"]',
    '[data-ved] a[href^="http"]'
  ];
  
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      try {
        const href = el.href;
        if (!href) continue;
        const url = new URL(href);
        const clean = url.origin + url.pathname;
        if (seen.has(clean) || shouldSkipUrl(href)) continue;
        seen.add(clean);
        links.push({ url: href, domain: url.hostname });
      } catch {}
    }
  }
  
  return links;
}

// ============================================================================
// PAGINATION
// ============================================================================
function clickNext() {
  const selectors = ['#pnnext', 'a[aria-label="Next page"]', 'a[id="pnnext"]'];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  for (const a of document.querySelectorAll('a')) {
    const t = a.textContent?.trim().toLowerCase();
    if (t === 'next' || t === 'next ›') { a.click(); return true; }
  }
  return false;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================
async function runExtraction() {
  if (isRunning) return { success: false, message: 'Already running' };
  isRunning = true;
  
  try {
    // Phase 1: Extract emails from SERP descriptions (fast)
    const pageText = document.body.innerText || '';
    const serpEmails = extractEmails(pageText);
    
    if (serpEmails.length > 0) {
      await chrome.runtime.sendMessage({
        type: 'SAVE_EMAILS',
        emails: serpEmails,
        source: 'SERP'
      });
    }
    
    // Phase 2: Queue all result links for background processing
    const links = getResultLinks();
    
    if (links.length > 0) {
      await chrome.runtime.sendMessage({
        type: 'QUEUE_LINKS',
        links: links
      });
    }
    
    // Increment pages processed
    await chrome.runtime.sendMessage({ type: 'INCREMENT_PAGES' });
    
    // Phase 3: Click next immediately
    const hasNext = clickNext();
    
    return {
      success: true,
      serpEmails: serpEmails.length,
      linksQueued: links.length,
      hasNext
    };
    
  } finally {
    isRunning = false;
  }
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_EXTRACTION') {
    runExtraction().then(sendResponse);
    return true;
  }
  if (request.type === 'GET_STATUS') {
    sendResponse({ isRunning });
    return false;
  }
});

console.log('[SerpScoop] Content script loaded');
