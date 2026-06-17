from sqlalchemy.orm import Session
from app.db.session import Base, engine
from app.models.all_models import Role, Permission, Plan

# Import models to ensure they are registered with Base.metadata
import app.models.all_models  # noqa

def init_db(db: Session) -> None:
    # 1. Create tables if they do not exist
    Base.metadata.create_all(bind=engine)
    
    # 2. Seed Permissions
    permissions_list = [
        # Tenants
        {"id": "tenants:manage", "name": "Gerenciar Tenants", "description": "Criar, editar e suspender tenants de condomínios"},
        # Condominiums
        {"id": "condos:create", "name": "Criar Condomínios", "description": "Cadastrar novos condomínios no sistema"},
        {"id": "condos:read", "name": "Visualizar Condomínios", "description": "Visualizar informações de condomínios"},
        {"id": "condos:delete", "name": "Excluir Condomínios", "description": "Remover condomínios do sistema"},
        # Users
        {"id": "users:manage", "name": "Gerenciar Usuários", "description": "Cadastrar e editar usuários de todos os níveis"},
        # Vehicles
        {"id": "vehicles:manage", "name": "Gerenciar Veículos", "description": "Cadastrar, autorizar e remover veículos"},
        {"id": "vehicles:read_own", "name": "Visualizar Veículos Próprios", "description": "Visualizar apenas os próprios veículos cadastrados"},
        # Cameras
        {"id": "cameras:manage", "name": "Gerenciar Câmeras", "description": "Adicionar, editar e remover câmeras e fluxos RTSP"},
        {"id": "camera_zones:manage", "name": "Gerenciar Zonas", "description": "Desenhar e salvar polígonos de zonas de risco"},
        # Live Streams
        {"id": "live_stream:view", "name": "Visualizar Transmissão", "description": "Assistir transmissão de câmeras autorizadas ao vivo"},
        # Events & Alerts
        {"id": "events:read", "name": "Visualizar Eventos", "description": "Ler histórico de eventos e ocorrências"},
        {"id": "events:resolve", "name": "Resolver Alertas", "description": "Marcar alertas como resolvidos e registrar notas de ocorrência"},
        # Billing
        {"id": "billing:manage", "name": "Gerenciar Assinatura e Faturamento", "description": "Visualizar faturas e atualizar planos"}
    ]

    for p_data in permissions_list:
        p = db.query(Permission).filter(Permission.id == p_data["id"]).first()
        if not p:
            p = Permission(**p_data)
            db.add(p)
    db.commit()

    # 3. Seed Roles
    roles_list = [
        {
            "id": "super_admin", 
            "name": "Super Admin", 
            "description": "Acesso total a todas as funcionalidades de todos os tenants",
            "permissions": [p["id"] for p in permissions_list]
        },
        {
            "id": "administradora", 
            "name": "Administradora", 
            "description": "Administra múltiplos condomínios",
            "permissions": [
                "condos:create", "condos:read", "users:manage", "vehicles:manage", 
                "cameras:manage", "camera_zones:manage", "live_stream:view", "events:read", 
                "events:resolve", "billing:manage"
            ]
        },
        {
            "id": "admin_condominio", 
            "name": "Administrador do Condomínio", 
            "description": "Administrador local de um único condomínio (Síndico)",
            "permissions": [
                "condos:create", "condos:read", "users:manage", "vehicles:manage", 
                "cameras:manage", "camera_zones:manage", "live_stream:view", "events:read", 
                "events:resolve", "billing:manage"
            ]
        },
        {
            "id": "operador", 
            "name": "Operador / Portaria", 
            "description": "Operador da portaria ou central de monitoramento do condomínio",
            "permissions": [
                "condos:read", "live_stream:view", "events:read", "events:resolve"
            ]
        },
        {
            "id": "morador", 
            "name": "Morador", 
            "description": "Morador do condomínio",
            "permissions": [
                "vehicles:read_own", "live_stream:view", "events:read", "events:resolve"
            ]
        }
    ]

    for r_data in roles_list:
        r = db.query(Role).filter(Role.id == r_data["id"]).first()
        if not r:
            r = Role(id=r_data["id"], name=r_data["name"], description=r_data["description"])
            db.add(r)
        
        # Sync permissions
        r.permissions = []
        for p_id in r_data["permissions"]:
            perm = db.query(Permission).filter(Permission.id == p_id).first()
            if perm:
                r.permissions.append(perm)
    db.commit()

    # 4. Seed SaaS Plans
    plans_list = [
        {
            "name": "Starter",
            "max_cameras": 2,
            "video_retention_days": 7,
            "max_users": 5,
            "price_cents": 19900,
            "features": {"reid": False, "notifications": ["email", "push"], "risk_scoring": True}
        },
        {
            "name": "Professional",
            "max_cameras": 8,
            "video_retention_days": 15,
            "max_users": 30,
            "price_cents": 49900,
            "features": {"reid": True, "notifications": ["email", "push", "whatsapp"], "risk_scoring": True}
        },
        {
            "name": "Business",
            "max_cameras": 16,
            "video_retention_days": 30,
            "max_users": 100,
            "price_cents": 99900,
            "features": {"reid": True, "notifications": ["email", "push", "whatsapp", "sms"], "risk_scoring": True}
        },
        {
            "name": "Enterprise",
            "max_cameras": 999,
            "video_retention_days": 90,
            "max_users": 9999,
            "price_cents": 249900,
            "features": {"reid": True, "notifications": ["email", "push", "whatsapp", "sms"], "risk_scoring": True}
        }
    ]

    for p_data in plans_list:
        p = db.query(Plan).filter(Plan.name == p_data["name"]).first()
        if not p:
            p = Plan(**p_data)
            db.add(p)
    db.commit()
