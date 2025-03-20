import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "./articles"; // Base directory for storing scraped data
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function scrapeArticles() {
  const browser = await puppeteer.launch({
    headless: "new",
    protocolTimeout: 120000, // Increase timeout
  });

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  const currentYear = new Date().getFullYear();
  for (let year = 2008; year <= currentYear - 1; year++) {
    console.log(`📅 Scraping year: ${year}`);

    // Create folders for each year
    const yearDir = path.join(OUTPUT_DIR, `${year}`);
    const pagesDir = path.join(yearDir, "pages");
    const contentsDir = path.join(yearDir, "contents");

    if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir);
    if (!fs.existsSync(pagesDir)) fs.mkdirSync(pagesDir);
    if (!fs.existsSync(contentsDir)) fs.mkdirSync(contentsDir);

    let pageNumber = 1;
    let pageExists = true;

    while (pageExists) {
      const url = `https://www.dealnews.com/features/archives/${year}/?page=${pageNumber}`;
      console.log(`🔍 Visiting: ${url}`);

      const success = await safeGoto(page, url);
      if (!success) {
        console.log(`⏩ Skipping page ${pageNumber} due to failure.`);
        break;
      }

      // Extract articles from the current page
      const articles = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("article.feature")).map(
          (article) => {
            const titleElement = article.querySelector("h3.sub-heading a");
            const authorElement = article.querySelector(".std-byline");
            const teaserElement = article.querySelector(".feature-teaser");
            const dateElement = article.querySelector(
              ".feature-dateline .unit.size1of2"
            );
            const commentElement = article.querySelector(
              ".feature-dateline .unitRight a"
            );

            return {
              title: titleElement?.innerText.trim() || "No Title",
              url: titleElement?.href || "No URL",
              author: authorElement?.innerText.trim() || "Unknown Author",
              teaser: teaserElement?.innerText.trim() || "No Description",
              published: dateElement?.innerText.trim() || "No Date",
              commentLink: commentElement?.href || "No Comment Link",
            };
          }
        );
      });

      console.log(`📄 Found ${articles.length} articles on page ${pageNumber}`);

      if (articles.length === 0) {
        console.log(`🚨 No articles found. Stopping pagination for ${year}.`);
        break;
      }

      // Save articles to a JSON file in the "pages" subfolder
      const jsonFilePath = path.join(pagesDir, `page_${pageNumber}.json`);
      fs.writeFileSync(jsonFilePath, JSON.stringify(articles, null, 2));
      console.log(`✅ Saved article metadata: ${jsonFilePath}`);

      // Visit each article and save its content
      for (const [index, article] of articles.entries()) {
        if (!article.url || article.url === "No URL") continue;

        const commentPage = await browser.newPage();
        const success = await safeGoto(commentPage, article.url);
        if (!success) {
          console.log(`⚠️ Skipping article: ${article.title}`);
          await commentPage.close();
          continue;
        }

        const htmlContent = await commentPage.content();
        const htmlFilePath = path.join(
          contentsDir,
          `article_${pageNumber}_${index}.html`
        );
        fs.writeFileSync(htmlFilePath, htmlContent);
        console.log(`✅ Saved article page: ${htmlFilePath}`);

        await commentPage.close();
        await new Promise((r) => setTimeout(r, 1000)); // Delay to avoid detection
      }

      pageNumber += 50; // Increase pagination by 50 (51, 101, 151, etc.)
    }
  }

  await browser.close();
  console.log("🎉 Scraping completed successfully!");
}

// Function to safely visit a page with retries
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

// Run the scraper
scrapeArticles();
