import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Table, Text, Double
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base

# Association Table for Role-Permissions (M2M)
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", String(50), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", String(100), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)
)

class Tenant(Base):
    __tablename__ = "tenants"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    status = Column(String(50), default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    condominiums = relationship("Condominium", back_populates="tenant", cascade="all, delete-orphan")
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="tenant", cascade="all, delete-orphan")


class Condominium(Base):
    __tablename__ = "condominiums"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    cnpj = Column(String(18), unique=True, nullable=False, index=True)
    address = Column(String(255), nullable=False)
    city = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    cep = Column(String(9), nullable=False)
    phone = Column(String(20))
    email = Column(String(255), nullable=False)
    logo_url = Column(String(512))
    status = Column(String(50), default="active")
    towers = Column(JSONB, nullable=True) # list of towers, e.g. ["Torre A", "Torre B"]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tenant = relationship("Tenant", back_populates="condominiums")
    users = relationship("User", back_populates="condominium")
    cameras = relationship("Camera", back_populates="condominium", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="condominium", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="condominium", cascade="all, delete-orphan")


class Role(Base):
    __tablename__ = "roles"
    
    id = Column(String(50), primary_key=True)  # super_admin, administradora, admin_condominio, operador, morador
    name = Column(String(100), nullable=False)
    description = Column(Text)

    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles")


class Permission(Base):
    __tablename__ = "permissions"
    
    id = Column(String(100), primary_key=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)

    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")


class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20))
    cpf = Column(String(14), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    photo_url = Column(String(512))
    role_id = Column(String(50), ForeignKey("roles.id"), nullable=False)
    apartment = Column(String(50), nullable=True)
    tower = Column(String(50), nullable=True)
    status = Column(String(50), default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tenant = relationship("Tenant", back_populates="users")
    condominium = relationship("Condominium", back_populates="users")
    vehicles = relationship("Vehicle", back_populates="owner")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")


class Plan(Base):
    __tablename__ = "plans"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False)
    max_cameras = Column(Integer, nullable=False)
    video_retention_days = Column(Integer, nullable=False)
    max_users = Column(Integer, nullable=False)
    price_cents = Column(Integer, nullable=False)
    features = Column(JSONB, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False)
    status = Column(String(50), default="active")
    current_period_start = Column(DateTime(timezone=True), nullable=False)
    current_period_end = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tenant = relationship("Tenant", back_populates="subscriptions")
    plan = relationship("Plan")


class Billing(Base):
    __tablename__ = "billing"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    gateway_customer_id = Column(String(255))
    payment_method_token = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Invoice(Base):
    __tablename__ = "invoices"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    subscription_id = Column(UUID(as_uuid=True), ForeignKey("subscriptions.id"), nullable=True)
    amount_cents = Column(Integer, nullable=False)
    status = Column(String(50), default="pending")
    due_date = Column(DateTime(timezone=True), nullable=False)
    paid_at = Column(DateTime(timezone=True))
    gateway_invoice_id = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id"), nullable=False)
    amount_cents = Column(Integer, nullable=False)
    payment_method = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False)
    transaction_id = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Vehicle(Base):
    __tablename__ = "vehicles"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    plate = Column(String(10), unique=True, index=True, nullable=True)
    brand = Column(String(100))
    model = Column(String(100))
    year = Column(Integer)
    color = Column(String(50))
    nickname = Column(String(100))
    status = Column(String(50), default="authorized")  # authorized, unauthorized, blocked
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    condominium = relationship("Condominium", back_populates="vehicles")
    owner = relationship("User", back_populates="vehicles")
    profile = relationship("VehicleProfile", uselist=False, back_populates="vehicle", cascade="all, delete-orphan")
    images = relationship("VehicleImage", back_populates="vehicle", cascade="all, delete-orphan")


class VehicleProfile(Base):
    __tablename__ = "vehicle_profiles"
    
    vehicle_id = Column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), primary_key=True)
    reid_embedding = Column(ARRAY(Float))  # ReID representation as vector/list
    distinctive_features = Column(JSONB, default={})
    last_seen_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    vehicle = relationship("Vehicle", back_populates="profile")


class VehicleImage(Base):
    __tablename__ = "vehicle_images"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id = Column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)
    image_url = Column(String(512), nullable=False)
    is_main = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    vehicle = relationship("Vehicle", back_populates="images")


class Camera(Base):
    __tablename__ = "cameras"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    rtsp_url = Column(String(512), nullable=False)
    location_name = Column(String(150))
    latitude = Column(Double)
    longitude = Column(Double)
    status = Column(String(50), default="offline")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    condominium = relationship("Condominium", back_populates="cameras")
    zones = relationship("CameraZone", back_populates="camera", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="camera", cascade="all, delete-orphan")
    false_positives = relationship("CameraFalsePositive", back_populates="camera", cascade="all, delete-orphan")


class CameraZone(Base):
    __tablename__ = "camera_zones"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    zone_type = Column(String(50), default="restricted")
    coordinates = Column(JSONB, nullable=False)  # List of points [{x: 0.1, y: 0.2}, ...]
    risk_multiplier = Column(Double, default=1.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    camera = relationship("Camera", back_populates="zones")


class Event(Base):
    __tablename__ = "events"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    track_id = Column(Integer)
    object_type = Column(String(50), nullable=False)  # person, car, motorcycle, truck, bicycle
    event_type = Column(String(100), nullable=False)
    risk_score = Column(Integer, default=0)
    risk_level = Column(String(50), default="low")  # low, medium, high, critical
    details = Column(JSONB, default={})
    is_resolved = Column(Boolean, default=False)
    resolved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolution_notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True))

    condominium = relationship("Condominium", back_populates="events")
    camera = relationship("Camera", back_populates="events")
    images = relationship("EventImage", back_populates="event", cascade="all, delete-orphan")
    videos = relationship("EventVideo", back_populates="event", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="event")


class EventImage(Base):
    __tablename__ = "event_images"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    image_url = Column(String(512), nullable=False)
    is_alert_frame = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="images")


class EventVideo(Base):
    __tablename__ = "event_videos"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    video_url = Column(String(512), nullable=False)
    duration_seconds = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="videos")


class Notification(Base):
    __tablename__ = "notifications"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    channel = Column(String(50), nullable=False)  # push, whatsapp, email, sms
    destination = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(50), default="pending")  # pending, sent, failed
    error_message = Column(Text)
    sent_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="notifications")


class KnownVehicle(Base):
    __tablename__ = "known_vehicles"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    vehicle_id = Column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)
    confidence_threshold = Column(Double, default=0.85)
    last_matched_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KnownPerson(Base):
    __tablename__ = "known_persons"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    condominium_id = Column(UUID(as_uuid=True), ForeignKey("condominiums.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100))
    face_embedding = Column(ARRAY(Float))
    photo_url = Column(String(512))
    role = Column(String(50))  # resident, employee, recurring_delivery
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_id = Column(String(100))
    old_values = Column(JSONB)
    new_values = Column(JSONB)
    ip_address = Column(String(45))
    user_agent = Column(String(512))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="audit_logs")


class Session(Base):
    __tablename__ = "sessions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(512), unique=True, nullable=False, index=True)
    ip_address = Column(String(45))
    user_agent = Column(String(512))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="sessions")


class SystemSetting(Base):
    __tablename__ = "system_settings"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    setting_key = Column(String(100), nullable=False)
    setting_value = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VehicleMonitoring(Base):
    __tablename__ = "vehicle_monitorings"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    vehicle_id = Column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    coordinates = Column(JSONB, nullable=False)  # Lista de pontos: [{'x': 0.1, 'y': 0.2}, ...]
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User")
    vehicle = relationship("Vehicle")
    camera = relationship("Camera")

    @property
    def vehicle_model(self):
        return self.vehicle.model if self.vehicle else None

    @property
    def user_name(self):
        return self.user.name if self.user else None


class CameraFalsePositive(Base):
    __tablename__ = "camera_false_positives"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id = Column(UUID(as_uuid=True), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    obj_type = Column(String(50), nullable=False)
    coordinates = Column(JSONB, nullable=False) # {'x1': 0.1, 'y1': 0.2, 'x2': 0.3, 'y2': 0.4}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    camera = relationship("Camera", back_populates="false_positives")

