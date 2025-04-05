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
 * Visits and scrapes a product page.
 */
async function visitProductPage(page, link) {
  if (!link || link === "No Offer Link") {
    console.warn(`⚠️ Invalid product link: ${link}`);
    return null;
  }

  try {
    const response = await page.goto(link, {
      waitUntil: "networkidle2",
      timeout: 180000,
    });

    if (!response || response.status() >= 400) {
      console.warn(`⚠️ Failed to load product page: ${link}`);
      return null;
    }

    return await page.evaluate(() => {
      return {
        name:
          document.querySelector("div.title")?.getAttribute("title")?.trim() ||
          "No Product Name",
        description: document
          .querySelector("a.title-link")
          ?.getAttribute("aria-label")
          ?.trim()
          ?.replace(/\n/g, ""),
        price:
          document.querySelector("div.callout")?.textContent.trim() ||
          "No Price",
        summary:
          document
            .querySelector("div.snippet.summary")
            ?.getAttribute("title")
            .trim() || "No Summary",
        shop:
          document
            .querySelector("div.key-attribute")
            ?.textContent.split("·")[0]
            .trim() || "shop name",
        published:
          Array.from(document.querySelectorAll("ul.material-list .row-text"))
            .map((row) => row.textContent.trim())[0]
            ?.split("\n")[1]
            ?.replace("Published ", "") || "No Published Date",
        others:
          Array.from(document.querySelectorAll("ul.material-list .row-text"))
            .map((row) => row.textContent.trim())
            ?.filter(
              (e) =>
                e !==
                "This site uses cookies to optimize your experience, analyze traffic, and remember your preferences."
            ) || "No Popularity",
        images: document
          .querySelector("img.native-lazy-img")
          .getAttribute("src")
          .trim(),
      };
    });
  } catch (error) {
    console.error(`❌ Error scraping product page ${link}:`, error);
    return null;
  }
}

/**
 * Visits subcategory pages and extracts product links.
 */
async function visitCategorySubcategory(page, categories) {
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  for (const category of categories) {
    console.log(`📂 Processing category: ${category.name}`);
    const categoryData = [];

    for (const sub of category.subcategories) {

      const subCategoryData = []

      try {
        await safeGoto(page, sub.link);
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
              const buttonElement = article.querySelector(
                'button[data-bottom-sheet-id="overflow-menu-content-card"]'
              );

              return {
                shop: shopElement
                  ? shopElement.getAttribute("title")
                  : "No Title",
                productLink: productElement
                  ? productElement.getAttribute("href")
                  : "No Product Link",
                offerLink: buttonElement
                  ? buttonElement.getAttribute("data-offer-url")
                  : "No Offer Link",
              };
            });
          });

          for (const article of articles) {
            const productData = await visitProductPage(
              page,
              article?.offerLink
            );

            console.log(`see product data`, productData);

            if (subCategoryData) {
              subCategoryData.push(subCategoryData);
            }
          }

          pageNumber += 20;
        }
      } catch (error) {
        console.error(`❌ Failed to visit ${sub.link}:`, error.message);
      }
    }

    if (subCategoryData.length > 0) {
      categoryData.push({name: sub.name, data: subCategoryData});
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const categoryFilePath = path.join(OUTPUT_DIR, `${category.name}.json`);
    await fs.writeFile(categoryFilePath, JSON.stringify(categoryData, null, 2));
  }
}

/**
 * Safe navigation function with retries.
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

      return true;
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
  await fs.writeFile(`category.json`, JSON.stringify(categories, null, 2));

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
