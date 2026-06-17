from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.session import SessionLocal
from app.db.init_db import init_db
from app.api.endpoints import auth, condos, users, vehicles, cameras, billing, events, monitoring

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set CORS origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this in production to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup Database Seeding & MediaMTX Sync Hook
@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    try:
        init_db(db)
        print("Database initialized and seeded successfully.")
        
        # Sync existing cameras with MediaMTX
        from app.models.all_models import Camera
        from app.services.mediamtx import mediamtx_service
        cameras_list = db.query(Camera).all()
        for cam in cameras_list:
            if not (str(cam.rtsp_url).lower().startswith("http://") or str(cam.rtsp_url).lower().startswith("https://")):
                print(f"Syncing camera {cam.name} ({cam.id}) to MediaMTX...")
                sync_res = mediamtx_service.add_path(str(cam.id), cam.rtsp_url)
                print(f"Sync result for {cam.name}: {sync_res}")
            
    except Exception as e:
        print(f"Error initializing database or syncing cameras on startup: {e}")
    finally:
        db.close()

# API Router Mounts
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(condos.router, prefix=f"{settings.API_V1_STR}/condos", tags=["condos"])
app.include_router(users.router, prefix=f"{settings.API_V1_STR}/users", tags=["users"])
app.include_router(vehicles.router, prefix=f"{settings.API_V1_STR}/vehicles", tags=["vehicles"])
app.include_router(cameras.router, prefix=f"{settings.API_V1_STR}/cameras", tags=["cameras"])
app.include_router(billing.router, prefix=f"{settings.API_V1_STR}/billing", tags=["billing"])
app.include_router(events.router, prefix=f"{settings.API_V1_STR}/events", tags=["events"])
app.include_router(monitoring.router, prefix=f"{settings.API_V1_STR}/monitoring", tags=["monitoring"])

@app.get("/health", tags=["system"])
def health_check():
    return {"status": "healthy", "service": "sentinel-api"}
