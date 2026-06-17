from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.models.all_models import User
from app.schemas.schemas import UserCreate, UserUpdate, UserResponse
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant
from app.core.security import get_password_hash

router = APIRouter()

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    current_user: User = Depends(PermissionChecker(["users:manage"])),
    db: Session = Depends(get_db)
):
    # Verify email and CPF uniqueness
    if db.query(User).filter(User.email == user_in.email).first():
        raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado.")
    if db.query(User).filter(User.cpf == user_in.cpf).first():
        raise HTTPException(status_code=400, detail="Este CPF já está cadastrado.")

    # Multi-tenant scoping
    target_tenant_id = current_user.tenant_id
    if current_user.role_id == "super_admin" and user_in.tenant_id:
        target_tenant_id = user_in.tenant_id

    db_user = User(
        tenant_id=target_tenant_id,
        condominium_id=user_in.condominium_id,
        name=user_in.name,
        email=user_in.email,
        phone=user_in.phone,
        cpf=user_in.cpf,
        password_hash=get_password_hash(user_in.password),
        role_id=user_in.role_id,
        status="active"  # Created directly by admin, so it's active
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.get("/", response_model=List[UserResponse])
def list_users(
    condominium_id: Optional[UUID] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(User)
    
    if current_user.role_id != "super_admin":
        query = query.filter(User.tenant_id == current_user.tenant_id)
        
    if condominium_id:
        query = query.filter(User.condominium_id == condominium_id)
        
    if status:
        query = query.filter(User.status == status)
        
    return query.all()

@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: UUID,
    user_in: UserUpdate,
    current_user: User = Depends(PermissionChecker(["users:manage"])),
    db: Session = Depends(get_db)
):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        
    enforce_tenant(db_user.tenant_id, current_user)
    
    update_data = user_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_user, field, value)
        
    db.commit()
    db.refresh(db_user)
    return db_user

@router.put("/{user_id}/approve", response_model=UserResponse)
def approve_user(
    user_id: UUID,
    current_user: User = Depends(PermissionChecker(["users:manage"])),
    db: Session = Depends(get_db)
):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        
    enforce_tenant(db_user.tenant_id, current_user)
    
    db_user.status = "active"
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    current_user: User = Depends(PermissionChecker(["users:manage"])),
    db: Session = Depends(get_db)
):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        
    enforce_tenant(db_user.tenant_id, current_user)
    
    db.delete(db_user)
    db.commit()
    return
