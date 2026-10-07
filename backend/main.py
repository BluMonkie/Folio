from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings

from backend.routers import books, pages, auth, tags, grants, search

app = FastAPI(
    title="Folio API",
    description="Backend API for Folio — a hybrid knowledge base with SQL capabilities.",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(books.router)
app.include_router(pages.router)
app.include_router(tags.router)
app.include_router(grants.router)
app.include_router(search.router)

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/health")
def health_check():
    """Checks application and database health."""
    try:
        from backend.database import get_db
        with get_db() as cursor:
            cursor.execute("SELECT COUNT(*) AS book_count FROM Book;")
            result = cursor.fetchone()
            book_count = result["book_count"] if result else 0

        return {
            "status": "healthy",
            "database": "connected",
            "book_count": book_count
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": f"error: {str(e)}"
        }
