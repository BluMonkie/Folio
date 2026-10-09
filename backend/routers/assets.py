import uuid
import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from backend.config import settings
from backend.services.auth import get_current_user, CurrentUser
from backend.services import storage

logger = logging.getLogger("folio.assets")

router = APIRouter(tags=["Assets"])

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/avif": ".avif",
}

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

class AssetUploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str
    size: int

@router.post("/assets/upload", response_model=AssetUploadResponse)
@router.post("/api/assets/upload", response_model=AssetUploadResponse)
async def upload_asset(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Uploads an image file for embedding into notebook pages.
    Validates file type and size, then persists it using the configured StorageBackend (Local or S3).
    """
    try:
        content_type = (file.content_type or "").lower().split(";")[0].strip()
        
        # Check mime type or extension
        ext = ALLOWED_IMAGE_TYPES.get(content_type)
        if not ext:
            # Fallback check on original filename
            original_ext = Path(file.filename or "").suffix.lower()
            if original_ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".avif"}:
                ext = original_ext
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported file type '{content_type}'. Supported image formats: JPEG, PNG, GIF, WebP, SVG, AVIF, BMP."
                )

        # Read and validate size
        contents = await file.read()
        file_size = len(contents)
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of 15MB (got {file_size / (1024 * 1024):.2f}MB)."
            )
        if file_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty."
            )

        # Generate unique, collision-free filename with active existence check
        while True:
            unique_name = f"{uuid.uuid4().hex}{ext}"
            if not storage.asset_exists(unique_name):
                break

        # Persist through StorageBackend abstraction (supports FileSystemStorage and S3Storage)
        asset_url = storage.write_asset(unique_name, contents, content_type)

        logger.info(f"User {current_user.user_id} uploaded asset {unique_name} ({file_size} bytes)")

        return AssetUploadResponse(
            url=asset_url,
            filename=file.filename or unique_name,
            content_type=content_type,
            size=file_size
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled error during asset upload")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset upload failed: {str(exc)}"
        )

@router.get("/assets/{filename}")
async def get_asset(filename: str):
    """
    Retrieves and serves an asset through the configured storage backend (FileSystem or S3).
    """
    storage_backend = storage.get_storage()
    if isinstance(storage_backend, storage.FileSystemStorage):
        path = storage_backend._get_assets_dir() / filename
        if not path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
        return FileResponse(path)

    # For S3Storage or other cloud object storage backends
    result = storage_backend.read_asset(filename)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    data, media_type = result
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400, immutable"}
    )
