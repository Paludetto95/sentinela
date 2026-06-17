from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.models.all_models import VehicleMonitoring, User, Vehicle
from app.schemas.schemas import VehicleMonitoringCreate, VehicleMonitoringResponse
from app.api.deps import get_current_user

router = APIRouter()

@router.post("/", response_model=VehicleMonitoringResponse, status_code=status.HTTP_201_CREATED)
def create_monitoring(
    monitoring_in: VehicleMonitoringCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify vehicle exists
    vehicle = db.query(Vehicle).filter(Vehicle.id == monitoring_in.vehicle_id).first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Veículo não encontrado."
        )

    # Permission checks:
    # 1. Super admin can monitor any vehicle.
    # 2. Others must share the same tenant.
    if current_user.role_id != "super_admin" and vehicle.tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você não tem permissão para monitorar este veículo."
        )

    # 3. Residents (morador) can monitor any vehicle in their condominium
    if current_user.role_id == "morador" and vehicle.condominium_id != current_user.condominium_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você só pode monitorar veículos cadastrados no seu condomínio."
        )

    # Disable any existing active monitoring for this same vehicle to avoid duplicates
    db.query(VehicleMonitoring).filter(
        VehicleMonitoring.vehicle_id == monitoring_in.vehicle_id,
        VehicleMonitoring.is_active == True
    ).update({"is_active": False})
    db.commit()

    db_monitoring = VehicleMonitoring(
        user_id=current_user.id,
        vehicle_id=monitoring_in.vehicle_id,
        camera_id=monitoring_in.camera_id,
        coordinates=monitoring_in.coordinates,
        is_active=True
    )
    db.add(db_monitoring)
    db.commit()
    db.refresh(db_monitoring)
    return db_monitoring

@router.get("/", response_model=List[VehicleMonitoringResponse])
def list_monitorings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Super admins see everything
    if current_user.role_id == "super_admin":
        return db.query(VehicleMonitoring).all()
        
    # Condominium admins or managers see all monitorings within their condominium
    elif current_user.role_id in ["administradora", "admin_condominio"]:
        from app.models.all_models import User as UserModel
        # Get all user IDs belonging to this condominium
        condo_users = db.query(UserModel.id).filter(UserModel.condominium_id == current_user.condominium_id).all()
        user_ids = [u[0] for u in condo_users]
        return db.query(VehicleMonitoring).filter(VehicleMonitoring.user_id.in_(user_ids)).all()
        
    # Residents see only their own monitorings
    return db.query(VehicleMonitoring).filter(VehicleMonitoring.user_id == current_user.id).all()

@router.put("/{monitoring_id}/toggle", response_model=VehicleMonitoringResponse)
def toggle_monitoring(
    monitoring_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    monitoring = db.query(VehicleMonitoring).filter(VehicleMonitoring.id == monitoring_id).first()
    if not monitoring:
        raise HTTPException(status_code=404, detail="Monitoramento não encontrado.")
        
    if monitoring.user_id != current_user.id and current_user.role_id != "super_admin":
        raise HTTPException(status_code=403, detail="Você não tem permissão para alterar este monitoramento.")
        
    monitoring.is_active = not monitoring.is_active
    db.commit()
    db.refresh(monitoring)
    return monitoring

@router.delete("/{monitoring_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_monitoring(
    monitoring_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    monitoring = db.query(VehicleMonitoring).filter(VehicleMonitoring.id == monitoring_id).first()
    if not monitoring:
        raise HTTPException(status_code=404, detail="Monitoramento não encontrado.")
        
    if monitoring.user_id != current_user.id and current_user.role_id != "super_admin":
        raise HTTPException(status_code=403, detail="Você não tem permissão para remover este monitoramento.")
        
    db.delete(monitoring)
    db.commit()
    return
