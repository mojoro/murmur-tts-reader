import logging

from fastapi import APIRouter, Depends, HTTPException
import aiosqlite

from orchestrator.db import get_db
from orchestrator.auth import hash_password, verify_password, create_token, get_current_user_id
from orchestrator.models import RegisterRequest, LoginRequest, AuthResponse, UserResponse
from orchestrator.rate_limit import rate_limit_login, rate_limit_register

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(
    req: RegisterRequest,
    _: None = Depends(rate_limit_register),
    db: aiosqlite.Connection = Depends(get_db),
):
    logger.info("Register attempt")
    existing = await db.execute_fetchall("SELECT id FROM users WHERE email = ?", (req.email,))
    if existing:
        logger.warning("Register failed: duplicate email")
        raise HTTPException(status_code=409, detail="Email already registered")

    cursor = await db.execute(
        "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
        (req.email, hash_password(req.password), req.display_name),
    )
    await db.commit()
    user_id = cursor.lastrowid
    logger.info("Registered user id=%d", user_id)

    row = await db.execute_fetchall("SELECT * FROM users WHERE id = ?", (user_id,))
    user = dict(row[0])
    token = create_token(user_id)
    return AuthResponse(
        user=UserResponse(id=user["id"], email=user["email"], display_name=user["display_name"], created_at=user["created_at"]),
        token=token,
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    req: LoginRequest,
    _: None = Depends(rate_limit_login),
    db: aiosqlite.Connection = Depends(get_db),
):
    logger.info("Login attempt")
    rows = await db.execute_fetchall("SELECT * FROM users WHERE email = ?", (req.email,))
    if not rows:
        logger.warning("Login failed: unknown email")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = dict(rows[0])
    if not verify_password(req.password, user["password_hash"]):
        logger.warning("Login failed: wrong password for user id=%d", user["id"])
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(user["id"])
    logger.info("Login success for user id=%d", user["id"])
    return AuthResponse(
        user=UserResponse(id=user["id"], email=user["email"], display_name=user["display_name"], created_at=user["created_at"]),
        token=token,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall("SELECT * FROM users WHERE id = ?", (user_id,))
    if not rows:
        logger.error("User from token not found", extra={"user_id": user_id})
        raise HTTPException(status_code=404, detail="User not found")
    user = dict(rows[0])
    return UserResponse(id=user["id"], email=user["email"], display_name=user["display_name"], created_at=user["created_at"])
