from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel

from app.db.session import get_db
from app.models.all_models import Event, Camera, User, Vehicle, Condominium, Invoice, Plan, EventImage, EventVideo, Notification, VehicleMonitoring
from app.schemas.schemas import EventResponse, EventCreate, EventResolve
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant
from app.services.storage import storage_service

router = APIRouter()

@router.post("/{event_id}/media", status_code=status.HTTP_200_OK)
def upload_event_media(
    event_id: UUID,
    image: UploadFile = File(...),
    video: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento não encontrado.")

    # Generate unique keys for MinIO
    img_key = f"{event_id}/alert_frame.jpg"
    vid_key = f"{event_id}/occurrence.mp4"

    # Upload to MinIO
    try:
        image_url = storage_service.upload_fileobj(image.file, "sentinel-alerts", img_key, "image/jpeg")
        video_url = storage_service.upload_fileobj(video.file, "sentinel-alerts", vid_key, "video/mp4")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar mídias no MinIO: {str(e)}")

    # Save to Database EventImage and EventVideo
    db_image = EventImage(
        event_id=event_id,
        image_url=image_url,
        is_alert_frame=True
    )
    db_video = EventVideo(
        event_id=event_id,
        video_url=video_url,
        duration_seconds=5
    )
    db.add(db_image)
    db.add(db_video)
    db.commit()

    return {"status": "success", "image_url": image_url, "video_url": video_url}

@router.get("/media/{bucket}/{key:path}")
def get_event_media(bucket: str, key: str, request: Request):
    try:
        # Get object metadata to retrieve total length and correct Content-Type
        try:
            meta = storage_service.s3_client.head_object(Bucket=bucket, Key=key)
            total_size = meta.get("ContentLength", 0)
            content_type = meta.get("ContentType", "application/octet-stream")
        except Exception as head_err:
            print(f"[STORAGE] Error heading object {key}: {head_err}")
            raise HTTPException(status_code=404, detail="Mídia não encontrada.")

        range_header = request.headers.get("range")
        
        if not range_header:
            # No range request, serve full file
            body, _ = storage_service.get_fileobj(bucket, key)
            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(total_size)
            }
            return StreamingResponse(body, media_type=content_type, headers=headers)

        # Parse range header: e.g. "bytes=0-1000" or "bytes=123-"
        try:
            h_range = range_header.replace("bytes=", "")
            parts = h_range.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if len(parts) > 1 and parts[1] else total_size - 1
            if end >= total_size:
                end = total_size - 1
            if start > end:
                start = end
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid Range header.")

        chunk_size = end - start + 1
        
        # Get only the requested byte range from MinIO
        try:
            response = storage_service.s3_client.get_object(
                Bucket=bucket,
                Key=key,
                Range=f"bytes={start}-{end}"
            )
            body = response["Body"]
        except Exception as range_err:
            print(f"[STORAGE] Error getting range from object {key}: {range_err}")
            raise HTTPException(status_code=500, detail="Erro ao obter intervalo de mídia.")

        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size)
        }
        
        return StreamingResponse(
            body,
            status_code=206,
            media_type=content_type,
            headers=headers
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno de mídia: {str(e)}")

@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: EventCreate,
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == event_in.camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera associada não encontrada.")
        
    db_event = Event(
        tenant_id=camera.tenant_id,
        condominium_id=camera.condominium_id,
        camera_id=event_in.camera_id,
        track_id=event_in.track_id,
        object_type=event_in.object_type,
        event_type=event_in.event_type,
        risk_score=event_in.risk_score,
        risk_level=event_in.risk_level,
        details=event_in.details,
        is_resolved=False
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    # Identify resident owner for push notifications
    details = db_event.details or {}
    plate = details.get("plate")
    vehicle_id = details.get("vehicle_id")
    monitoring_id = details.get("monitoring_id")

    user_id = None
    if monitoring_id:
        try:
            monitoring_uuid = UUID(str(monitoring_id))
            monitoring = db.query(VehicleMonitoring).filter(VehicleMonitoring.id == monitoring_uuid).first()
            if monitoring:
                user_id = monitoring.user_id
        except ValueError:
            pass
    
    if not user_id and vehicle_id:
        try:
            vehicle_uuid = UUID(str(vehicle_id))
            vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_uuid).first()
            if vehicle:
                user_id = vehicle.owner_id
        except ValueError:
            pass
            
    if not user_id and plate:
        vehicle = db.query(Vehicle).filter(Vehicle.plate == plate).first()
        if vehicle:
            user_id = vehicle.owner_id

    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            msg = details.get("message") or f"Ocorrência de segurança registrada: {db_event.event_type}!"
            db_notif = Notification(
                tenant_id=db_event.tenant_id,
                condominium_id=db_event.condominium_id,
                user_id=user_id,
                event_id=db_event.id,
                channel="push",
                destination=user.email,
                title=db_event.event_type,
                message=msg,
                status="sent"
            )
            db.add(db_notif)
            db.commit()
            print(f"[NOTIFY] Resident {user.name} ({user_id}) notified for event {db_event.id}")
    else:
        # If no user_id (e.g. virtual monitoring), notify all admin_condominio/administradora/operador users in this condo/tenant
        admins = db.query(User).filter(
            User.tenant_id == db_event.tenant_id,
            or_(
                User.condominium_id == db_event.condominium_id,
                User.condominium_id == None
            ),
            User.role_id.in_(["admin_condominio", "administradora", "operador"])
        ).all()
        for admin in admins:
            msg = details.get("message") or f"Ocorrência de segurança registrada: {db_event.event_type}!"
            db_notif = Notification(
                tenant_id=db_event.tenant_id,
                condominium_id=db_event.condominium_id,
                user_id=admin.id,
                event_id=db_event.id,
                channel="push",
                destination=admin.email,
                title=db_event.event_type,
                message=msg,
                status="sent"
            )
            db.add(db_notif)
        db.commit()
        print(f"[NOTIFY] {len(admins)} Admins notified for event {db_event.id}")

    return db_event

@router.get("/", response_model=List[EventResponse])
def list_events(
    camera_id: Optional[UUID] = None,
    risk_level: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Event)
    
    if current_user.role_id == "morador":
        # Residents only see events linked to their own registered vehicles or active monitorings
        user_vehicles = db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).all()
        user_plates = [v.plate for v in user_vehicles if v.plate]
        user_vehicle_ids = [str(v.id) for v in user_vehicles]
        
        user_monitorings = db.query(VehicleMonitoring).filter(VehicleMonitoring.user_id == current_user.id).all()
        user_monitoring_ids = [str(m.id) for m in user_monitorings]
        
        conditions = []
        for plate in user_plates:
            conditions.append(Event.details['plate'].astext == plate)
            conditions.append(Event.details['plate'].astext == plate.upper())
            conditions.append(Event.details['plate'].astext == plate.lower())
        for v_id in user_vehicle_ids:
            conditions.append(Event.details['vehicle_id'].astext == v_id)
        for m_id in user_monitoring_ids:
            conditions.append(Event.details['monitoring_id'].astext == m_id)
            
        if conditions:
            query = query.filter(Event.condominium_id == current_user.condominium_id).filter(or_(*conditions))
        else:
            return []
    elif current_user.role_id != "super_admin":
        query = query.filter(Event.tenant_id == current_user.tenant_id)
        
    if camera_id:
        query = query.filter(Event.camera_id == camera_id)
        
    if risk_level:
        query = query.filter(Event.risk_level == risk_level)
        
    return query.order_by(Event.created_at.desc()).limit(100).all()

@router.get("/{event_id}", response_model=EventResponse)
def get_event(
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
        
    if current_user.role_id == "morador":
        if event.condominium_id != current_user.condominium_id:
            raise HTTPException(status_code=403, detail="Acesso negado.")
    elif current_user.role_id != "super_admin":
        if event.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=403, detail="Acesso negado.")
            
    return event

@router.put("/{event_id}/resolve", response_model=EventResponse)
def resolve_event(
    event_id: UUID,
    resolve_in: EventResolve,
    current_user: User = Depends(PermissionChecker(["events:resolve"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
        
    enforce_tenant(event.tenant_id, current_user)
    
    event.is_resolved = True
    event.resolved_by = current_user.id
    event.resolution_notes = resolve_in.resolution_notes
    event.resolved_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(event)
    return event

class BulkDeleteRequest(BaseModel):
    event_ids: List[UUID] = []
    delete_all: bool = False

@router.post("/delete-bulk", status_code=status.HTTP_200_OK)
def delete_events_bulk(
    req: BulkDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Event)
    
    if current_user.role_id == "morador":
        user_vehicles = db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).all()
        user_plates = [v.plate for v in user_vehicles if v.plate]
        user_vehicle_ids = [str(v.id) for v in user_vehicles]
        
        user_monitorings = db.query(VehicleMonitoring).filter(VehicleMonitoring.user_id == current_user.id).all()
        user_monitoring_ids = [str(m.id) for m in user_monitorings]
        
        conditions = []
        for plate in user_plates:
            conditions.append(Event.details['plate'].astext == plate)
            conditions.append(Event.details['plate'].astext == plate.upper())
            conditions.append(Event.details['plate'].astext == plate.lower())
        for v_id in user_vehicle_ids:
            conditions.append(Event.details['vehicle_id'].astext == v_id)
        for m_id in user_monitoring_ids:
            conditions.append(Event.details['monitoring_id'].astext == m_id)
            
        if conditions:
            query = query.filter(Event.condominium_id == current_user.condominium_id).filter(or_(*conditions))
        else:
            return {"status": "success", "deleted_count": 0}
    elif current_user.role_id != "super_admin":
        query = query.filter(Event.tenant_id == current_user.tenant_id)

    if not req.delete_all:
        if not req.event_ids:
            return {"status": "success", "deleted_count": 0}
        query = query.filter(Event.id.in_(req.event_ids))

    events_to_delete = query.all()
    deleted_count = 0

    for event in events_to_delete:
        for img in event.images:
            url_parts = img.image_url.split("/sentinel-alerts/")
            if len(url_parts) > 1:
                key = url_parts[1]
                storage_service.delete_fileobj("sentinel-alerts", key)

        for vid in event.videos:
            url_parts = vid.video_url.split("/sentinel-alerts/")
            if len(url_parts) > 1:
                key = url_parts[1]
                storage_service.delete_fileobj("sentinel-alerts", key)

        db.query(Notification).filter(Notification.event_id == event.id).delete()
        db.delete(event)
        deleted_count += 1

    db.commit()
    return {"status": "success", "deleted_count": deleted_count}

@router.get("/dashboard/stats")
def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    role = current_user.role_id
    
    if role == "super_admin":
        # SUPER ADMIN STATS
        active_condos = db.query(Condominium).filter(Condominium.status == "active").count()
        total_users = db.query(User).count()
        total_cameras = db.query(Camera).count()
        total_events = db.query(Event).count()
        
        # Monthly Revenue (Sum of paid invoices this month)
        start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        revenue_cents = db.query(func.sum(Invoice.amount_cents)).filter(
            Invoice.status == "paid",
            Invoice.paid_at >= start_of_month
        ).scalar() or 0
        
        return {
            "condos_count": active_condos,
            "users_count": total_users,
            "cameras_count": total_cameras,
            "events_count": total_events,
            "monthly_revenue_brl": round(revenue_cents / 100, 2)
        }
        
    elif role in ["administradora", "admin_condominio", "operador"]:
        # ADMIN / OPERATOR STATS
        cameras = db.query(Camera).filter(Camera.tenant_id == current_user.tenant_id).all()
        cameras_online = sum(1 for c in cameras if c.status == "online")
        cameras_offline = sum(1 for c in cameras if c.status == "offline")
        
        total_users = db.query(User).filter(User.tenant_id == current_user.tenant_id).count()
        total_vehicles = db.query(Vehicle).filter(Vehicle.tenant_id == current_user.tenant_id).count()
        total_events = db.query(Event).filter(Event.tenant_id == current_user.tenant_id).count()
        critical_events = db.query(Event).filter(
            Event.tenant_id == current_user.tenant_id,
            Event.risk_level == "critical",
            Event.is_resolved == False
        ).count()
        
        return {
            "cameras_online": cameras_online,
            "cameras_offline": cameras_offline,
            "users_count": total_users,
            "vehicles_count": total_vehicles,
            "events_count": total_events,
            "critical_unresolved_count": critical_events
        }
        
    elif role == "morador":
        # MORADOR STATS
        own_vehicles = db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).count()
        
        # Events related to their condominium
        total_events = db.query(Event).filter(
            Event.condominium_id == current_user.condominium_id
        ).count()
        
        # Specific alerts (e.g. plate detection matches or high risk alerts)
        critical_alerts = db.query(Event).filter(
            Event.condominium_id == current_user.condominium_id,
            Event.risk_level.in_(["high", "critical"])
        ).count()
        
        return {
            "vehicles_count": own_vehicles,
            "events_count": total_events,
            "critical_alerts_count": critical_alerts
        }
        
    raise HTTPException(status_code=400, detail="Papel não suportado para estatísticas.")

@router.post("/test-notification/{user_id}", response_model=EventResponse)
def trigger_test_notification(
    user_id: UUID,
    current_user: User = Depends(PermissionChecker(["users:manage"])),
    db: Session = Depends(get_db)
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    
    # Check if there is a vehicle for this user to get plate info
    vehicle = db.query(Vehicle).filter(Vehicle.owner_id == user_id).first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O usuário precisa ter pelo menos um veículo cadastrado para receber o teste de alerta."
        )
    plate = vehicle.plate
    
    # We need a camera for this event. Let's find any camera in the user's condominium.
    from app.models.all_models import Camera
    camera = None
    if target_user.condominium_id:
        camera = db.query(Camera).filter(Camera.condominium_id == target_user.condominium_id).first()
    if not camera:
        camera = db.query(Camera).filter(Camera.tenant_id == target_user.tenant_id).first()
    if not camera:
        camera = db.query(Camera).first()
        
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Nenhuma câmera cadastrada no sistema para vincular o evento de teste."
        )

    db_event = Event(
        tenant_id=target_user.tenant_id,
        condominium_id=target_user.condominium_id or camera.condominium_id,
        camera_id=camera.id,
        track_id=0,
        object_type="car",
        event_type="Veículo fora da vaga monitorada",
        risk_score=100,
        risk_level="critical",
        details={
            "message": f"[TESTE] Alerta de Simulação! O veículo de placa {plate} foi removido ou saiu da vaga monitorada!",
            "plate": plate,
            "vehicle_id": str(vehicle.id),
            "is_test": True
        },
        is_resolved=False
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    # Create push notification
    from app.models.all_models import Notification
    db_notif = Notification(
        tenant_id=db_event.tenant_id,
        condominium_id=db_event.condominium_id,
        user_id=target_user.id,
        event_id=db_event.id,
        channel="push",
        destination=target_user.email,
        title=db_event.event_type,
        message=db_event.details["message"],
        status="sent"
    )
    db.add(db_notif)
    db.commit()
    
    print(f"[TEST-NOTIFY] Admin triggered test event {db_event.id} for user {target_user.name}")
    return db_event

