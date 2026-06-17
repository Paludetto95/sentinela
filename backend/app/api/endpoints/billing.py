from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timedelta, timezone

from app.db.session import get_db
from app.models.all_models import Plan, Subscription, Invoice, Payment, User
from app.schemas.schemas import PlanResponse, SubscriptionResponse, InvoiceResponse
from app.api.deps import PermissionChecker, get_current_user, enforce_tenant

router = APIRouter()

@router.get("/plans", response_model=List[PlanResponse])
def list_plans(
    db: Session = Depends(get_db)
):
    return db.query(Plan).all()

@router.get("/subscription", response_model=SubscriptionResponse)
def get_tenant_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sub = db.query(Subscription).filter(Subscription.tenant_id == current_user.tenant_id).first()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assinatura não encontrada para este condomínio."
        )
    return sub

@router.post("/subscribe", response_model=SubscriptionResponse)
def subscribe_tenant(
    plan_id: UUID,
    payment_method: str = "credit_card",
    current_user: User = Depends(PermissionChecker(["billing:manage"])),
    db: Session = Depends(get_db)
):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plano selecionado não existe.")
        
    sub = db.query(Subscription).filter(Subscription.tenant_id == current_user.tenant_id).first()
    
    now = datetime.now(timezone.utc)
    end_date = now + timedelta(days=30)
    
    if sub:
        # Upgrade plan
        sub.plan_id = plan_id
        sub.status = "active"
        sub.current_period_start = now
        sub.current_period_end = end_date
        db.commit()
        db.refresh(sub)
    else:
        # New subscription
        sub = Subscription(
            tenant_id=current_user.tenant_id,
            plan_id=plan.id,
            status="active",
            current_period_start=now,
            current_period_end=end_date
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        
    # Generate pending Invoice for the plan
    invoice = Invoice(
        tenant_id=current_user.tenant_id,
        subscription_id=sub.id,
        amount_cents=plan.price_cents,
        status="pending",
        due_date=now + timedelta(days=3)
    )
    db.add(invoice)
    db.commit()
    
    return sub

@router.get("/invoices", response_model=List[InvoiceResponse])
def list_tenant_invoices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role_id == "super_admin":
        return db.query(Invoice).all()
        
    return db.query(Invoice).filter(Invoice.tenant_id == current_user.tenant_id).all()

@router.post("/invoices/{invoice_id}/pay", response_model=InvoiceResponse)
def pay_invoice(
    invoice_id: UUID,
    current_user: User = Depends(PermissionChecker(["billing:manage"])),
    db: Session = Depends(get_db)
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada.")
        
    enforce_tenant(invoice.tenant_id, current_user)
    
    if invoice.status == "paid":
        raise HTTPException(status_code=400, detail="Esta fatura já foi paga.")
        
    # Simulate payment processing success
    invoice.status = "paid"
    invoice.paid_at = datetime.now(timezone.utc)
    
    payment = Payment(
        tenant_id=invoice.tenant_id,
        invoice_id=invoice.id,
        amount_cents=invoice.amount_cents,
        payment_method="credit_card",
        status="success",
        transaction_id=f"tx_{int(datetime.now(timezone.utc).timestamp())}"
    )
    db.add(payment)
    db.commit()
    db.refresh(invoice)
    
    return invoice
