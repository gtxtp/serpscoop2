/**
 * SerpScoop Level 2 - BuySpeed Contract Portal Content Script
 * Detects and extracts contract data from BuySpeed procurement portals
 */

// ============================================================================
// CONFIGURATION
// ============================================================================
const BUYSPEED_CONFIG = {
  // Contract link patterns
  CONTRACT_LINK_PATTERNS: [
    'a[href*="/bso/external/purchaseorder/poSummary"]',
    'a[href*="poSummary.sdo"]'
  ],
  // Table selectors
  TABLE_SELECTORS: [
    '.ui-widget-content a[href*="poSummary"]',
    'table a[href*="/bso/external/"]'
  ],
  // Pagination selectors
  NEXT_BUTTON_SELECTORS: [
    'a[aria-label="Next page"]',
    '.ui-paginator-next:not(.ui-state-disabled)',
    'a:contains("›")',
    'a.ui-paginator-next'
  ]
};

// ============================================================================
// DETECTION
// ============================================================================
function isBuySpeedListingPage() {
  // Check for BuySpeed portal indicators
  const hasContractLinks = document.querySelector(
    BUYSPEED_CONFIG.CONTRACT_LINK_PATTERNS.join(',')
  );
  const hasUIWidget = document.querySelector('.ui-widget-content, .ui-datatable');
  const hasBSOPath = window.location.pathname.includes('/bso/') || 
                     window.location.pathname.includes('/external/');
  
  return !!(hasContractLinks || (hasUIWidget && hasBSOPath));
}

function isBuySpeedDetailPage() {
  // Check for contract detail page indicators
  return window.location.href.includes('poSummary.sdo') ||
         (window.location.href.includes('/bso/external/') && 
          document.querySelector('table.table-01, td.tableText-01'));
}

// ============================================================================
// CONTRACT LINK EXTRACTION
// ============================================================================
function extractContractLinks() {
  const links = [];
  const seen = new Set();
  
  // Try each selector pattern
  const allSelectors = [
    ...BUYSPEED_CONFIG.CONTRACT_LINK_PATTERNS,
    ...BUYSPEED_CONFIG.TABLE_SELECTORS
  ];
  
  for (const selector of allSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      try {
        const href = el.href;
        if (!href || seen.has(href)) continue;
        
        // Validate it's a contract detail URL
        if (href.includes('poSummary') || href.includes('/bso/external/')) {
          seen.add(href);
          links.push({
            url: href,
            text: el.textContent?.trim() || '',
            poNumber: extractPONumberFromLink(el)
          });
        }
      } catch (e) {
        console.error('[BuySpeed] Error extracting link:', e);
      }
    }
  }
  
  console.log(`[BuySpeed] Found ${links.length} contract links`);
  return links;
}

function extractPONumberFromLink(el) {
  // Try to get PO number from link text or nearby cells
  const text = el.textContent?.trim();
  if (text && text.match(/PO-|^\d+/)) return text;
  
  // Check parent td for PO number
  const td = el.closest('td');
  if (td) {
    const tdText = td.textContent?.trim();
    if (tdText) return tdText;
  }
  
  return '';
}

// ============================================================================
// CONTRACT DETAIL EXTRACTION
// ============================================================================
function extractContractDetails() {
  const contract = {
    poNumber: '',
    description: '',
    purchaserName: '',
    vendorName: '',
    vendorContactName: '',
    vendorEmail: '',
    vendorPhone: '',
    vendorAddress: '',
    contractValue: ''
  };
  
  try {
    // Extract from table cells with class tableText-01
    const cells = document.querySelectorAll('td.tableText-01, td[class*="tableText"]');
    const allText = document.body.innerText;
    
    // Find PO Number
    contract.poNumber = extractFieldByLabel('Purchase Order Number:', cells) ||
                       extractFieldByLabel('PO Number:', cells) ||
                       extractFromText(allText, /PO[-\s]?([A-Z0-9\-]+)/i);
    
    // Find Description
    contract.description = extractFieldByLabel('Short Description:', cells) ||
                          extractFieldByLabel('Description:', cells);
    
    // Find Purchaser Name
    contract.purchaserName = extractFieldByLabel('Purchaser:', cells);
    
    // Extract Vendor Information
    extractVendorInfo(contract);
    
    // Find Contract Value
    contract.contractValue = extractFieldByLabel('Total PO Amount:', cells) ||
                            extractFieldByLabel('Contract Value:', cells) ||
                            extractFieldByLabel('Amount:', cells) ||
                            extractFromText(allText, /\$[\d,]+\.?\d*/);
    
    console.log('[BuySpeed] Extracted contract:', contract);
  } catch (e) {
    console.error('[BuySpeed] Error extracting contract details:', e);
  }
  
  return contract;
}

function extractFieldByLabel(label, cells) {
  // Find a cell with the label and return the adjacent cell value
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const text = cell.textContent?.trim();
    
    if (text === label || text?.includes(label)) {
      // Try next cell (sibling)
      const nextCell = cells[i + 1];
      if (nextCell) {
        const value = nextCell.textContent?.trim();
        if (value && value !== label) return value;
      }
      
      // Try same row, next td
      const row = cell.parentElement;
      if (row) {
        const allRowCells = row.querySelectorAll('td');
        for (let j = 0; j < allRowCells.length - 1; j++) {
          if (allRowCells[j] === cell) {
            const value = allRowCells[j + 1]?.textContent?.trim();
            if (value) return value;
          }
        }
      }
    }
  }
  
  return '';
}

function extractVendorInfo(contract) {
  // Look for vendor section heading
  const headings = document.querySelectorAll('h2, h3, .sectionHeader, td.sectionHeader, th');
  let vendorSection = null;
  
  for (const heading of headings) {
    const text = heading.textContent?.trim().toLowerCase();
    if (text?.includes('vendor') || text?.includes('supplier')) {
      vendorSection = heading;
      break;
    }
  }
  
  if (!vendorSection) {
    // Fallback: search entire document
    vendorSection = document.body;
  }
  
  // Get parent container
  const container = vendorSection.closest('table') || 
                    vendorSection.closest('div') || 
                    vendorSection.parentElement ||
                    document.body;
  
  const cells = container.querySelectorAll('td.tableText-01, td[class*="tableText"]');
  const text = container.innerText || document.body.innerText;
  
  // Extract vendor name (often with ID like "V00000084 - RSM US LLP")
  const vendorNameField = extractFieldByLabel('Company Name:', cells) ||
                          extractFieldByLabel('Vendor Name:', cells) ||
                          extractFieldByLabel('Vendor:', cells);
  
  if (vendorNameField) {
    // Parse "V00000084 - RSM US LLP" format
    const match = vendorNameField.match(/(?:V\d+\s*-\s*)?(.+)/);
    contract.vendorName = match ? match[1].trim() : vendorNameField;
  }
  
  // Extract contact name
  contract.vendorContactName = extractFieldByLabel('Contact Name:', cells) ||
                               extractFieldByLabel('Contact:', cells) ||
                               extractFieldByLabel('Name:', cells);
  
  // Extract email
  contract.vendorEmail = extractEmailFromText(text);
  
  // Extract phone
  contract.vendorPhone = extractPhoneFromText(text);
  
  // Extract address
  contract.vendorAddress = extractFieldByLabel('Address:', cells) ||
                           extractFieldByLabel('Street Address:', cells);
  
  // If address is multi-line, try to get full address
  if (!contract.vendorAddress) {
    const addressMatch = text.match(/(\d+\s+[A-Za-z0-9\s,\.]+(?:Street|St|Avenue|Ave|Road|Rd|Floor|Suite)[^,]*,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
    if (addressMatch) {
      contract.vendorAddress = addressMatch[1].trim();
    }
  }
}

function extractEmailFromText(text) {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const matches = text.match(emailRegex);
  if (matches && matches.length > 0) {
    // Filter out common false positives
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
  // Match various phone formats: (123) 456-7890, 123-456-7890, 123.456.7890
  const phoneRegex = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
  const matches = text.match(phoneRegex);
  return matches ? matches[0] : '';
}

function extractFromText(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] || match[0] : '';
}

// ============================================================================
// PAGINATION
// ============================================================================
function findNextButton() {
  // Try each selector
  for (const selector of BUYSPEED_CONFIG.NEXT_BUTTON_SELECTORS) {
    try {
      const btn = document.querySelector(selector);
      if (btn && !btn.classList.contains('ui-state-disabled')) {
        return btn;
      }
    } catch (e) {
      // Selector might have pseudo-class not supported, continue
    }
  }
  
  // Fallback: look for links with next/› text
  const links = document.querySelectorAll('a');
  for (const link of links) {
    const text = link.textContent?.trim();
    const ariaLabel = link.getAttribute('aria-label')?.toLowerCase();
    if (text === '›' || text === 'Next' || ariaLabel?.includes('next')) {
      if (!link.classList.contains('ui-state-disabled')) {
        return link;
      }
    }
  }
  
  return null;
}

function clickNextPage() {
  const nextBtn = findNextButton();
  if (nextBtn) {
    console.log('[BuySpeed] Clicking next page button');
    nextBtn.click();
    return true;
  }
  console.log('[BuySpeed] No next page button found');
  return false;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================
let isExtracting = false;

async function runBuySpeedExtraction() {
  if (isExtracting) {
    return { success: false, message: 'Already running' };
  }
  
  isExtracting = true;
  
  try {
    if (isBuySpeedDetailPage()) {
      // Extract from detail page
      const contract = extractContractDetails();
      return {
        success: true,
        type: 'detail',
        contract
      };
    } else if (isBuySpeedListingPage()) {
      // Extract from listing page
      const links = extractContractLinks();
      
      // Send links to background for processing
      if (links.length > 0) {
        await chrome.runtime.sendMessage({
          type: 'QUEUE_CONTRACT_LINKS',
          links: links
        });
      }
      
      // Auto-advance to next page
      const hasNext = clickNextPage();
      
      return {
        success: true,
        type: 'listing',
        linksFound: links.length,
        hasNext
      };
    } else {
      return {
        success: false,
        message: 'Not a recognized BuySpeed page'
      };
    }
  } catch (e) {
    console.error('[BuySpeed] Extraction error:', e);
    return {
      success: false,
      message: e.message
    };
  } finally {
    isExtracting = false;
  }
}

// ============================================================================
// PAGE DETECTION FOR UI
// ============================================================================
function checkPageType() {
  if (isBuySpeedDetailPage()) {
    return { type: 'buyspeed-detail', canRun: true };
  } else if (isBuySpeedListingPage()) {
    return { type: 'buyspeed-listing', canRun: true };
  } else {
    return { type: 'unknown', canRun: false };
  }
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_EXTRACTION') {
    runBuySpeedExtraction().then(sendResponse);
    return true;
  }
  
  if (request.type === 'CHECK_PAGE_TYPE') {
    sendResponse(checkPageType());
    return false;
  }
  
  if (request.type === 'GET_STATUS') {
    sendResponse({ 
      isRunning: isExtracting,
      pageType: checkPageType()
    });
    return false;
  }
});

console.log('[BuySpeed] Content script loaded');
