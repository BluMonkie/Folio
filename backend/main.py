from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings

from backend.routers import books, pages, auth, tags, grants, search, tables, public, assets
from backend.routers.books import current_share_token

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

@app.middleware("http")
async def share_token_context_middleware(request: Request, call_next):
    """
    Captures X-Share-Token header or share_token query parameter into
    a ContextVar so database authorization checks can verify public editing rights.
    """
    token = request.headers.get("x-share-token") or request.query_params.get("share_token")
    token_reset = current_share_token.set(token)
    try:
        response = await call_next(request)
        return response
    finally:
        current_share_token.reset(token_reset)

app.include_router(auth.router)
app.include_router(books.router)
app.include_router(pages.router)
app.include_router(tags.router)
app.include_router(grants.router)
app.include_router(search.router)
app.include_router(tables.router)
app.include_router(public.router)
app.include_router(assets.router)

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
