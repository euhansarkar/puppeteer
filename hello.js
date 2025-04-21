const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = "./articles";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function scrapeArticles(targetYear) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
    headless: "shell",
    protocolTimeout: 180000,
  });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(180000);
  await page.setDefaultTimeout(180000);

  const startYear = targetYear || 2008;
  const endYear = targetYear || new Date().getFullYear() - 1;

  for (let year = startYear; year <= endYear; year++) {
    console.log(`📅 Scraping year: ${year}`);

    const yearDir = path.join(OUTPUT_DIR, `${year}`);
    const pagesDir = path.join(yearDir, "pages");
    const contentsDir = path.join(yearDir, "contents");
    [yearDir, pagesDir, contentsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    });

    let pageNumber = 1;
    while (true) {
      const url = `https://www.dealnews.com/features/archives/${year}/?page=${pageNumber}`;
      console.log(`🔍 Visiting: ${url}`);

      if (!(await safeGoto(page, url))) {
        console.log(`⏩ Skipping page ${pageNumber} due to failure.`);
        break;
      }

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
              title: titleElement?.innerText.trim() || null,
              url: titleElement?.href || null,
              author: authorElement?.innerText.trim() || null,
              teaser: teaserElement?.innerText.trim() || null,
              published: dateElement?.innerText.trim() || null,
              commentLink: commentElement?.href || null,
            };
          }
        );
      });

      if (articles.length === 0) {
        console.log(`🚨 No articles found. Stopping pagination for ${year}.`);
        break;
      }

      fs.writeFileSync(
        path.join(pagesDir, `page_${pageNumber}.json`),
        JSON.stringify(articles, null, 2)
      );
      console.log(`✅ Saved article metadata: page_${pageNumber}.json`);

      const scrapedProductsData = [];
      for (const article of articles) {
        if (!article.url || article.url === "No URL") continue;

        const commentPage = await browser.newPage();
        if (!(await safeGoto(commentPage, article.url))) {
          console.log(`⚠️ Skipping article: ${article.title}`);
          await commentPage.close();
          continue;
        }

        const data = await commentPage.evaluate(() => {
          const titleElement = document.querySelector(
            "h1#article-headline.font-display-2"
          );
          const authorElement = document.querySelector("div.hd a");
          const summaryElement = document.querySelector("div.article-summary");
          const descriptionElement = document.querySelector(
            "div#article.feature-article"
          );
          const imgElement = document.querySelector(
            'img[style*="width: 100%"][style*="aspect-ratio: 1800 / 1200"]'
          );

          return {
            title: titleElement?.innerText.trim() || null,
            author: authorElement?.getAttribute("rel")?.trim() || null,
            description: descriptionElement?.innerHTML.trim() || null,
            summary: summaryElement?.innerText.trim() || null,
            img: imgElement?.getAttribute("src")?.trim() || null,
          };
        });

        if (data?.title && data?.description) scrapedProductsData.push(data);

        const htmlContent = await commentPage.content();
        fs.writeFileSync(
          path.join(
            contentsDir,
            `article_${pageNumber}_${scrapedProductsData.length}.html`
          ),
          htmlContent
        );
        console.log(
          `✅ Saved article page: article_${pageNumber}_${scrapedProductsData.length}.html`
        );

        await commentPage.close();
        await new Promise((r) => setTimeout(r, 1000)); // wait 1 second
      }

      fs.writeFileSync(
        path.join(contentsDir, `articles_${pageNumber}.json`),
        JSON.stringify(scrapedProductsData, null, 2)
      );
      console.log(`✅ Saved scraped articles: articles_${pageNumber}.json`);

      pageNumber += 50;
    }
  }

  await browser.close();
  console.log("🎉 Scraping completed successfully!");
}

async function safeGoto(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      return true;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed for ${url}:`, error);
      if (attempt === retries) return false;
      await new Promise((r) => setTimeout(r, 5000)); // wait 5 seconds
    }
  }
  return false;
}

scrapeArticles(2008);

// Export functions if you want to require them elsewhere
module.exports = { scrapeArticles, safeGoto };
