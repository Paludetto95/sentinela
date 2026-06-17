from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.db.session import get_db
from app.models.all_models import User, Tenant, Condominium, Subscription, Plan
from app.schemas.schemas import TokenResponse, RegisterRequest, UserResponse, LoginRequest
from app.api.deps import get_current_user

router = APIRouter()

@router.post("/register", response_model=UserResponse)
def register(
    user_in: RegisterRequest,
    db: Session = Depends(get_db)
):
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este e-mail já está cadastrado."
        )
    existing_cpf = db.query(User).filter(User.cpf == user_in.cpf).first()
    if existing_cpf:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este CPF já está cadastrado."
        )

    # Determine tenant and condominium association
    tenant_id = None
    role_id = "morador"  # default self-service role is resident
    
    if user_in.condominium_id:
        condo = db.query(Condominium).filter(Condominium.id == user_in.condominium_id).first()
        if not condo:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Condomínio selecionado não existe."
            )
        tenant_id = condo.tenant_id
        # For testing/free trial, users registering for a specific condo are active immediately
        status_user = "active"
        print(f"[PAYMENT EMAIL SIMULATION] Enviando link de pagamento (GRATUITO) para o e-mail: {user_in.email}")
    else:
        # Create a new tenant for self-service administrative users (Administradora / Admin Condominio)
        new_tenant = Tenant(name=f"Tenant - {user_in.name}")
        db.add(new_tenant)
        db.commit()
        db.refresh(new_tenant)
        tenant_id = new_tenant.id
        role_id = "admin_condominio"
        status_user = "active"

        # Create a default subscription with Starter plan
        starter_plan = db.query(Plan).filter(Plan.name == "Starter").first()
        if starter_plan:
            from datetime import datetime, timedelta, timezone
            sub = Subscription(
                tenant_id=tenant_id,
                plan_id=starter_plan.id,
                status="active",
                current_period_start=datetime.now(timezone.utc),
                current_period_end=datetime.now(timezone.utc) + timedelta(days=3650) # 10 years free trial
            )
            db.add(sub)
            db.commit()

    db_user = User(
        name=user_in.name,
        email=user_in.email,
        phone=user_in.phone,
        cpf=user_in.cpf,
        password_hash=security.get_password_hash(user_in.password),
        role_id=role_id,
        tenant_id=tenant_id,
        condominium_id=user_in.condominium_id,
        apartment=user_in.apartment,
        tower=user_in.tower,
        status=status_user
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.post("/login", response_model=TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not security.verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="E-mail ou senha incorretos."
        )
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sua conta está pendente de aprovação ou desativada."
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        subject=user.id, expires_delta=access_token_expires
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        role=user.role_id,
        tenant_id=user.tenant_id,
        condominium_id=user.condominium_id,
        name=user.name
    )

@router.get("/me", response_model=UserResponse)
def read_users_me(
    current_user: User = Depends(get_current_user)
):
    return current_user
