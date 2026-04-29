import os
import sys
from fastapi import FastAPI
from pydantic import BaseModel
from crawl4ai import AsyncWebCrawler
import pdfplumber
import psycopg2
from psycopg2 import Error

app = FastAPI()

class ScrapeRequest(BaseModel):
    url: str

def scrape_url(url: str):
    # Connect to NeonDB
    try:
        connection = psycopg2.connect(os.getenv('DATABASE_URL'))
        cursor = connection.cursor()
    except (Exception, Error) as error:
        print("Error while connecting to PostgreSQL", error)

    # Scrape the URL using Crawl4AI's stealth mode
    crawler = AsyncWebCrawler()
    data = crawler.scrape(url, stealth=True)

    # Insert data into the 'leads' table
    try:
        cursor.execute("INSERT INTO leads (url, data) VALUES (%s, %s)", (url, data))
        connection.commit()
    except (Exception, Error) as error:
        print("Error while inserting data into leads table", error)
    finally:
        if connection:
            cursor.close()
            connection.close()

def parse_pdf(path: str):
    # Parse the PDF using pdfplumber
    with pdfplumber.open(path) as pdf:
        text = ''
        for page in pdf.pages:
            text += page.extract_text()
        # Extract property owner names
        owner_names = []
        # Add logic to extract owner names from the text
        return owner_names

@app.post("/scrape")
def scrape(request: ScrapeRequest):
    scrape_url(request.url)
    return {"message": "Scraping completed"}
