from fastapi import FastAPI
from backend.config import settings

from backend.routers import books

app = FastAPI(
    title="Folio API",
    description="Backend API for Folio — a hybrid knowledge base with SQL capabilities.",
    version="0.1.0"
)

app.include_router(books.router)

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
