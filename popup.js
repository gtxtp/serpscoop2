/**
 * SerpScoop - Popup Controller
 * Enterprise-grade minimal UI
 */

// ============================================================================
// STATE
// ============================================================================
let emails = [];
let filter = '';
let stats = { totalFound: 0, pagesProcessed: 0, linksScraped: 0 };
let queueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };

// ============================================================================
// DOM REFS
// ============================================================================
const $ = (id) => document.getElementById(id);
const el = {
  runBtn: null, copyBtn: null, downloadBtn: null, clearBtn: null,
  filterInput: null, totalEmails: null, pagesCount: null, queueCount: null,
  linksCount: null, queueStatus: null, queueFill: null, queueText: null,
  primarySection: null, primaryList: null, allList: null,
  matchCount: null, allCount: null, toast: null
};

// ============================================================================
// INIT
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Cache elements
  Object.keys(el).forEach(k => el[k] = $(k) || el[k]);
  el.runBtn = $('runBtn');
  el.copyBtn = $('copyBtn');
  el.downloadBtn = $('downloadBtn');
  el.clearBtn = $('clearBtn');
  el.filterInput = $('filterInput');
  el.totalEmails = $('totalEmails');
  el.pagesCount = $('pagesCount');
  el.queueCount = $('queueCount');
  el.linksCount = $('linksCount');
  el.queueStatus = $('queueStatus');
  el.queueFill = $('queueFill');
  el.queueText = $('queueText');
  el.primarySection = $('primarySection');
  el.primaryList = $('primaryList');
  el.allList = $('allList');
  el.matchCount = $('matchCount');
  el.allCount = $('allCount');
  el.toast = $('toast');

  // Event listeners
  el.runBtn.addEventListener('click', handleRun);
  el.copyBtn.addEventListener('click', handleCopy);
  el.downloadBtn.addEventListener('click', handleDownload);
  el.clearBtn.addEventListener('click', handleClear);
  el.filterInput.addEventListener('input', handleFilter);
  
  // Load saved filter
  chrome.storage.local.get(['filter'], (r) => {
    if (r.filter) {
      el.filterInput.value = r.filter;
      filter = r.filter.toLowerCase();
    }
  });

  // Load data
  await loadData();
  await loadQueueStatus();
  
  // Check tab
  checkTab();
  
  // Poll queue status
  setInterval(loadQueueStatus, 1500);
  
  // Listen for updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'EMAILS_UPDATED' || msg.type === 'QUEUE_STATUS') {
      loadData();
      loadQueueStatus();
    }
  });
  
  // Single email copy delegation
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
      const email = e.target.dataset.email;
      navigator.clipboard.writeText(email).then(() => toast('Copied!'));
    }
  });
});

// ============================================================================
// DATA LOADING
// ============================================================================
async function loadData() {
  const data = await sendMessage({ type: 'GET_DATA' });
  emails = data.emails || [];
  stats = data.stats || stats;
  render();
}

async function loadQueueStatus() {
  const status = await sendMessage({ type: 'GET_QUEUE_STATUS' });
  queueStatus = status || queueStatus;
  renderQueue();
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response || {});
    });
  });
}

// ============================================================================
// RENDERING
// ============================================================================
function render() {
  // Stats
  el.totalEmails.textContent = emails.length;
  el.pagesCount.textContent = stats.pagesProcessed || 0;
  el.linksCount.textContent = stats.linksScraped || 0;

  // Split emails by filter
  const matched = [];
  const others = [];
  
  for (const e of emails) {
    if (filter && e.email.toLowerCase().includes(filter)) {
      matched.push(e);
    } else {
      others.push(e);
    }
  }

  // Show/hide primary section
  if (filter) {
    el.primarySection.classList.remove('hidden');
    el.matchCount.textContent = matched.length;
    el.primaryList.innerHTML = matched.length 
      ? matched.map(renderEmail).join('') 
      : '<div class="empty">No matches</div>';
  } else {
    el.primarySection.classList.add('hidden');
  }

  // All results (show unmatched when filter active, otherwise all)
  const displayList = filter ? others : emails;
  el.allCount.textContent = displayList.length;
  el.allList.innerHTML = displayList.length 
    ? displayList.map(renderEmail).join('') 
    : '<div class="empty">No emails yet</div>';
}

function renderEmail(e) {
  const method = e.method === 'background' ? '◐' : '●';
  return `<div class="email-row">
    <span class="email-text" title="${e.source}">${method} ${e.email}</span>
    <button class="copy-btn" data-email="${e.email}">⧉</button>
  </div>`;
}

function renderQueue() {
  const { pending, processing, stats: qs } = queueStatus;
  el.queueCount.textContent = pending;
  
  if (pending > 0 || processing) {
    el.queueStatus.classList.remove('hidden');
    const total = pending + qs.completed + qs.failed;
    const pct = total > 0 ? Math.round(((qs.completed + qs.failed) / total) * 100) : 0;
    el.queueFill.style.width = `${pct}%`;
    el.queueText.textContent = `${qs.completed}/${total} processed`;
  } else {
    el.queueStatus.classList.add('hidden');
  }
}

// ============================================================================
// HANDLERS
// ============================================================================
async function handleRun() {
  el.runBtn.disabled = true;
  el.runBtn.textContent = '...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { toast('No active tab'); return; }
    
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' });
    
    if (result?.success) {
      toast(`Found ${result.serpEmails} emails, queued ${result.linksQueued} links`);
      await loadData();
      await loadQueueStatus();
    } else {
      toast(result?.message || 'Error');
    }
  } catch (e) {
    toast('Run on a Google search page');
  } finally {
    el.runBtn.disabled = false;
    el.runBtn.textContent = '▶ Run';
  }
}

function handleFilter(e) {
  filter = e.target.value.toLowerCase();
  chrome.storage.local.set({ filter: e.target.value });
  render();
}

async function handleCopy() {
  const list = filter 
    ? emails.filter(e => e.email.toLowerCase().includes(filter))
    : emails;
  
  if (!list.length) { toast('No emails'); return; }
  
  await navigator.clipboard.writeText(list.map(e => e.email).join('\n'));
  toast(`Copied ${list.length} emails`);
}

function handleDownload() {
  const list = filter 
    ? emails.filter(e => e.email.toLowerCase().includes(filter))
    : emails;
  
  if (!list.length) { toast('No emails'); return; }
  
  const csv = 'Email,Domain,Source,Method\n' + 
    list.map(e => `"${e.email}","${e.domain}","${e.source}","${e.method || 'direct'}"`).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serpscoop_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} emails`);
}

async function handleClear() {
  if (!confirm('Clear all data?')) return;
  await sendMessage({ type: 'CLEAR_DATA' });
  emails = [];
  stats = { totalFound: 0, pagesProcessed: 0, linksScraped: 0 };
  queueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };
  render();
  renderQueue();
  toast('Cleared');
}

async function checkTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('google.com/search')) {
      el.runBtn.disabled = true;
      el.runBtn.title = 'Navigate to Google search first';
    }
  } catch {}
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2000);
}
