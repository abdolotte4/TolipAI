import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from scraper import SkipTracer
from fusion import FusionEngine
import asyncpg

app = FastAPI()

class ScrapeRequest(BaseModel):
    url: str

async def scrape_url(url: str):
    connection = None
    try:
        connection = await asyncpg.connect(os.getenv('DATABASE_URL'))
        
        tracer = SkipTracer()
        markdown = await tracer.scrape(url)
        
        fusion_engine = FusionEngine(markdown=markdown)
        scored_data = fusion_engine.run()
        
        await connection.execute(
            "INSERT INTO leads (url, phones, addresses, raw_data) VALUES ($1, $2, $3, $4)",
            url,
            scored_data.get('phones', []),
            scored_data.get('addresses', []),
            markdown[:2000]
        )
        
        return scored_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@app.post("/scrape")
async def scrape(request: ScrapeRequest):
    result = await scrape_url(request.url)
    return {"message": "Scraping completed", "data": result}

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
