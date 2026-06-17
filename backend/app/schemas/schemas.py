from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime

# --- AUTH SCHEMAS ---
class LoginRequest(BaseModel):
    username: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    tenant_id: UUID
    condominium_id: Optional[UUID] = None
    name: str

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    cpf: str
    password: str
    condominium_id: Optional[UUID] = None
    apartment: Optional[str] = None
    tower: Optional[str] = None

# --- TENANT & CONDOMINIUM SCHEMAS ---
class TenantCreate(BaseModel):
    name: str

class TenantResponse(BaseModel):
    id: UUID
    name: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class CondoCreate(BaseModel):
    name: str
    cnpj: str
    address: str
    city: str
    state: str
    cep: str
    phone: Optional[str] = None
    email: EmailStr
    logo_url: Optional[str] = None
    towers: Optional[List[str]] = None

class CondoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    cnpj: str
    address: str
    city: str
    state: str
    cep: str
    phone: Optional[str] = None
    email: EmailStr
    logo_url: Optional[str] = None
    status: str
    towers: Optional[List[str]] = None
    created_at: datetime

    class Config:
        from_attributes = True

# --- USER SCHEMAS ---
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    cpf: str
    password: str
    role_id: str
    tenant_id: Optional[UUID] = None
    condominium_id: Optional[UUID] = None
    apartment: Optional[str] = None
    tower: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    role_id: Optional[str] = None

class UserResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    condominium_id: Optional[UUID] = None
    name: str
    email: EmailStr
    phone: Optional[str] = None
    cpf: str
    photo_url: Optional[str] = None
    role_id: str
    status: str
    apartment: Optional[str] = None
    tower: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# --- VEHICLE SCHEMAS ---
class VehicleCreate(BaseModel):
    plate: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    color: Optional[str] = None
    nickname: Optional[str] = None
    owner_id: Optional[UUID] = None

class VehicleResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    condominium_id: UUID
    owner_id: Optional[UUID] = None
    plate: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    color: Optional[str] = None
    nickname: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

# --- FALSE POSITIVE SCHEMAS ---
class FalsePositiveCreate(BaseModel):
    obj_type: str
    coordinates: Dict[str, float] # {'x1': 0.1, 'y1': 0.2, 'x2': 0.3, 'y2': 0.4}

class FalsePositiveResponse(BaseModel):
    id: UUID
    camera_id: UUID
    obj_type: str
    coordinates: Dict[str, float]
    created_at: datetime

    class Config:
        from_attributes = True

# --- CAMERA & ZONE SCHEMAS ---
class ZoneCreate(BaseModel):
    name: str
    zone_type: str = "restricted"
    coordinates: List[Dict[str, float]] # [{'x': 0.1, 'y': 0.2}]
    risk_multiplier: float = 1.0

class ZoneResponse(BaseModel):
    id: UUID
    camera_id: UUID
    name: str
    zone_type: str
    coordinates: List[Dict[str, float]]
    risk_multiplier: float

    class Config:
        from_attributes = True

class CameraCreate(BaseModel):
    name: str
    description: Optional[str] = None
    rtsp_url: str
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    condominium_id: Optional[UUID] = None

class CameraResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    condominium_id: UUID
    name: str
    description: Optional[str] = None
    rtsp_url: str
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str
    zones: List[ZoneResponse] = []
    false_positives: List[FalsePositiveResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True

# --- EVENT SCHEMAS ---
class EventImageResponse(BaseModel):
    id: UUID
    image_url: str
    is_alert_frame: bool

    class Config:
        from_attributes = True

class EventVideoResponse(BaseModel):
    id: UUID
    video_url: str
    duration_seconds: Optional[int] = None

    class Config:
        from_attributes = True

class EventCreate(BaseModel):
    camera_id: UUID
    track_id: Optional[int] = None
    object_type: str
    event_type: str
    risk_score: int
    risk_level: str
    details: Dict[str, Any] = {}

class EventResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    condominium_id: UUID
    camera_id: UUID
    track_id: Optional[int] = None
    object_type: str
    event_type: str
    risk_score: int
    risk_level: str
    details: Dict[str, Any]
    is_resolved: bool
    resolved_by: Optional[UUID] = None
    resolution_notes: Optional[str] = None
    created_at: datetime
    images: List[EventImageResponse] = []
    videos: List[EventVideoResponse] = []

    class Config:
        from_attributes = True

class EventResolve(BaseModel):
    resolution_notes: str

# --- BILLING SCHEMAS ---
class PlanResponse(BaseModel):
    id: UUID
    name: str
    max_cameras: int
    video_retention_days: int
    max_users: int
    price_cents: int
    features: Dict[str, Any]

    class Config:
        from_attributes = True

class SubscriptionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    plan_id: UUID
    status: str
    current_period_start: datetime
    current_period_end: datetime

    class Config:
        from_attributes = True

class InvoiceResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    subscription_id: Optional[UUID] = None
    amount_cents: int
    status: str
    due_date: datetime
    paid_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- NEW MONITORING & PUBLIC CONDOS SCHEMAS ---
class CondoPublicResponse(BaseModel):
    id: UUID
    name: str
    city: str
    state: str
    towers: Optional[List[str]] = None

    class Config:
        from_attributes = True

class VehicleMonitoringCreate(BaseModel):
    camera_id: UUID
    vehicle_id: UUID
    coordinates: List[Dict[str, float]]

class VehicleMonitoringResponse(BaseModel):
    id: UUID
    user_id: UUID
    vehicle_id: UUID
    camera_id: UUID
    coordinates: List[Dict[str, float]]
    is_active: bool
    created_at: datetime
    vehicle_model: Optional[str] = None
    user_name: Optional[str] = None

    class Config:
        from_attributes = True

