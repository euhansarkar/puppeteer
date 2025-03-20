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
 * @returns {Promise<puppeteer.Browser>}
 */
async function launchBrowser() {
  return await puppeteer.launch({ headless: "new" });
}

/**
 * Scrapes category and subcategory data from DealNews.
 * @param {puppeteer.Page} page Puppeteer Page instance
 * @returns {Promise<Object[]>} Array of categories and subcategories
 */
async function scrapeCategories(page) {
  try {
    console.log("🌍 Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Extract category and subcategory details
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
              link: new URL(sub.href, window.location.origin).href, // Convert to absolute URL
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
 * Sanitizes folder names to remove invalid characters.
 * @param {string} name Folder name
 * @returns {string} Sanitized folder name
 */
function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

/**
 * Creates category and subcategory folders.
 * @param {Object[]} categories Category data
 */
async function createFolders(categories) {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    for (const category of categories) {
      const categoryPath = path.join(
        OUTPUT_DIR,
        sanitizeFolderName(category.name)
      );
      await fs.mkdir(categoryPath, { recursive: true });

      for (const sub of category.subcategories) {
        const subcategoryPath = path.join(
          categoryPath,
          sanitizeFolderName(sub.name)
        );
        await fs.mkdir(subcategoryPath, { recursive: true });
      }
    }
    console.log("✅ Folder structure created successfully.");
  } catch (error) {
    console.error("❌ Error creating folders:", error);
  }
}

/**
 * Visits subcategory pages and loads all deals by clicking the "Get the next 20 Deals" button.
 * @param {puppeteer.Page} page Puppeteer Page instance
 * @param {Object[]} categories Category data
 */
async function visitSubcategory(page, categories) {
  for (const category of categories) {
    for (const sub of category.subcategories) {
      try {
        console.log(`🔗 Visiting: ${sub.link}`);
        await page.goto(sub.link, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Keep clicking the "Get the next 20 Deals" button until it disappears
        while (true) {
          const buttonSelector =
            'a.btn-hero.btn-positive.btn-block.pager-more[rel="next"]';
          const buttonExists = await page.$(buttonSelector);

          if (!buttonExists) {
            console.log(
              `✅ No more "Get the next 20 Deals" button found for ${sub.link}`
            );
            break; // Exit loop if button is gone
          }

          console.log(`🖱️ Clicking "Get the next 20 Deals" button...`);
          await page.click(buttonSelector);
          await page.waitForTimeout(2000); // Wait for new items to load
        }

        // After the "Get the next 20 Deals" button disappears, visit product pages
        await visitProductPages(page, sub);
      } catch (error) {
        console.error(`❌ Failed to visit ${sub.link}:`, error.message);
      }
    }
  }
}

/**
 * Visits product pages by clicking "More Options" buttons and saves HTML.
 * @param {puppeteer.Page} page Puppeteer Page instance
 * @param {Object} sub Category subcategory data
 */
async function visitProductPages(page, sub) {
  const buttonSelector =
    "button.btn-stand-alone.action-menu.bottom-sheet-opener.bottom-sheet-hover-opener";
  const productLinks = [];

  // Collect all product page links from the "More Options" buttons
  const buttons = await page.$$(buttonSelector);
  for (const button of buttons) {
    const productUrl = await button.evaluate((el) =>
      el.getAttribute("data-offer-url")
    );
    if (productUrl) {
      productLinks.push(productUrl);
    }
  }

  // Visit each product link and save the HTML
  for (const productLink of productLinks) {
    try {
      console.log(`🔗 Visiting product page: ${productLink}`);
      await page.goto(productLink, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const html = await page.content();
      const productName = productLink.split("/")[3]; // Using the unique part of the URL as a name

      const productFolderPath = path.join(
        OUTPUT_DIR,
        sanitizeFolderName(sub.name),
        sanitizeFolderName(productName)
      );
      await fs.mkdir(productFolderPath, { recursive: true });

      const htmlFilePath = path.join(productFolderPath, "product.html");
      await fs.writeFile(htmlFilePath, html);
      console.log(`✅ Saved HTML for ${productLink}`);
    } catch (error) {
      console.error(
        `❌ Failed to visit product page ${productLink}:`,
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

  if (categories.length === 0) {
    console.error("❌ No categories found. Exiting...");
    await browser.close();
    return;
  }

  console.log("📂 Creating folder structure...");
  await createFolders(categories);

  console.log("🔍 Visiting subcategory pages...");
  await visitSubcategory(page, categories);

  await browser.close();
  console.log("✅ Scraping complete.");
}

// Run the script
main().catch(console.error);
