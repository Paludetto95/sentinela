from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.models.all_models import Camera, CameraZone, User, CameraFalsePositive
from app.schemas.schemas import CameraCreate, CameraResponse, ZoneCreate, ZoneResponse, FalsePositiveCreate, FalsePositiveResponse
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant
from app.services.mediamtx import mediamtx_service

router = APIRouter()

@router.post("/", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
def create_camera(
    camera_in: CameraCreate,
    current_user: User = Depends(PermissionChecker(["cameras:manage"])),
    db: Session = Depends(get_db)
):
    print("DEBUG: Entrou em create_camera")
    print(f"DEBUG: Dados de entrada: {camera_in.model_dump()}")
    print(f"DEBUG: Usuário atual: {current_user.name}, condo_id: {current_user.condominium_id}, tenant_id: {current_user.tenant_id}")
    
    try:
        if camera_in.condominium_id:
            from app.models.all_models import Condominium
            condo = db.query(Condominium).filter(Condominium.id == camera_in.condominium_id).first()
            if not condo:
                raise HTTPException(status_code=404, detail="Condomínio selecionado não existe.")
            
            # Enforce tenant isolation for non-super_admins
            if current_user.role_id != "super_admin" and condo.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=403, detail="Você não tem permissão para cadastrar câmera neste condomínio.")
            
            condo_id = condo.id
            tenant_id = condo.tenant_id
            print(f"DEBUG: Usando condo_id selecionado: {condo_id}, tenant_id: {tenant_id}")
        else:
            condo_id = current_user.condominium_id
            tenant_id = current_user.tenant_id
            if not condo_id:
                print("DEBUG: condominium_id está nulo, tentando buscar ou criar...")
                from app.models.all_models import Condominium
                first_condo = db.query(Condominium).filter(Condominium.tenant_id == current_user.tenant_id).first()
                if not first_condo:
                    print("DEBUG: Nenhum condomínio encontrado. Tentando auto-criar...")
                    from datetime import datetime, timezone
                    first_condo = Condominium(
                        tenant_id=current_user.tenant_id,
                        name=f"Condomínio {current_user.name}",
                        cnpj=f"00.000.000/0001-{int(datetime.now(timezone.utc).timestamp()) % 100:02d}",
                        address="Endereço Padrão",
                        city="Cidade Padrão",
                        state="SP",
                        cep="00000-000",
                        email=current_user.email
                    )
                    db.add(first_condo)
                    db.commit()
                    db.refresh(first_condo)
                    print(f"DEBUG: Condomínio auto-criado com sucesso: {first_condo.id}")
                    
                    # Associate current user
                    current_user.condominium_id = first_condo.id
                    db.commit()
                    db.refresh(current_user)
                    print("DEBUG: Usuário associado ao condomínio auto-criado")
                    
                condo_id = first_condo.id
                print(f"DEBUG: Usando condo_id: {condo_id}")

        # Normalize the URL scheme to lowercase (e.g. Http:// -> http://, Rtsp:// -> rtsp://)
        raw_url = camera_in.rtsp_url.strip() if camera_in.rtsp_url else ""
        import re
        match = re.match(r'^([a-zA-Z0-9\+\-\.]+)(://.*)$', raw_url)
        normalized_url = match.group(1).lower() + match.group(2) if match else raw_url

        db_camera = Camera(
            tenant_id=tenant_id,
            condominium_id=condo_id,
            name=camera_in.name,
            description=camera_in.description,
            rtsp_url=normalized_url,
            location_name=camera_in.location_name,
            latitude=camera_in.latitude,
            longitude=camera_in.longitude,
            status="offline"
        )
        db.add(db_camera)
        db.commit()
        db.refresh(db_camera)
        print(f"DEBUG: Câmera salva no banco de dados com ID: {db_camera.id}")
        
        # Sync with MediaMTX using the camera ID as path name (only for non-HTTP streams)
        sync_result = True
        if not (db_camera.rtsp_url.lower().startswith("http://") or db_camera.rtsp_url.lower().startswith("https://")):
            print("DEBUG: Sincronizando com MediaMTX...")
            sync_result = mediamtx_service.add_path(str(db_camera.id), db_camera.rtsp_url)
            print(f"DEBUG: Resultado de sincronização MediaMTX: {sync_result}")
        
        return db_camera
    except Exception as e:
        import traceback
        print("DEBUG: Ocorreu uma exceção no cadastro de câmera:")
        traceback.print_exc()
        raise e

@router.get("/", response_model=List[CameraResponse])
def list_cameras(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Residents can see cameras in their condominium
    if current_user.role_id == "morador":
        return db.query(Camera).filter(Camera.condominium_id == current_user.condominium_id).all()
        
    query = db.query(Camera)
    if current_user.role_id != "super_admin":
        query = query.filter(Camera.tenant_id == current_user.tenant_id)
        
    return query.all()

@router.get("/{camera_id}", response_model=CameraResponse)
def get_camera(
    camera_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    enforce_tenant(camera.tenant_id, current_user)
    return camera

@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(
    camera_id: UUID,
    current_user: User = Depends(PermissionChecker(["cameras:manage"])),
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    enforce_tenant(camera.tenant_id, current_user)
    
    # Remove from MediaMTX configuration
    mediamtx_service.remove_path(str(camera.id))
    
    db.delete(camera)
    db.commit()
    return

@router.post("/{camera_id}/test")
def test_camera_connection(
    camera_id: UUID,
    current_user: User = Depends(PermissionChecker(["cameras:manage"])),
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    enforce_tenant(camera.tenant_id, current_user)
    
    is_online = mediamtx_service.test_rtsp_connection(camera.rtsp_url)
    camera.status = "online" if is_online else "offline"
    db.commit()
    
    return {"status": camera.status}

def gen_frames(rtsp_url: str, camera_id: str = None):
    import cv2
    import time
    import requests
    import numpy as np
    import os
    import redis

    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    r_client = None
    if camera_id:
        try:
            r_client = redis.from_url(redis_url)
        except Exception:
            pass

    url_str = str(rtsp_url).strip()
    is_numeric = url_str.isdigit()
    source = int(url_str) if is_numeric else url_str

    def get_placeholder(text: str):
        # Create a black image
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        font = cv2.FONT_HERSHEY_SIMPLEX
        
        # Draw red title text
        cv2.putText(img, text, (50, 200), font, 1.0, (0, 0, 255), 2, cv2.LINE_AA)
        
        # Draw subtext with truncated camera source
        display_src = url_str if len(url_str) <= 45 else f"{url_str[:42]}..."
        cv2.putText(img, f"Origem: {display_src}", (50, 240), font, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        
        # Draw live date/time
        current_time = time.strftime("%d/%m/%Y %H:%M:%S")
        cv2.putText(img, f"Hora local: {current_time}", (50, 280), font, 0.6, (150, 150, 150), 1, cv2.LINE_AA)
        
        ret, buf = cv2.imencode('.jpg', img)
        if ret:
            return buf.tobytes()
        return b''

    # Method 0: If we have a camera_id, we ONLY consume from Redis to avoid competing with AI Engine
    if camera_id and r_client is not None:
        print(f"[STREAM] Camera {camera_id} streaming via Redis buffer only.")
        while True:
            frame_bytes = None
            success = False
            try:
                frame_bytes = r_client.get(f"camera:{camera_id}:frame")
                if frame_bytes:
                    success = True
            except Exception as e:
                print(f"[STREAM] Redis read error: {e}")
                
            if success and frame_bytes:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                # Limit loop to ~25 FPS
                time.sleep(0.04)
            else:
                placeholder_bytes = get_placeholder("Sem Sinal / Aguardando AI Engine")
                if placeholder_bytes:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + placeholder_bytes + b'\r\n')
                time.sleep(1.0)
        return

    # Fallback for standalone direct streaming (when camera_id is not provided)
    # Force FFmpeg to disable buffering, reduce probing time and use TCP for low latency
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "rtsp_transport;tcp;fflags;nobuffer;flags;low_delay;max_delay;500000;analyzeduration;100000;probesize;100000"
    )

    is_http_video = False
    if not is_numeric and (url_str.lower().startswith("http://") or url_str.lower().startswith("https://")):
        lower_url = url_str.lower()
        if any(k in lower_url for k in ["/video", "/mjpeg", "mjpg", "/stream", "cgi-bin"]) or not any(lower_url.endswith(ext) for ext in [".jpg", ".jpeg", ".png"]):
            is_http_video = True
            
    cap = None
    
    # Check if we should initialize VideoCapture initially
    if is_numeric or is_http_video or not (url_str.lower().startswith("http://") or url_str.lower().startswith("https://")):
        try:
            if is_numeric:
                cap = cv2.VideoCapture(source)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            else:
                cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception as e:
            print(f"[STREAM] Failed to initialize VideoCapture for {url_str}: {e}")
            cap = None

    while True:
        frame_bytes = None
        success = False
        
        # Method 1: Try reading from OpenCV if it is open
        if cap is not None and cap.isOpened():
            try:
                success, frame = cap.read()
                if success and frame is not None and frame.size > 0:
                    ret, buffer = cv2.imencode('.jpg', frame)
                    if ret:
                        frame_bytes = buffer.tobytes()
                else:
                    success = False
                    cap.release()
                    cap = None
            except Exception as e:
                print(f"[STREAM] Error reading frame from VideoCapture: {e}")
                success = False
                if cap is not None:
                    cap.release()
                cap = None
                
        # Method 2: Fallback for HTTP/HTTPS static images (IP webcams returning raw JPEGs)
        if not success and not is_numeric and (url_str.lower().startswith("http://") or url_str.lower().startswith("https://")):
            try:
                response = requests.get(url_str, timeout=2.0)
                if response.status_code == 200:
                    ct = response.headers.get('content-type', '').lower()
                    if ct.startswith('image/') or response.content.startswith(b'\xff\xd8'):
                        frame_bytes = response.content
                        success = True
            except Exception:
                pass
                
            if not success and cap is None:
                try:
                    cap = cv2.VideoCapture(url_str)
                    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    if cap.isOpened():
                        success, frame = cap.read()
                        if success and frame is not None and frame.size > 0:
                            ret, buffer = cv2.imencode('.jpg', frame)
                            if ret:
                                frame_bytes = buffer.tobytes()
                        else:
                            success = False
                            cap.release()
                            cap = None
                except Exception:
                    cap = None

        if success and frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            if cap is None:
                time.sleep(0.2)
            else:
                time.sleep(0.001)
        else:
            placeholder_bytes = get_placeholder("Sem Sinal / Conexao Falhou")
            if placeholder_bytes:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + placeholder_bytes + b'\r\n')
            
            time.sleep(2.0)
            
            if cap is None:
                try:
                    if is_numeric:
                        cap = cv2.VideoCapture(source)
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    else:
                        cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
                        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                except Exception:
                    cap = None

    if cap is not None:
        cap.release()

    if cap is not None:
        cap.release()

@router.get("/{camera_id}/stream")
def stream_camera_fallback(
    camera_id: UUID,
    token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Exposes a fallback MJPEG stream for browsers to bypass WebRTC/codec compatibility issues.
    Allows streaming H.265, MJPEG, network webcam streams decoded server-side via OpenCV/FFmpeg.
    """
    if token:
        try:
            from jose import jwt
            from app.core.config import settings
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.ALGORITHM])
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=403, detail="Token inválido.")
        except Exception:
            raise HTTPException(status_code=403, detail="Não foi possível validar as credenciais.")
    
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        gen_frames(camera.rtsp_url, str(camera.id)),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/{camera_id}/detections")
def get_camera_detections(
    camera_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Retrieves the latest vehicle detections (normalized coordinates) from Redis.
    """
    import redis
    import json
    import os
    
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    try:
        r = redis.from_url(redis_url)
        data = r.get(f"camera:{camera_id}:detections")
        if data:
            return json.loads(data)
        return []
    except Exception as e:
        print(f"Redis detection read error: {e}")
        return []

# --- ZONES MANAGEMENT ---

@router.post("/{camera_id}/zones", response_model=ZoneResponse)
def create_camera_zone(
    camera_id: UUID,
    zone_in: ZoneCreate,
    current_user: User = Depends(PermissionChecker(["camera_zones:manage"])),
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    enforce_tenant(camera.tenant_id, current_user)
    
    db_zone = CameraZone(
        camera_id=camera_id,
        name=zone_in.name,
        zone_type=zone_in.zone_type,
        coordinates=zone_in.coordinates,
        risk_multiplier=zone_in.risk_multiplier
    )
    db.add(db_zone)
    db.commit()
    db.refresh(db_zone)
    return db_zone

@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera_zone(
    zone_id: UUID,
    current_user: User = Depends(PermissionChecker(["camera_zones:manage"])),
    db: Session = Depends(get_db)
):
    zone = db.query(CameraZone).filter(CameraZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona não encontrada.")
        
    camera = db.query(Camera).filter(Camera.id == zone.camera_id).first()
    enforce_tenant(camera.tenant_id, current_user)
    
    db.delete(zone)
    db.commit()
    return

# --- FALSE POSITIVES MANAGEMENT ---

@router.post("/{camera_id}/false-positives", response_model=FalsePositiveResponse, status_code=status.HTTP_201_CREATED)
def create_camera_false_positive(
    camera_id: UUID,
    fp_in: FalsePositiveCreate,
    current_user: User = Depends(PermissionChecker(["camera_zones:manage"])),
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Câmera não encontrada.")
        
    enforce_tenant(camera.tenant_id, current_user)
    
    db_fp = CameraFalsePositive(
        camera_id=camera_id,
        obj_type=fp_in.obj_type,
        coordinates=fp_in.coordinates
    )
    db.add(db_fp)
    db.commit()
    db.refresh(db_fp)
    return db_fp

@router.delete("/false-positives/{fp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera_false_positive(
    fp_id: UUID,
    current_user: User = Depends(PermissionChecker(["camera_zones:manage"])),
    db: Session = Depends(get_db)
):
    fp = db.query(CameraFalsePositive).filter(CameraFalsePositive.id == fp_id).first()
    if not fp:
        raise HTTPException(status_code=404, detail="Falso positivo não encontrado.")
        
    camera = db.query(Camera).filter(Camera.id == fp.camera_id).first()
    enforce_tenant(camera.tenant_id, current_user)
    
    db.delete(fp)
    db.commit()
    return

@router.post("/{camera_id}/whip")
async def whip_proxy(
    camera_id: UUID,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Proxy for WHIP signaling (webcam publishing).
    """
    sdp_offer = await request.body()
    import requests
    mediamtx_url = f"http://mediamtx:8889/{camera_id}/whip"
    try:
        response = requests.post(
            mediamtx_url,
            data=sdp_offer,
            headers={"Content-Type": "application/sdp"},
            timeout=5.0
        )
        return Response(
            content=response.content,
            media_type="application/sdp",
            status_code=response.status_code
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error proxying WHIP handshake: {str(e)}")

@router.post("/{camera_id}/whep")
async def whep_proxy(
    camera_id: UUID,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Proxy for WHEP signaling (WebRTC playback).
    """
    sdp_offer = await request.body()
    import requests
    mediamtx_url = f"http://mediamtx:8889/{camera_id}/whep"
    try:
        response = requests.post(
            mediamtx_url,
            data=sdp_offer,
            headers={"Content-Type": "application/sdp"},
            timeout=5.0
        )
        return Response(
            content=response.content,
            media_type="application/sdp",
            status_code=response.status_code
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error proxying WHEP handshake: {str(e)}")

