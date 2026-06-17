from typing import List
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.models.all_models import Condominium, User, Tenant, Subscription, Plan
from app.schemas.schemas import CondoCreate, CondoResponse, CondoPublicResponse
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant

router = APIRouter()

@router.get("/public", response_model=List[CondoPublicResponse])
def list_condominiums_public(
    db: Session = Depends(get_db)
):
    """
    Exposes a safe, unauthenticated list of active condos for resident signup.
    """
    return db.query(Condominium).filter(Condominium.status == "active").all()

@router.post("/", response_model=CondoResponse, status_code=status.HTTP_201_CREATED)
def create_condominium(
    condo_in: CondoCreate,
    current_user: User = Depends(PermissionChecker(["condos:create"])),
    db: Session = Depends(get_db)
):
    # Ensure CNPJ is unique
    existing = db.query(Condominium).filter(Condominium.cnpj == condo_in.cnpj).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um condomínio cadastrado com este CNPJ."
        )

    # Determine tenant scoping
    # If Super Admin, create a separate Tenant and associate a free subscription (10 years)
    if current_user.role_id == "super_admin":
        new_tenant = Tenant(name=f"Tenant - {condo_in.name}")
        db.add(new_tenant)
        db.commit()
        db.refresh(new_tenant)
        tenant_id = new_tenant.id

        # Associate Starter Plan automatically (for testing purposes, free of charge for 10 years)
        starter_plan = db.query(Plan).filter(Plan.name == "Starter").first()
        if starter_plan:
            now = datetime.now(timezone.utc)
            sub = Subscription(
                tenant_id=tenant_id,
                plan_id=starter_plan.id,
                status="active",
                current_period_start=now,
                current_period_end=now + timedelta(days=3650) # 10 years
            )
            db.add(sub)
            db.commit()
    else:
        tenant_id = current_user.tenant_id
        
    db_condo = Condominium(
        tenant_id=tenant_id,
        name=condo_in.name,
        cnpj=condo_in.cnpj,
        address=condo_in.address,
        city=condo_in.city,
        state=condo_in.state,
        cep=condo_in.cep,
        phone=condo_in.phone,
        email=condo_in.email,
        logo_url=condo_in.logo_url,
        towers=condo_in.towers
    )
    db.add(db_condo)
    db.commit()
    db.refresh(db_condo)
    
    # Auto-associate admin user to the created condo if null
    if current_user.condominium_id is None:
        current_user.condominium_id = db_condo.id
        db.commit()
        db.refresh(current_user)
        
    return db_condo

@router.get("/", response_model=List[CondoResponse])
def list_condominiums(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role_id == "super_admin":
        return db.query(Condominium).all()
        
    return db.query(Condominium).filter(Condominium.tenant_id == current_user.tenant_id).all()

@router.get("/{condo_id}", response_model=CondoResponse)
def get_condominium(
    condo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    condo = db.query(Condominium).filter(Condominium.id == condo_id).first()
    if not condo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Condomínio não encontrado."
        )
    enforce_tenant(condo.tenant_id, current_user)
    return condo

@router.put("/{condo_id}", response_model=CondoResponse)
def update_condominium(
    condo_id: UUID,
    condo_in: CondoCreate,
    current_user: User = Depends(PermissionChecker(["condos:create"])),
    db: Session = Depends(get_db)
):
    condo = db.query(Condominium).filter(Condominium.id == condo_id).first()
    if not condo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Condomínio não encontrado."
        )
    enforce_tenant(condo.tenant_id, current_user)

    # Check CNPJ uniqueness (allow same condo to keep its own CNPJ)
    if condo_in.cnpj != condo.cnpj:
        existing = db.query(Condominium).filter(Condominium.cnpj == condo_in.cnpj).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Já existe um condomínio com este CNPJ."
            )

    condo.name = condo_in.name
    condo.cnpj = condo_in.cnpj
    condo.address = condo_in.address
    condo.city = condo_in.city
    condo.state = condo_in.state
    condo.cep = condo_in.cep
    condo.phone = condo_in.phone
    condo.email = condo_in.email
    condo.logo_url = condo_in.logo_url
    condo.towers = condo_in.towers

    db.commit()
    db.refresh(condo)
    return condo

@router.delete("/{condo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_condominium(
    condo_id: UUID,
    current_user: User = Depends(PermissionChecker(["condos:delete"])),
    db: Session = Depends(get_db)
):
    condo = db.query(Condominium).filter(Condominium.id == condo_id).first()
    if not condo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Condomínio não encontrado."
        )
    enforce_tenant(condo.tenant_id, current_user)
    db.delete(condo)
    db.commit()
    return

