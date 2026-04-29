from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

class SkipTracer:
    def __init__(self):
        self.browser_config = BrowserConfig(headless=True)
    
    async def scrape(self, url: str):
        async with AsyncWebCrawler(config=self.browser_config) as crawler:
            result = await crawler.arun(
                url=url,
                config=CrawlerRunConfig(
                    cache_mode=CacheMode.BYPASS,
                    word_count_threshold=10
                )
            )
            return result.markdown