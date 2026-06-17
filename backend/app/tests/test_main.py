from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "sentinel-api"}

def test_login_invalid_credentials():
    response = client.post(
        "/api/auth/login",
        data={"username": "wrong@email.com", "password": "wrongpassword"}
    )
    assert response.status_code == 400
    assert "incorrect" in response.json()["detail"].lower() or "incorretos" in response.json()["detail"].lower()

def test_list_plans():
    response = client.get("/api/billing/plans")
    assert response.status_code == 200
    plans = response.json()
    assert isinstance(plans, list)
    if len(plans) > 0:
        assert "name" in plans[0]
        assert "price_cents" in plans[0]
