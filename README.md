# SerpScoop Level 2 - Setup Instructions

## Installation

1. Load the extension in Chrome:
   - Navigate to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `serpscoop2` directory

## Excel Export Setup (Optional)

The Excel export feature requires the SheetJS library. To enable it:

1. Download `xlsx.mini.min.js` from one of these sources:
   - https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.mini.min.js
   - https://unpkg.com/xlsx@0.18.5/dist/xlsx.mini.min.js

2. Place the file in the root directory of this extension

3. The Excel export button will then work properly

Alternatively, use JSON or CSV export formats which are fully functional without additional libraries.

## Usage

### For Email Extraction (Google SERPs)
1. Navigate to a Google search results page
2. Click the extension icon
3. Click "Run" to extract emails
4. Use filter to search results
5. Export as JSON, CSV, or copy to clipboard

### For Contract Extraction (BuySpeed Portals)
1. Navigate to a BuySpeed procurement portal listing page
2. Click the extension icon
3. Click "Run" to extract contracts
4. Extension will:
   - Collect all contract links from current page
   - Auto-advance to next page
   - Process contracts in background with stealth timing (3-8 second delays)
5. View extracted contracts in the popup
6. Export as JSON, CSV, or Excel (if library is installed)

## Features

- **Dual Mode**: Automatically detects Google SERPs vs BuySpeed portals
- **Stealth Operation**: Gaussian-distributed delays (3-8s) to avoid detection
- **Session Preservation**: Maintains login cookies during scraping
- **Multiple Export Formats**: JSON, Excel (optional), CSV
- **Smart Filtering**: Search across all contract fields
- **Real-time Progress**: Live updates as contracts are processed
- **Auto-pagination**: Automatically advances to next page after extraction

## Data Fields

### Email Mode
- Email address
- Domain
- Source (SERP or background)
- Method (direct or background)
- Found at timestamp

### Contract Mode
- PO Number
- Description
- Purchaser Name
- Vendor Name
- Vendor Contact Name
- Vendor Email
- Vendor Phone
- Vendor Address
- Contract Value
- Found at timestamp

## Security

- No data is sent to external servers
- All processing happens locally in your browser
- Stealth features help avoid rate limiting and detection
- Session credentials are preserved for authenticated portals
