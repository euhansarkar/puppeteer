import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
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
 * Clicks "Load More" button until it's gone.
 */
async function clickUntilGone(page) {
  const MAX_ATTEMPTS = 50;
  let clicked = 0;

  while (clicked < MAX_ATTEMPTS) {
    const button = await page.$(".btn-hero.btn-positive.btn-block.pager-more");
    if (!button) break;

    const isVisible = (await button.boundingBox()) !== null;
    if (!isVisible) break;

    console.log(`Clicking button (attempt ${clicked + 1})`);
    await Promise.all([button.click(), page.waitForTimeout(2000)]);
    clicked++;
  }
  console.log(`Total clicks: ${clicked}`);
}

/**
 * Visits subcategory pages and extracts product links.
 */
async function visitCategorySubcategory(page, categories) {
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  for (const category of categories) {
    const categoryData = [];

    for (const sub of category.subcategories) {
      try {
        await safeGoto(page, sub.link);

        // const content = await page.content();
        //  await fs.writeFile(`content.html`, content);
        let pageNumber = 1;

        while (true) {
          const url = `${sub?.link}?start=${pageNumber}`;

          const success = await safeGoto(page, url);
          if (!success) break;

          const articles = await page.evaluate(() => {
            return Array.from(
              document.querySelectorAll("div.content-card-initial")
            ).map((article) => {
              const shopElement = article.querySelector(
                "div.title.limit-height.limit-height-large-2.limit-height-small-2"
              );
              const productElement = article.querySelector("a.title-link");
              const buttonElement = document.querySelector(
                'button[data-bottom-sheet-id="overflow-menu-content-card"]'
              );

              // return {
              //   shop: shopElement
              //     ? shopElement.getAttribute("title")
              //     : "No Title",
              //   productLink: productElement
              //     ? productElement.getAttribute("href")
              //     : "No Product Link",
              //   offerLink: buttonElement
              //     ? buttonElement.getAttribute("data-offer-url")
              //     : "No Offer Link",
              // };

              return visitProductPage(
                page,
                buttonElement?.getAttribute("data-offer-url")
              );
            });
          });

          if (articles?.length > 0) {
            categoryData?.push(articles);
          }

          // console.log(`🛒 Found products in ${sub?.link}:`, articles);

          pageNumber += 20;
        }

        // await visitProductPages(page, sub);
      } catch (error) {
        console.error(`❌ Failed to visit ${sub.link}:`, error.message);
      }
    }

    // await fs.mkdir(path.join(OUTPUT_DIR, sanitizeFolderName(category.name)), {
    //   recursive: true,
    // });
    // await fs.writeFile(
    //   path.join(
    //     OUTPUT_DIR,
    //     sanitizeFolderName(category.name),
    //     `${category?.name}.json`
    //   )
    // );

    console.log(`${category?.name} data`, categoryData);
  }
}

/**
 * Visits product pages, extracts product names, and saves HTML.
 */
async function visitProductPage(page, link) {
  await safeGoto(page, link);

  const data = await page.evaluate(() => {
    return {
      name:
        document.querySelector("h1.product-title")?.textContent.trim() ||
        "No Product Name",
      description: document
        .querySelector("a.title-link")
        ?.getAttribute("aria-label")
        ?.textContent.trim()
        .replace(/\n/g, ""),
      price:
        document.querySelector("div.callout")?.textContent.trim() || "no price",
      summery:
        document.querySelector("div.snippet summary")?.textContent.trim() ||
        "no summary",
      expires:
        document.querySelector("div.row-text")?.textContent.trim() ||
        "no expires",
      images: Array.from(
        document.querySelectorAll("div.product-image img")
      ).map((img) => img.getAttribute("src")),
    };
  });

  return data;
}

/**
 * Navigates safely with retries.
 */
async function safeGoto(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });

      if (!response || response.status() >= 400) {
        console.error(
          `❌ Page not found: ${url} (Status: ${
            response ? response.status() : "No Response"
          })`
        );
        return false;
      }

      return true; // Page exists
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed for ${url}:`, error);
      if (attempt === retries) {
        console.error(
          `🚨 Failed to navigate to ${url} after ${retries} attempts.`
        );
        return false;
      }
      await page.waitForTimeout(5000);
    }
  }
}

/**
 * Main function to start scraping.
 */
async function main() {
  console.log("🚀 Launching Puppeteer...");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  const categories = await scrapeCategories(page);

  await fs.writeFile(`category.json`, JSON.stringify(categories));

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
