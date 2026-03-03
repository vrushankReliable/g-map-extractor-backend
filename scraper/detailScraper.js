/**
 * Detail Page Scraper
 * 
 * Extracts detailed information from individual Google Maps place pages
 * including phone numbers, websites, hours, and more.
 */

import { sleep, randomSleep } from '../utils/helpers.js';

/**
 * Extract detailed information from a place's detail panel
 * @param {Page} page - Puppeteer page instance
 * @param {string} profileUrl - URL of the place
 * @returns {Promise<object>} - Detailed place information
 */
export async function extractPlaceDetails(page, profileUrl) {
    const details = {
        phoneNumber: 'N/A',
        phoneNumbers: [],
        website: 'N/A',
        address: 'N/A',
        fullAddress: '',
        plusCode: '',
        hours: null,
        priceLevel: '',
        attributes: [],
        images: [],
    };

    try {
        // Navigate to the place detail page if URL provided
        if (profileUrl && profileUrl.includes('/maps/place/')) {
            await page.goto(profileUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            await randomSleep(1500, 2500);
        }

        // Wait for the detail panel to load
        await page.waitForSelector('[role="main"]', { timeout: 10000 }).catch(() => { });

        // Extract all details from the page
        const extractedData = await page.evaluate(() => {
            const result = {
                phoneNumbers: [],
                website: null,
                address: null,
                hours: null,
                priceLevel: null,
                attributes: [],
            };

            // Helper to get text content safely
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.textContent.trim() : null;
            };

            // Get all action buttons/links in the info section
            const infoButtons = document.querySelectorAll('button[data-item-id], a[data-item-id]');

            infoButtons.forEach(button => {
                const itemId = button.getAttribute('data-item-id');
                const ariaLabel = button.getAttribute('aria-label') || '';
                const text = button.textContent || '';

                // Phone numbers - check multiple patterns
                if (itemId?.startsWith('phone:') ||
                    ariaLabel.toLowerCase().includes('phone') ||
                    ariaLabel.toLowerCase().includes('call')) {

                    // Extract phone from aria-label or text
                    const phoneMatch = ariaLabel.match(/[\d\s\-\+\(\)]{10,}/);
                    if (phoneMatch) {
                        result.phoneNumbers.push(phoneMatch[0].trim());
                    } else {
                        // Try to find phone in the button text
                        const textPhone = text.match(/[\d\s\-\+\(\)]{10,}/);
                        if (textPhone) {
                            result.phoneNumbers.push(textPhone[0].trim());
                        }
                    }
                }

                // Website
                if (itemId?.startsWith('authority') ||
                    ariaLabel.toLowerCase().includes('website') ||
                    button.href?.match(/^https?:\/\/(?!.*google)/)) {

                    if (button.href && !button.href.includes('google.com')) {
                        result.website = button.href;
                    }
                }

                // Address
                if (itemId?.startsWith('address') ||
                    ariaLabel.toLowerCase().includes('address')) {
                    result.address = ariaLabel.replace(/^Address:\s*/i, '').trim();
                }
            });

            // Alternative: Look for phone in the info section text
            const infoSection = document.querySelector('.m6QErb.WNBkOb, div[role="region"]');
            if (infoSection && result.phoneNumbers.length === 0) {
                const text = infoSection.innerText;

                // Indian phone patterns
                const phonePatterns = [
                    /\+91[\s\-]?\d{5}[\s\-]?\d{5}/g,           // +91 XXXXX XXXXX
                    /\+91[\s\-]?\d{10}/g,                       // +91XXXXXXXXXX
                    /0\d{2,4}[\s\-]?\d{6,8}/g,                  // Landline with STD
                    /\d{5}[\s\-]?\d{5}/g,                       // 10 digit mobile
                    /\(\d{2,4}\)[\s\-]?\d{6,8}/g,              // (STD) XXXXXX
                ];

                for (const pattern of phonePatterns) {
                    const matches = text.match(pattern);
                    if (matches) {
                        matches.forEach(m => {
                            const cleaned = m.replace(/[\s\-]/g, '');
                            if (cleaned.length >= 10 && !result.phoneNumbers.includes(cleaned)) {
                                result.phoneNumbers.push(cleaned);
                            }
                        });
                    }
                }
            }

            // Look for phone in specific elements
            const phoneElements = document.querySelectorAll('[data-tooltip*="phone"], [aria-label*="phone"], a[href^="tel:"]');
            phoneElements.forEach(el => {
                if (el.href && el.href.startsWith('tel:')) {
                    const phone = el.href.replace('tel:', '');
                    if (!result.phoneNumbers.includes(phone)) {
                        result.phoneNumbers.push(phone);
                    }
                }
            });

            // Price level
            const priceEl = document.querySelector('[aria-label*="Price"], span.mgr77e');
            if (priceEl) {
                const priceMatch = priceEl.textContent.match(/[₹$€£]+/);
                result.priceLevel = priceMatch ? priceMatch[0] : '';
            }

            // Hours
            const hoursButton = document.querySelector('button[data-item-id*="oh"], [aria-label*="hours"]');
            if (hoursButton) {
                result.hours = hoursButton.getAttribute('aria-label') || hoursButton.textContent;
            }

            // Collect all visible text for additional phone extraction
            const allText = document.body.innerText;

            // Find Indian mobile numbers (10 digits starting with 6-9)
            const mobilePattern = /(?<!\d)([6-9]\d{9})(?!\d)/g;
            const mobileMatches = allText.match(mobilePattern);
            if (mobileMatches) {
                mobileMatches.forEach(m => {
                    if (!result.phoneNumbers.includes(m) && !result.phoneNumbers.includes('+91' + m)) {
                        result.phoneNumbers.push(m);
                    }
                });
            }

            return result;
        });

        // Merge extracted data
        if (extractedData.phoneNumbers.length > 0) {
            details.phoneNumber = extractedData.phoneNumbers[0];
            details.phoneNumbers = extractedData.phoneNumbers;
        }
        if (extractedData.website) {
            details.website = extractedData.website;
        }
        if (extractedData.address) {
            details.address = extractedData.address;
            details.fullAddress = extractedData.address;
        }
        if (extractedData.hours) {
            details.hours = extractedData.hours;
        }
        if (extractedData.priceLevel) {
            details.priceLevel = extractedData.priceLevel;
        }

    } catch (error) {
        console.error('Error extracting place details:', error.message);
    }

    return details;
}

/**
 * Click on a listing in the feed and extract details
 * @param {Page} page - Puppeteer page instance
 * @param {Element} article - The article element to click
 * @param {number} index - Index of the listing
 * @returns {Promise<object|null>} - Extracted details or null
 */
export async function clickAndExtractDetails(page, articleSelector, index) {
    try {
        // Click on the listing
        const articles = await page.$$(articleSelector);
        if (index >= articles.length) return null;

        const article = articles[index];
        await article.click();

        // Wait for detail panel to load
        await randomSleep(1500, 2500);

        // Wait for phone button or address to appear
        await page.waitForSelector(
            'button[data-item-id^="phone:"], a[href^="tel:"], [aria-label*="Phone"]',
            { timeout: 5000 }
        ).catch(() => { });

        // Extract details
        const details = await extractPlaceDetails(page);

        // Go back to list
        await page.keyboard.press('Escape');
        await sleep(500);

        return details;

    } catch (error) {
        console.error(`Error extracting details for listing ${index}:`, error.message);
        return null;
    }
}

/**
 * Batch extract details for multiple listings
 * @param {Page} page - Puppeteer page instance  
 * @param {array} listings - Array of listings to enrich
 * @param {object} options - Options for extraction
 * @returns {Promise<array>} - Enriched listings
 */
export async function batchExtractDetails(page, listings, options = {}) {
    const {
        maxConcurrent = 1,
        delayBetween = 2000,
        onlyMissingPhone = true,
        onProgress = () => { },
    } = options;

    const enrichedListings = [];
    let processed = 0;

    for (const listing of listings) {
        // Skip if phone already exists and onlyMissingPhone is true
        if (onlyMissingPhone && listing.phoneNumber && listing.phoneNumber !== 'N/A') {
            enrichedListings.push(listing);
            continue;
        }

        // Navigate to detail page if we have a profile URL
        if (listing.profileUrl && listing.profileUrl !== 'N/A') {
            try {
                const details = await extractPlaceDetails(page, listing.profileUrl);

                // Merge details into listing
                enrichedListings.push({
                    ...listing,
                    phoneNumber: details.phoneNumber !== 'N/A' ? details.phoneNumber : listing.phoneNumber,
                    phoneNumbers: details.phoneNumbers,
                    website: details.website !== 'N/A' ? details.website : listing.website,
                    address: details.address !== 'N/A' ? details.address : listing.address,
                    fullAddress: details.fullAddress,
                    hours: details.hours,
                    priceLevel: details.priceLevel,
                    detailsScraped: true,
                });

                processed++;
                onProgress({ processed, total: listings.length, current: listing.name });

                // Delay between requests to avoid rate limiting
                await randomSleep(delayBetween, delayBetween * 1.5);

            } catch (error) {
                console.error(`Failed to extract details for ${listing.name}:`, error.message);
                enrichedListings.push(listing);
            }
        } else {
            enrichedListings.push(listing);
        }
    }

    return enrichedListings;
}

export default {
    extractPlaceDetails,
    clickAndExtractDetails,
    batchExtractDetails,
};
