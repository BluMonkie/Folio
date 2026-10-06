from fastapi import FastAPI
from backend.config import settings

app = FastAPI(
    title="Folio API",
    description="Backend API for Folio — a hybrid knowledge base with SQL capabilities.",
    version="0.1.0"
)

@app.get("/")
def read_root():
    return {"message": "Hello World"}
