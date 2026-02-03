# Privacy Policy for SerpScoop

**Last Updated:** January 7, 2026

## Overview

SerpScoop is a browser extension that extracts email addresses from search engine results pages. This privacy policy explains how we handle your data.

## Data Collection

### What We Collect
- **Email addresses**: Extracted from publicly visible web pages you visit
- **Domain information**: Source domains where emails were found
- **Usage statistics**: Page count and link count (stored locally only)

### What We Do NOT Collect
- Personal identification information
- Browsing history beyond active scraping sessions
- Passwords or authentication credentials
- Payment information
- Location data

## Data Storage

All data is stored **locally on your device** using Chrome's `chrome.storage.local` API. 

- No data is transmitted to external servers
- No data is shared with third parties
- No analytics or tracking services are used
- Data remains entirely under your control

## Data Usage

Collected email addresses are used solely for:
- Display within the extension popup
- Export to CSV files (user-initiated)
- Clipboard copying (user-initiated)

## Data Retention

- Data persists until you manually clear it using the "Clear" button
- Uninstalling the extension removes all stored data
- No backups are made to external services

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access current tab to extract visible content |
| `scripting` | Inject content script for email extraction |
| `storage` | Save extracted emails locally |
| `tabs` | Detect when you're on a search results page |
| `host_permissions` | Fetch external pages for deep email extraction |

## User Rights

You have the right to:
- View all stored data (visible in extension popup)
- Export your data (Download button)
- Delete all data (Clear button)
- Uninstall the extension at any time

## Children's Privacy

This extension is not intended for users under 13 years of age.

## Changes to This Policy

We may update this privacy policy. Changes will be reflected in the "Last Updated" date.

## Contact

For questions about this privacy policy, please open an issue on the extension's support page.

---

**Summary:** SerpScoop stores all data locally on your device. Nothing is sent to external servers. You control your data completely.
