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
    await safeGoto(page, BASE_URL);

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
async function visitCategorySubcategory(pagei, categories) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);
  for (const category of categories) {
    for (const sub of category.subcategories) {
      try {
        console.log(`see link`, sub?.link);

        const contentPage = await page.goto(sub.link);

        const content = await contentPage.content();

        fs.writeFile(`content.html`, content, (error) => {
          if (error) {
            console.error(`Failed to write content.html`, error?.message);
          }
        });

        // const success = await safeGoto(page, sub.link);

        // if (!success) {
        //   console.log(`skipping page due to error: ${sub.link}`);
        // }

        // const buttonSelector =
        //   'a.btn-hero.btn-positive.btn-block.pager-more[rel="next"]';
        // const buttonExists = await page.$(buttonSelector);

        // while (buttonExists) {
        //   await page.click(buttonSelector);
        // }

        // const articles = await page.evaluate(() => {
        //   return Array.from(document.querySelectorAll("div")).map((article) => {
        //     const shopElement = article.querySelector("a.title-link");
        //     const productElement = article.querySelector("a.title-link");

        //     // Extract button data-offer-url
        //     const linkElement = article.querySelector(
        //       "button.btn-stand-alone.action-menu.bottom-sheet-opener.bottom-sheet-hover-opener"
        //     );

        //     return {
        //       shop: shopElement ? shopElement.innerText.trim() : "No Title",
        //       productLink: productElement
        //         ? productElement.getAttribute("href")
        //         : "No Product Link",
        //       offerLink: linkElement
        //         ? linkElement.getAttribute("data-offer-url")
        //         : "No Offer Link",
        //     };
        //   });
        // });

        //  const buttonSelectorNew =
        //    "button.btn-stand-alone.action-menu.bottom-sheet-opener.bottom-sheet-hover-opener";

        //  const productLinks = [];
        //  const productNames = [];

        //  // Collect product page links and names
        //  const buttons = await page.$$(buttonSelectorNew);
        //  for (const button of buttons) {
        //    const productUrl = await button.evaluate((el) =>
        //      el.getAttribute("data-offer-url")
        //    );
        //    const productName = await button.evaluate((el) =>
        //      el.getAttribute("aria-label")
        //    );

        //    if (productUrl && productName) {
        //      productLinks.push(productUrl);
        //      productNames.push(sanitizeFolderName(productName));
        //    }
        //  }

        // console.log(`see product links`, articles);

        // await visitProductPages(page, sub);
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
    } catch (error) {
      console.error(
        `❌ Failed to visit product page: ${productLinks[i]}`,
        error.message
      );
    }
  }
}

async function safeGoto(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      return true;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed for ${url}:`, error);
      if (attempt === retries) return false;
      await new Promise((r) => setTimeout(r, 5000)); // Wait before retrying
    }
  }
}

async function main() {
  console.log("🚀 Launching Puppeteer...");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Set a user-agent to bypass bot detection
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );

  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

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
