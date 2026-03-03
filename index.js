import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Streaming Endpoint
app.get('/api/scrape', async (req, res) => {
  const query = req.query.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`Starting/Streaming scrape for: ${query}`);
  
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    // Set viewport to a typical desktop size
    await page.setViewport({ width: 1366, height: 768 });

    // Step 1: Navigate
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(String(query))}`, {
      waitUntil: 'domcontentloaded'
    });

    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
    } catch (e) {
      console.log("Feed not found immediately. Might be single result or slow load.");
    }

    const scrollContainer = 'div[role="feed"]';
    let previousHeight = 0;
    let sameHeightCount = 0;
    const seenIds = new Set(); // Track unique items to avoid sending duplicates

    // SCROLL & SCRAPE LOOP
    // We try to scroll heavily to ensure data keeps coming
    for (let i = 0; i < 500; i++) { // Max iterations to prevent infinite loop if something breaks
      
      // 1. Scrape visible items CURRENTLY on the page
      const newItems = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div[role="article"]'));
        
        return items.map(item => {
          const text = item.innerText;
          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          
          // Heuristics
          const name = item.getAttribute('aria-label') || lines[0] || 'Unknown';
          
          // Rating: Look for "4.5 (123)"
          let rating = 'N/A';
          let reviews = '0';
          // Find line that STARTS with digit.digit or contains stars logic
          // A safer regex for ratings in Maps:
          const ratingLine = lines.find(l => /^(\d\.\d)(\s)*\(/.test(l));
          if (ratingLine) {
            const parts = ratingLine.split('(');
            rating = parts[0].trim();
            reviews = parts[1] ? parts[1].replace(')', '').trim() : '0';
            reviews = reviews.replace(/\,/g, ''); // Remove commas
          }

          // Category: Usually directly after rating or near top
          // We'll exclude lines that look like address or status
          const category = lines.find(l => 
             l !== name && 
             l !== ratingLine && 
             !l.match(/Open|Closed|Opens|Closes/) && 
             !l.match(/\d+/) && // Avoid address lines starting with numbers
             !l.startsWith('(')
          ) || lines[1] || 'N/A';

          // Status
          const status = lines.find(l => /Open|Closed|Opens|Closes/.test(l)) || 'Unknown';

          // Address: Look for standard address indicators
          const address = lines.find(l => 
            (l.includes(',') || l.match(/\d+\s[A-Za-z]+/) || l.match(/St|Rd|Ave|Blvd|Lane/)) && 
            l !== name && 
            l !== category && 
            l !== status
          ) || 'N/A';

          // Website: Look for anchor with href not google maps
          const links = Array.from(item.querySelectorAll('a'));
          let website = 'N/A';
          // The main link to the place usually starts with /maps/place
          const mainLink = links.find(l => l.href.includes('/maps/place/'));
          const mainUrl = mainLink ? mainLink.href : '';

          for (const link of links) {
             const href = link.href;
             // Check if it is a real external link
             if (href && !href.includes('google.com/maps') && !href.includes('google.com/search')) {
                 website = href;
                 break; // Take first external link
             }
          }

          // Phone: Regex search in text
          // Pattern: (555) 123-4567 or +1 555-123-4567 etc
          const phoneMatch = text.match(/((\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
          const phone = phoneMatch ? phoneMatch[0] : 'N/A';

          // BETTER ID GENERATION
          // Use the Google Maps URL which is unique per location (contains coords/CID)
          // If not available, fall back to strictly Name + Address + Phone
          let id = '';
          if (mainUrl) {
             id = mainUrl.split('!')[0]; // Use the base part of the URL or the whole thing
          } else {
             id = name + '|' + address;
          }

          return {
            id,
            name,
            address,
            rating,
            reviews,
            type: category,
            status,
            website,
            phoneNumber: phone,
            source: 'Google Maps'
          };
        });
      });

      // 2. Process and Stream new items
      for (const item of newItems) {
        // If we have a valid name and haven't seen this ID
        // Note: Sometimes the mainUrl might briefly be missing if DOM is updating, so we skip 'Unknown' names
        if (item.name !== 'Unknown' && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          // Stream the data chunk
          res.write(`data: ${JSON.stringify(item)}\n\n`);
        }
      }

      // 3. Scroll Down
      const result = await page.evaluate(async (selector) => {
        const el = document.querySelector(selector);
        if (!el) return { endReached: true, h: 0 };
        
        el.scrollTop = el.scrollHeight;
        
        return { 
          h: el.scrollHeight,
          endReached: document.body.innerText.includes("You've reached the end of the list")
        };
      }, scrollContainer);

      if (result.endReached) {
        console.log('End of list reached.');
        break;
      }

      // 4. Wait for network/content
      await new Promise(r => setTimeout(r, 1500)); // 1.5s pause

      // Check if stuck
      if (result.h === previousHeight) {
        sameHeightCount++;
        // If stuck for 15 seconds, exit
        if (sameHeightCount > 10) break;
      } else {
        sameHeightCount = 0;
      }
      previousHeight = result.h;

      // Keep socket alive hint (comment used as keep-alive)
      res.write(': keep-alive\n\n');
    }

    console.log(`Scrape finished. Total unique found: ${seenIds.size}`);
    res.write('event: done\ndata: {}\n\n'); // Signal end
    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({error: error.message})}\n\n`);
    res.end();
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Streaming Server running on http://localhost:${PORT}`);
});
