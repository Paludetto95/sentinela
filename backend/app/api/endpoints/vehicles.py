from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.models.all_models import Vehicle, User
from app.schemas.schemas import VehicleCreate, VehicleResponse
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant

router = APIRouter()

@router.post("/", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    vehicle_in: VehicleCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Residents can only register their own vehicles
    owner_id = current_user.id
    condominium_id = current_user.condominium_id
    
    if current_user.role_id in ["super_admin", "administradora", "admin_condominio"]:
        if vehicle_in.owner_id:
            target_owner = db.query(User).filter(User.id == vehicle_in.owner_id).first()
            if not target_owner:
                raise HTTPException(status_code=404, detail="Proprietário não encontrado.")
            enforce_tenant(target_owner.tenant_id, current_user)
            owner_id = target_owner.id
            condominium_id = target_owner.condominium_id or condominium_id
            
    if not condominium_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O usuário deve estar associado a um condomínio para cadastrar um veículo."
        )

    # Check plate length and uniqueness if provided
    if vehicle_in.plate:
        if len(vehicle_in.plate) > 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A placa do veículo deve ter no máximo 10 caracteres (ex: GAE8546)."
            )
        existing = db.query(Vehicle).filter(Vehicle.plate == vehicle_in.plate.upper()).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Veículo com esta placa já está cadastrado."
            )

    db_vehicle = Vehicle(
        tenant_id=current_user.tenant_id,
        condominium_id=condominium_id,
        owner_id=owner_id,
        plate=vehicle_in.plate.upper() if vehicle_in.plate else None,
        brand=vehicle_in.brand,
        model=vehicle_in.model,
        year=vehicle_in.year,
        color=vehicle_in.color,
        nickname=vehicle_in.nickname,
        status="authorized"
    )
    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)
    return db_vehicle

@router.get("/", response_model=List[VehicleResponse])
def list_vehicles(
    condominium_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Residents can only see their own vehicles
    if current_user.role_id == "morador":
        return db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).all()
        
    query = db.query(Vehicle)
    if current_user.role_id != "super_admin":
        query = query.filter(Vehicle.tenant_id == current_user.tenant_id)
        
    if condominium_id:
        query = query.filter(Vehicle.condominium_id == condominium_id)
        
    return query.all()

@router.get("/{vehicle_id}", response_model=VehicleResponse)
def get_vehicle(
    vehicle_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado.")
        
    enforce_tenant(vehicle.tenant_id, current_user)
    
    # Resident security check
    if current_user.role_id == "morador" and vehicle.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado aos veículos de terceiros.")
        
    return vehicle

@router.put("/{vehicle_id}", response_model=VehicleResponse)
def update_vehicle(
    vehicle_id: UUID,
    vehicle_in: VehicleCreate,  # reusing model for updates
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado.")
        
    enforce_tenant(vehicle.tenant_id, current_user)
    
    # Check authorization to edit
    if current_user.role_id == "morador" and vehicle.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para editar este veículo.")

    update_data = vehicle_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "plate" and value:
            value = value.upper()
        setattr(vehicle, field, value)
        
    db.commit()
    db.refresh(vehicle)
    return vehicle

@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado.")
        
    enforce_tenant(vehicle.tenant_id, current_user)
    
    if current_user.role_id == "morador" and vehicle.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para excluir este veículo.")
        
    db.delete(vehicle)
    db.commit()
    return
