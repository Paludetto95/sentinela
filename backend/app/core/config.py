import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Sentinel AI API"
    API_V1_STR: str = "/api"
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://sentinel_admin:sentinel_password@localhost:5432/sentinel_db"
    )
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # JWT
    JWT_SECRET: str = os.getenv("JWT_SECRET", "sentinel_ai_super_secret_jwt_key_2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # MinIO / S3
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY", "sentinel_minio_user")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY", "sentinel_minio_password")
    MINIO_SECURE: bool = False
    
    # MediaMTX
    MEDIAMTX_API_URL: str = os.getenv("MEDIAMTX_API_URL", "http://localhost:9997/v3")
    
    class Config:
        case_sensitive = True

settings = Settings()
