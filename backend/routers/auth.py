from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field

from backend.database import get_db
from backend.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    CurrentUser
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class UserSignup(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)

class UserLoginJSON(BaseModel):
    email: EmailStr
    password: str

class UserProfile(BaseModel):
    user_id: int
    name: str
    email: str
    created_at: Optional[datetime] = None

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: UserSignup):
    """
    Registers a new user account:
    - Verifies email uniqueness.
    - Hashes password with bcrypt.
    - Inserts user into MySQL.
    - Returns signed JWT access token.
    """
    email_clean = payload.email.lower().strip()

    with get_db() as cursor:
        cursor.execute("SELECT user_id FROM User WHERE email = %s;", (email_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists."
            )

        hashed = hash_password(payload.password)
        cursor.execute(
            "INSERT INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
            (payload.name.strip(), email_clean, hashed)
        )
        user_id = cursor.lastrowid

        cursor.execute("SELECT user_id, name, email, created_at FROM User WHERE user_id = %s;", (user_id,))
        new_user = cursor.fetchone()

    token = create_access_token(user_id=user_id, email=email_clean)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": new_user
    }

@router.post("/login", response_model=AuthResponse)
def login_form(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Standard OAuth2 password login (powers Swagger UI 'Authorize' button).
    Accepts email in form_data.username.
    """
    email_clean = form_data.username.lower().strip()

    with get_db() as cursor:
        cursor.execute(
            "SELECT user_id, name, email, password_hash, created_at FROM User WHERE email = %s;",
            (email_clean,)
        )
        user = cursor.fetchone()

    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(user_id=user["user_id"], email=user["email"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "name": user["name"],
            "email": user["email"],
            "created_at": user["created_at"]
        }
    }

@router.post("/login/json", response_model=AuthResponse)
def login_json(payload: UserLoginJSON):
    """
    JSON-based login endpoint for frontend applications sending {email, password}.
    """
    email_clean = payload.email.lower().strip()

    with get_db() as cursor:
        cursor.execute(
            "SELECT user_id, name, email, password_hash, created_at FROM User WHERE email = %s;",
            (email_clean,)
        )
        user = cursor.fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )

    token = create_access_token(user_id=user["user_id"], email=user["email"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "name": user["name"],
            "email": user["email"],
            "created_at": user["created_at"]
        }
    }

@router.get("/me", response_model=UserProfile)
def get_my_profile(current_user: CurrentUser = Depends(get_current_user)):
    """Returns the currently authenticated user's profile."""
    return current_user
