import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Get directory path for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const BASE_URL = "https://www.dealnews.com/categories/";
const OUTPUT_DIR = path.join(__dirname, "categories");

/**
 * Launch Puppeteer browser instance.
 */
async function launchBrowser() {
  return await puppeteer.launch({ headless: "new" });
}

/**
 * Scrapes category and subcategory data from DealNews.
 */
async function scrapeCategories(page) {
  try {
    console.log("🌍 Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });

    return await page.evaluate(() => {
      const categories = [];
      document
        .querySelectorAll(".categorylist .unit-wrapper")
        .forEach((categoryDiv) => {
          const categoryAnchor = categoryDiv.querySelector("h2 a");
          const categoryName = categoryAnchor?.textContent.trim() || "Unknown";
          const categoryLink = categoryAnchor
            ? new URL(categoryAnchor.href, window.location.origin).href
            : "";

          const subcategories = [];
          categoryDiv.querySelectorAll(".category a").forEach((sub) => {
            subcategories.push({
              name: sub.textContent.trim(),
              link: new URL(sub.href, window.location.origin).href,
            });
          });

          categories.push({
            name: categoryName,
            link: categoryLink,
            subcategories,
          });
        });

      return categories;
    });
  } catch (error) {
    console.error("❌ Error scraping categories:", error);
    return [];
  }
}

/**
 * Sanitizes folder/file names.
 */
function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

/**
 * Visits subcategory pages and extracts product links.
 */
async function visitCategorySubcategory(page, categories) {
  /**
   
   my categories data is like this
   [{
    "name": "Automotive",
    "link": "https://www.dealnews.com/c238/Automotive/",
    "subcategories": [
      {
        "name": "Automotive GPSs",
        "link": "https://www.dealnews.com/c357/Automotive/Automotive-GPSs/"
      }]
    }]
    
    now you have to go every category and sub category (when you go every category and sub category on the way you have create category and sub category nested folder) link then if you not found any "Get the next {{number}} Deals" button with style : 'a.btn-hero.btn-positive.btn-block.pager-more[rel="next"]'; then click every products url and goto in the product page and take whole html data  and save the file (save file in the specific category folder if the file founds from the category link or save file in sub category folder  if file founds in the specific sub category folder)

    if you found any "Get the next {{number}} Deals" button with style : 'a.btn-hero.btn-positive.btn-block.pager-more[rel="next"]'; then click the button until it's disappeared. after disappearing the button click every products url and goto in the product page and take whole html data  and save the file (save file in the specific category folder if the file founds from the category link or save file in sub category folder  if file founds in the specific sub category folder)

*** button click er jonno ekta function
*** page er data collect korar jonno ekta function
*** new page theke html newar jonno ekta function 
   
   * 
   * 
   */

  for (const category of categories) {
    for (const sub of category.subcategories) {
      try {
        console.log(`🔗 Visiting: ${sub.link}`);
        await page.goto(sub.link, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Keep clicking the "Get the next 20 Deals" button
        while (true) {
          const buttonSelector =
            'a.btn-hero.btn-positive.btn-block.pager-more[rel="next"]';
          const buttonExists = await page.$(buttonSelector);

          if (!buttonExists) {
            console.log(`✅ No more "Get the next 20 Deals" button found.`);
            break;
          }

          console.log(`🖱️ Clicking "Get the next 20 Deals" button...`);
          await page.click(buttonSelector);
          await page.waitForTimeout(2000); // Manual delay
        }

        await visitProductPages(page, sub);
      } catch (error) {
        console.error(`❌ Failed to visit ${sub.link}:`, error.message);
      }
    }
  }
}

/**
 * Visits product pages, extracts product names, and saves HTML.
 */
async function visitProductPages(page, sub) {
  console.log(`🔍 Extracting product links for: ${sub.name}`);

  const buttonSelector =
    "button.btn-stand-alone.action-menu.bottom-sheet-opener.bottom-sheet-hover-opener";

  const productLinks = [];
  const productNames = [];

  // Collect product page links and names
  const buttons = await page.$$(buttonSelector);
  for (const button of buttons) {
    const productUrl = await button.evaluate((el) =>
      el.getAttribute("data-offer-url")
    );
    const productName = await button.evaluate((el) =>
      el.getAttribute("aria-label")
    );

    if (productUrl && productName) {
      productLinks.push(productUrl);
      productNames.push(sanitizeFolderName(productName));
    }
  }

  console.log(`📦 Found ${productLinks.length} products in ${sub.name}`);

  // Visit each product page and save HTML
  for (let i = 0; i < productLinks.length; i++) {
    try {
      const productLink = productLinks[i];
      const productName = productNames[i];

      console.log(`🔗 Visiting product page: ${productLink}`);

      await page.goto(productLink, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const html = await page.content();
      const subcategoryPath = path.join(
        OUTPUT_DIR,
        sanitizeFolderName(sub.name)
      );

      // Save as "<Product-Name>.html"
      const htmlFilePath = path.join(subcategoryPath, `${productName}.html`);
      await fs.writeFile(htmlFilePath, html);

      console.log(`✅ Saved HTML as: ${htmlFilePath}`);

      await page.waitForTimeout(1500); // Manual delay to avoid blocking
    } catch (error) {
      console.error(
        `❌ Failed to visit product page: ${productLinks[i]}`,
        error.message
      );
    }
  }
}

/**
 * Main function to execute the scraper.
 */
async function main() {
  console.log("🚀 Launching Puppeteer...");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Set a user-agent to bypass bot detection
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );

  console.log("📡 Scraping categories...");
  const categories = await scrapeCategories(page);

  fs.writeFile(`category.json`, JSON.stringify(categories), (err) => {
    if (err) {
      console.log(`see error`, err?.message);
    }
  });

  if (categories.length === 0) {
    console.error("❌ No categories found. Exiting...");
    await browser.close();
    return;
  }

  console.log("🔍 Visiting subcategory pages...");
  await visitCategorySubcategory(page, categories);

  await browser.close();
  console.log("✅ Scraping complete.");
}

// Run the script
main().catch(console.error);
