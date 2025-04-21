import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "./articles";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function scrapeArticles() {
  const browser = await puppeteer.launch({
    headless: "new",
    protocolTimeout: 120000,
  });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  const currentYear = new Date().getFullYear();
  for (let year = 2010; year <= currentYear - 1; year++) {
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
            return {
              title: titleElement?.innerText.trim() || "No Title",
              url: titleElement?.href || "No URL",
              author:
                article.querySelector(".std-byline")?.innerText.trim() ||
                "Unknown Author",
              teaser:
                article.querySelector(".feature-teaser")?.innerText.trim() ||
                "No Description",
              published:
                article
                  .querySelector(".feature-dateline .unit.size1of2")
                  ?.innerText.trim() || "No Date",
              commentLink:
                article.querySelector(".feature-dateline .unitRight a")?.href ||
                "No Comment Link",
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
          return {
            title:
              document
                .querySelector("h1#article-headline.font-display-2")
                ?.innerText.trim() || "No Title",
            author:
              document.querySelector("div.hd a")?.getAttribute("rel")?.trim() ||
              "Unknown Author",
            description:
              document
                .querySelector("div#article.feature-article")
                ?.innerHTML.trim() || "No Description",
            summary:
              document.querySelector("div.article-summary")?.innerText.trim() ||
              "No Summary",
          };
        });

        if (data) scrapedProductsData.push(data);

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
        await new Promise((r) => setTimeout(r, 1000));
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
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

scrapeArticles();
