from typing import Generator, List
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.all_models import User, Role, Permission

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login"
)

class TokenPayload(BaseModel):
    sub: str = None

def get_current_user(
    db: Session = Depends(get_db), 
    token: str = Depends(oauth2_scheme)
) -> User:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Não foi possível validar as credenciais.",
        )
    user = db.query(User).filter(User.id == token_data.sub).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Usuário não encontrado."
        )
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Usuário inativo ou pendente de aprovação."
        )
    return user

class PermissionChecker:
    def __init__(self, required_permissions: List[str]):
        self.required_permissions = required_permissions

    def __call__(
        self, 
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> User:
        # Super Admin bypasses all checks
        if current_user.role_id == "super_admin":
            return current_user
            
        # Get roles and their permissions
        role = db.query(Role).filter(Role.id == current_user.role_id).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="O usuário não possui papéis configurados."
            )
            
        user_permissions = {p.id for p in role.permissions}
        
        # Check if all required permissions are met
        for perm in self.required_permissions:
            if perm not in user_permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permissão negada. Requer: {perm}"
                )
                
        return current_user

def enforce_tenant(tenant_id_to_check: str, current_user: User):
    """
    Enforces tenant separation. Bypassed for super_admin.
    """
    if current_user.role_id == "super_admin":
        return
    if str(current_user.tenant_id) != str(tenant_id_to_check):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso não autorizado aos dados de outro condomínio."
        )
