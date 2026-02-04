/**
 * SerpScoop - Popup Controller
 * Enterprise-grade minimal UI
 */

// ============================================================================
// STATE
// ============================================================================
let emails = [];
let contracts = [];
let filter = '';
let mode = 'email'; // 'email' or 'contract'
let stats = { totalFound: 0, pagesProcessed: 0, linksScraped: 0 };
let contractStats = { totalFound: 0, pagesProcessed: 0 };
let queueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };
let contractQueueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };

// ============================================================================
// DOM REFS
// ============================================================================
const $ = (id) => document.getElementById(id);
const el = {
  runBtn: null, copyBtn: null, exportJsonBtn: null, exportExcelBtn: null, 
  exportCsvBtn: null, clearBtn: null,
  filterInput: null, totalItems: null, itemsLabel: null, pagesCount: null, 
  queueCount: null, linksCount: null, queueStatus: null, queueFill: null, 
  queueText: null, primarySection: null, primaryList: null, allList: null,
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
  el.exportJsonBtn = $('exportJsonBtn');
  el.exportExcelBtn = $('exportExcelBtn');
  el.exportCsvBtn = $('exportCsvBtn');
  el.clearBtn = $('clearBtn');
  el.filterInput = $('filterInput');
  el.totalItems = $('totalItems');
  el.itemsLabel = $('itemsLabel');
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
  el.exportJsonBtn.addEventListener('click', handleExportJson);
  el.exportExcelBtn.addEventListener('click', handleExportExcel);
  el.exportCsvBtn.addEventListener('click', handleExportCsv);
  el.clearBtn.addEventListener('click', handleClear);
  el.filterInput.addEventListener('input', handleFilter);
  
  // Load saved filter and mode
  chrome.storage.local.get(['filter', 'mode'], (r) => {
    if (r.filter) {
      el.filterInput.value = r.filter;
      filter = r.filter.toLowerCase();
    }
    if (r.mode) {
      mode = r.mode;
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
    if (msg.type === 'EMAILS_UPDATED' || msg.type === 'CONTRACTS_UPDATED' ||
        msg.type === 'QUEUE_STATUS' || msg.type === 'CONTRACT_STATUS') {
      loadData();
      loadQueueStatus();
    }
  });
  
  // Single item copy delegation
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
      const text = e.target.dataset.text;
      navigator.clipboard.writeText(text).then(() => toast('Copied!'));
    }
  });
});

// ============================================================================
// DATA LOADING
// ============================================================================
async function loadData() {
  const data = await sendMessage({ type: 'GET_DATA' });
  emails = data.emails || [];
  contracts = data.contracts || [];
  stats = data.stats || stats;
  contractStats = data.contractStats || contractStats;
  
  // Auto-detect mode based on data
  if (contracts.length > 0 && emails.length === 0) {
    mode = 'contract';
  } else if (emails.length > 0 && contracts.length === 0) {
    mode = 'email';
  }
  
  render();
}

async function loadQueueStatus() {
  const emailStatus = await sendMessage({ type: 'GET_QUEUE_STATUS' });
  const contractStatus = await sendMessage({ type: 'GET_CONTRACT_STATUS' });
  queueStatus = emailStatus || queueStatus;
  contractQueueStatus = contractStatus || contractQueueStatus;
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
  // Update label based on mode
  if (mode === 'contract') {
    el.itemsLabel.textContent = 'Contracts';
    el.totalItems.textContent = contracts.length;
  } else {
    el.itemsLabel.textContent = 'Emails';
    el.totalItems.textContent = emails.length;
  }
  
  // Stats
  el.pagesCount.textContent = stats.pagesProcessed || 0;
  el.linksCount.textContent = stats.linksScraped || 0;

  // Get current dataset
  const dataset = mode === 'contract' ? contracts : emails;
  
  // Split by filter
  const matched = [];
  const others = [];
  
  for (const item of dataset) {
    if (filter && matchesFilter(item, filter)) {
      matched.push(item);
    } else {
      others.push(item);
    }
  }

  // Show/hide primary section
  if (filter) {
    el.primarySection.classList.remove('hidden');
    el.matchCount.textContent = matched.length;
    el.primaryList.innerHTML = matched.length 
      ? matched.map(item => renderItem(item)).join('') 
      : '<div class="empty">No matches</div>';
  } else {
    el.primarySection.classList.add('hidden');
  }

  // All results (show unmatched when filter active, otherwise all)
  const displayList = filter ? others : dataset;
  el.allCount.textContent = displayList.length;
  el.allList.innerHTML = displayList.length 
    ? displayList.map(item => renderItem(item)).join('') 
    : `<div class="empty">No ${mode === 'contract' ? 'contracts' : 'emails'} yet</div>`;
}

function matchesFilter(item, filterText) {
  if (mode === 'contract') {
    // Search across all contract fields
    const searchable = [
      item.poNumber, item.description, item.purchaserName,
      item.vendorName, item.vendorContactName, item.vendorEmail,
      item.vendorPhone, item.vendorAddress, item.contractValue
    ].join(' ').toLowerCase();
    return searchable.includes(filterText);
  } else {
    // Search email
    return item.email.toLowerCase().includes(filterText);
  }
}

function renderItem(item) {
  if (mode === 'contract') {
    return renderContract(item);
  } else {
    return renderEmail(item);
  }
}

function renderEmail(e) {
  const method = e.method === 'background' ? '◐' : '●';
  return `<div class="email-row">
    <span class="email-text" title="${e.source}">${method} ${e.email}</span>
    <button class="copy-btn" data-text="${e.email}">⧉</button>
  </div>`;
}

function renderContract(c) {
  const preview = `${c.vendorName || 'N/A'} - ${c.vendorEmail || 'N/A'}`;
  return `<div class="email-row">
    <span class="email-text" title="${c.poNumber}">${c.poNumber || 'Unknown'}: ${preview}</span>
    <button class="copy-btn" data-text="${c.vendorEmail || c.poNumber}">⧉</button>
  </div>`;
}

function renderQueue() {
  // Show whichever queue is active
  const activeQueue = mode === 'contract' ? contractQueueStatus : queueStatus;
  const { pending, processing, stats: qs } = activeQueue;
  
  el.queueCount.textContent = pending;
  
  if (pending > 0 || processing) {
    el.queueStatus.classList.remove('hidden');
    const total = pending + qs.completed + qs.failed;
    const pct = total > 0 ? Math.round(((qs.completed + qs.failed) / total) * 100) : 0;
    el.queueFill.style.width = `${pct}%`;
    el.queueText.textContent = mode === 'contract' 
      ? `Processing contract ${qs.completed} of ${total}`
      : `${qs.completed}/${total} processed`;
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
    
    // Check if it's a BuySpeed page first
    let pageType = { type: 'unknown', canRun: false };
    try {
      pageType = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_PAGE_TYPE' });
    } catch (e) {
      // Not a BuySpeed page, continue
    }
    
    if (pageType && pageType.canRun && pageType.type.includes('buyspeed')) {
      // Run BuySpeed extraction
      mode = 'contract';
      chrome.storage.local.set({ mode: 'contract' });
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' });
      
      if (result?.success) {
        if (result.type === 'listing') {
          toast(`Found ${result.linksFound} contracts${result.hasNext ? ', advanced to next page' : ''}`);
        } else if (result.type === 'detail') {
          toast('Extracted contract details');
        }
        await loadData();
        await loadQueueStatus();
      } else {
        toast(result?.message || 'Error');
      }
    } else {
      // Try Google SERP extraction
      mode = 'email';
      chrome.storage.local.set({ mode: 'email' });
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' });
      
      if (result?.success) {
        toast(`Found ${result.serpEmails} emails, queued ${result.linksQueued} links`);
        await loadData();
        await loadQueueStatus();
      } else {
        toast('Run on Google search or BuySpeed portal');
      }
    }
  } catch (e) {
    console.error('Run error:', e);
    toast('Run on Google search or BuySpeed portal');
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
  const dataset = mode === 'contract' ? contracts : emails;
  const list = filter 
    ? dataset.filter(item => matchesFilter(item, filter))
    : dataset;
  
  if (!list.length) { 
    toast(`No ${mode === 'contract' ? 'contracts' : 'emails'}`); 
    return; 
  }
  
  let copyText;
  if (mode === 'contract') {
    copyText = list.map(c => c.vendorEmail || c.poNumber).join('\n');
  } else {
    copyText = list.map(e => e.email).join('\n');
  }
  
  await navigator.clipboard.writeText(copyText);
  toast(`Copied ${list.length} ${mode === 'contract' ? 'items' : 'emails'}`);
}

function handleExportJson() {
  const dataset = mode === 'contract' ? contracts : emails;
  const list = filter 
    ? dataset.filter(item => matchesFilter(item, filter))
    : dataset;
  
  if (!list.length) { 
    toast(`No ${mode === 'contract' ? 'contracts' : 'emails'}`); 
    return; 
  }
  
  const exportData = {
    exportDate: new Date().toISOString(),
    type: mode,
    totalItems: list.length,
    items: list
  };
  
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serpscoop-${mode}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} items to JSON`);
}

function handleExportExcel() {
  toast('Excel export requires xlsx library. See README for installation instructions or use JSON/CSV export.');
  // Note: Full Excel export would require the xlsx.mini.min.js library
  // which couldn't be downloaded due to network restrictions.
  // User can manually add the library to enable this feature.
}

function handleExportCsv() {
  const dataset = mode === 'contract' ? contracts : emails;
  const list = filter 
    ? dataset.filter(item => matchesFilter(item, filter))
    : dataset;
  
  if (!list.length) { 
    toast(`No ${mode === 'contract' ? 'contracts' : 'emails'}`); 
    return; 
  }
  
  let csv;
  if (mode === 'contract') {
    csv = 'PO Number,Description,Purchaser Name,Vendor Name,Vendor Contact,Vendor Email,Vendor Phone,Vendor Address,Contract Value\n' + 
      list.map(c => {
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        return [
          escape(c.poNumber), escape(c.description), escape(c.purchaserName),
          escape(c.vendorName), escape(c.vendorContactName), escape(c.vendorEmail),
          escape(c.vendorPhone), escape(c.vendorAddress), escape(c.contractValue)
        ].join(',');
      }).join('\n');
  } else {
    csv = 'Email,Domain,Source,Method\n' + 
      list.map(e => `"${e.email}","${e.domain}","${e.source}","${e.method || 'direct'}"`).join('\n');
  }
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serpscoop-${mode}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} ${mode === 'contract' ? 'contracts' : 'emails'}`);
}

async function handleClear() {
  if (!confirm('Clear all data?')) return;
  await sendMessage({ type: 'CLEAR_DATA' });
  emails = [];
  contracts = [];
  stats = { totalFound: 0, pagesProcessed: 0, linksScraped: 0 };
  contractStats = { totalFound: 0, pagesProcessed: 0 };
  queueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };
  contractQueueStatus = { pending: 0, processing: false, stats: { completed: 0, failed: 0 } };
  render();
  renderQueue();
  toast('Cleared');
}

async function checkTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    
    // Check if it's a valid page for running extraction
    const isGoogle = tab.url.includes('google.com/search');
    const isBuySpeed = tab.url.includes('/bso/') || tab.url.includes('poSummary');
    
    if (!isGoogle && !isBuySpeed) {
      el.runBtn.disabled = true;
      el.runBtn.title = 'Navigate to Google search or BuySpeed portal';
    } else {
      el.runBtn.disabled = false;
      el.runBtn.title = 'Run extraction';
    }
  } catch {}
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2000);
}
