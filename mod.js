import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "./articles";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function scrapeArticles() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  /** 
   now my logic is this is my current url from 2008 to the lest year i will hit every link dynamically like this:
  www.dealnews.com/features/archives/{{year}}/?page={{page}} // year from 2008 to new Date().getFullYear() - 1;
  
  
  after navigating every year we want to go every page 
  if url  https://www.dealnews.com/features/archives/2024/?page=1 exists
  then it will go to the url and save the all articles like this: 

  

  after saving all articles from the page then we will repeat the cycle page number value increase 50 
  for example : 
  https://www.dealnews.com/features/archives/2024/?page=51
  https://www.dealnews.com/features/archives/2024/?page=101
  https://www.dealnews.com/features/archives/2024/?page=151
  https://www.dealnews.com/features/archives/2024/?page=201


  in the articles folder i want to make files year based. how can i do that?

  */

  https: try {
    // Navigate to the main page
    await page.goto("https://www.dealnews.com/features/archives/c698/", {
      waitUntil: "networkidle2",
    });

    // Extract article details
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

    console.log(`see articles`, articles);

    console.log(`Found ${articles.length} articles.`);

    // Save article metadata
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "articles.json"),
      JSON.stringify(articles, null, 2)
    );
    console.log("✅ Articles metadata saved.");

    // Visit each "ADD A COMMENT" page and save content
    for (const [index, article] of articles.entries()) {
      if (!article.url || article.url === "No Comment Link") continue;

      const commentPage = await browser.newPage();
      await commentPage.goto(article.url, {
        waitUntil: "domcontentloaded",
      });

      const htmlContent = await commentPage.content();
      const filePath = path.join(OUTPUT_DIR, `article_${index}.html`);
      fs.writeFileSync(filePath, htmlContent);

      console.log(`✅ Saved comment page for "${article.title}"`);

      await commentPage.close();
      await new Promise((r) => setTimeout(r, 1000)); // Delay to avoid detection
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await browser.close();
  }
}

// Run scraper
scrapeArticles();
