"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Mail, Lock, User as UserIcon, Phone, FileText } from "lucide-react";

if (typeof window !== "undefined" && !window.__fetchPatched) {
  window.__fetchPatched = true;
  const originalFetch = window.fetch;
  window.fetch = async function (url, options = {}) {
    options.headers = {
      ...options.headers,
      "Bypass-Tunnel-Reminder": "true",
    };
    return originalFetch(url, options);
  };
}

const getBackendUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    if (window.location.port === "3000") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
    return window.location.origin;
  }
  return "http://localhost:8000";
};

export default function AuthPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [condoId, setCondoId] = useState("");
  const [apartment, setApartment] = useState("");
  const [tower, setTower] = useState("");
  
  const [condos, setCondos] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // Load condos list for registration dropdown
  useEffect(() => {
    const fetchCondos = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/condos/public`);
        if (res.ok) {
          const data = await res.json();
          setCondos(data);
        }
      } catch (err) {
        console.error("Erro ao carregar condomínios:", err);
      }
    };
    fetchCondos();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const apiUrl = `${getBackendUrl()}/api/auth`;

    try {
      if (isLogin) {
        // Login API Call
        const formData = new URLSearchParams();
        formData.append("username", email);
        formData.append("password", password);

        const res = await fetch(`${apiUrl}/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData,
        });

        let data = {};
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`Erro de resposta do servidor (${res.status}). Verifique se a variável NEXT_PUBLIC_API_URL está configurada no Vercel e o backend está online.`);
        }
        
        if (!res.ok) {
          throw new Error(data.detail || "Erro de login");
        }

        // Save session details
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("tenant_id", data.tenant_id);
        localStorage.setItem("condominium_id", data.condominium_id || "");
        localStorage.setItem("user_name", data.name);

        setSuccess("Login efetuado com sucesso! Redirecionando...");
        setTimeout(() => {
          router.push("/dashboard");
        }, 1000);
      } else {
        if (!condoId) {
          throw new Error("Por favor, selecione um condomínio.");
        }
        // Register API Call
        const payload = {
          name,
          email,
          phone,
          cpf,
          password,
          condominium_id: condoId,
          apartment,
          tower,
        };

        const res = await fetch(`${apiUrl}/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        let data = {};
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`Erro de resposta do servidor (${res.status}). Verifique se a variável NEXT_PUBLIC_API_URL está configurada no Vercel e o backend está online.`);
        }

        if (!res.ok) {
          throw new Error(data.detail || "Erro de cadastro");
        }

        setSuccess(
          data.status === "pending"
            ? "Cadastro enviado! Aguardando aprovação do síndico."
            : "Cadastro realizado com sucesso! Faça login."
        );
        
        // Reset form and switch to login
        setIsLogin(true);
        setPassword("");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.backgroundGlow1} />
      <div style={styles.backgroundGlow2} />
      
      <div style={styles.glassContainer} className="glass-panel">
        <div style={styles.logoHeader}>
          <div style={styles.shieldGlow}>
            <Shield size={32} color="#6366f1" />
          </div>
          <h2 style={styles.brandTitle}>SENTINEL AI</h2>
          <p style={styles.brandSubtitle}>Monitoramento Inteligente SaaS</p>
        </div>

        {error && <div style={styles.alertError}>{error}</div>}
        {success && <div style={styles.alertSuccess}>{success}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          {!isLogin && (
            <>
              <div style={styles.inputWrapper}>
                <UserIcon size={18} style={styles.icon} />
                <input
                  type="text"
                  placeholder="Nome Completo"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: "42px" }}
                />
              </div>

              <div style={styles.inputWrapper}>
                <Phone size={18} style={styles.icon} />
                <input
                  type="text"
                  placeholder="Telefone / Celular"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: "42px" }}
                />
              </div>

              <div style={styles.inputWrapper}>
                <FileText size={18} style={styles.icon} />
                <input
                  type="text"
                  placeholder="CPF"
                  required
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: "42px" }}
                />
              </div>
            </>
          )}

          <div style={styles.inputWrapper}>
            <Mail size={18} style={styles.icon} />
            <input
              type="email"
              placeholder="E-mail Corporativo"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              style={{ paddingLeft: "42px" }}
            />
          </div>

          <div style={styles.inputWrapper}>
            <Lock size={18} style={styles.icon} />
            <input
              type="password"
              placeholder="Senha"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              style={{ paddingLeft: "42px" }}
            />
          </div>

          {!isLogin && (
            <>
              <div style={styles.inputWrapper}>
                <select
                  required
                  value={condoId}
                  onChange={(e) => setCondoId(e.target.value)}
                  className="input-field"
                  style={{ appearance: "auto" }}
                >
                  <option value="">Selecione o seu Condomínio</option>
                  {condos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="Apartamento (Ex: 102)"
                  required
                  value={apartment}
                  onChange={(e) => setApartment(e.target.value)}
                  className="input-field"
                />
              </div>

              <div style={styles.inputWrapper}>
                <select
                  required
                  value={tower}
                  onChange={(e) => setTower(e.target.value)}
                  className="input-field"
                  style={{ appearance: "auto" }}
                >
                  <option value="">Selecione a Torre</option>
                  {(() => {
                    const selectedCondo = condos.find((c) => c.id === condoId);
                    if (selectedCondo && selectedCondo.towers && selectedCondo.towers.length > 0) {
                      return selectedCondo.towers.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ));
                    }
                    return (
                      <>
                        <option value="Torre 1">Torre 1</option>
                        <option value="Torre 2">Torre 2</option>
                      </>
                    );
                  })()}
                </select>
              </div>
            </>
          )}

          <button type="submit" disabled={loading} className="btn-primary" style={styles.btnSubmit}>
            {loading ? "Processando..." : isLogin ? "Acessar Plataforma" : "Criar Minha Conta"}
          </button>
        </form>

        <div style={styles.toggleFooter}>
          <span style={styles.textMuted}>
            {isLogin ? "Novo morador?" : "Já possui cadastro?"}
          </span>
          <button type="button" onClick={() => setIsLogin(!isLogin)} style={styles.btnToggle}>
            {isLogin ? "Cadastrar Morador" : "Fazer Login"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#08080a",
    overflow: "hidden",
  },
  backgroundGlow1: {
    position: "absolute",
    top: "-15%",
    left: "-15%",
    width: "50%",
    height: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 70%)",
    zIndex: 1,
  },
  backgroundGlow2: {
    position: "absolute",
    bottom: "-15%",
    right: "-15%",
    width: "50%",
    height: "50%",
    background: "radial-gradient(circle, rgba(6,182,212,0.15) 0%, rgba(0,0,0,0) 70%)",
    zIndex: 1,
  },
  glassContainer: {
    width: "440px",
    padding: "40px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
    zIndex: 2,
    border: "1px solid rgba(255,255,255,0.06)",
  },
  logoHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    textAlign: "center",
  },
  shieldGlow: {
    width: "60px",
    height: "60px",
    borderRadius: "16px",
    background: "rgba(99,102,241,0.1)",
    border: "1px solid rgba(99,102,241,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 15px rgba(99,102,241,0.2)",
  },
  brandTitle: {
    color: "#fff",
    fontSize: "24px",
    fontWeight: "700",
    letterSpacing: "1.5px",
    marginTop: "12px",
  },
  brandSubtitle: {
    color: "#6b7280",
    fontSize: "13px",
    fontWeight: "500",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputWrapper: {
    position: "relative",
    width: "100%",
  },
  icon: {
    position: "absolute",
    left: "14px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#6b7280",
    pointerEvents: "none",
  },
  btnSubmit: {
    marginTop: "8px",
    padding: "14px",
    fontSize: "15px",
  },
  toggleFooter: {
    display: "flex",
    justifyContent: "center",
    gap: "8px",
    fontSize: "14px",
    marginTop: "8px",
  },
  textMuted: {
    color: "#6b7280",
  },
  btnToggle: {
    background: "none",
    border: "none",
    color: "#6366f1",
    fontWeight: "600",
    cursor: "pointer",
    padding: 0,
    fontFamily: "inherit",
  },
  alertError: {
    padding: "12px",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: "8px",
    color: "#fca5a5",
    fontSize: "13px",
    textAlign: "center",
  },
  alertSuccess: {
    padding: "12px",
    background: "rgba(16,185,129,0.1)",
    border: "1px solid rgba(16,185,129,0.2)",
    borderRadius: "8px",
    color: "#a7f3d0",
    fontSize: "13px",
    textAlign: "center",
  },
};
