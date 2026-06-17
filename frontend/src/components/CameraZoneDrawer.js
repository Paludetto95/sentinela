"use client";

import { useState, useRef, useEffect } from "react";
import WebRTCOverlayPlayer from "./WebRTCOverlayPlayer";

export default function CameraZoneDrawer({ cameraId, status, zones = [], onSave, onDeleteZone, onCancel }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [zoneName, setZoneName] = useState("");
  const [zoneType, setZoneType] = useState("restricted");
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [falsePositives, setFalsePositives] = useState([]);

  const fetchFalsePositives = async () => {
    try {
      const token = localStorage.getItem("token");
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined"
        ? (window.location.port === "3000"
            ? `${window.location.protocol}//${window.location.hostname}:8000`
            : window.location.origin)
        : "http://localhost:8000");
      const res = await fetch(`${backendUrl}/api/cameras/${cameraId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setFalsePositives(data.false_positives || []);
      }
    } catch (err) {
      console.error("Error fetching false positives:", err);
    }
  };

  const handleDeleteFalsePositive = async (fpId) => {
    if (!confirm("Tem certeza que deseja remover esta marcação de falso positivo? O objeto voltará a ser detectado normalmente.")) return;
    try {
      const token = localStorage.getItem("token");
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined"
        ? (window.location.port === "3000"
            ? `${window.location.protocol}//${window.location.hostname}:8000`
            : window.location.origin)
        : "http://localhost:8000");
      const res = await fetch(`${backendUrl}/api/cameras/false-positives/${fpId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        fetchFalsePositives();
      } else {
        alert("Erro ao excluir falso positivo.");
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao conectar com o servidor.");
    }
  };

  useEffect(() => {
    if (cameraId) {
      fetchFalsePositives();
    }
  }, [cameraId]);

  const getClickCoords = (e) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x, y, pxX: e.clientX - rect.left, pxY: e.clientY - rect.top };
  };

  const getTouchCoords = (e) => {
    if (!canvasRef.current || e.touches.length === 0) return null;
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    return { x, y, pxX: touch.clientX - rect.left, pxY: touch.clientY - rect.top };
  };

  const handleMouseDown = (e) => {
    const coords = getClickCoords(e);
    if (!coords) return;
    
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    let foundIdx = -1;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const ptX = pt.x * width;
      const ptY = pt.y * height;
      const dist = Math.sqrt((coords.pxX - ptX) ** 2 + (coords.pxY - ptY) ** 2);
      if (dist < 12) { // 12px hit tolerance for dragging
        foundIdx = i;
        break;
      }
    }

    if (foundIdx !== -1) {
      setDraggingIdx(foundIdx);
    } else {
      setPoints([...points, { x: coords.x, y: coords.y }]);
    }
  };

  const handleMouseMove = (e) => {
    const coords = getClickCoords(e);
    if (!coords) return;

    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;

    if (draggingIdx !== null) {
      const x = Math.max(0, Math.min(1, coords.x));
      const y = Math.max(0, Math.min(1, coords.y));

      const newPoints = [...points];
      newPoints[draggingIdx] = { x, y };
      setPoints(newPoints);
    } else {
      // Show pointer/move cursor on hover
      let foundIdx = -1;
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const ptX = pt.x * width;
        const ptY = pt.y * height;
        const dist = Math.sqrt((coords.pxX - ptX) ** 2 + (coords.pxY - ptY) ** 2);
        if (dist < 12) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx !== -1) {
        canvas.style.cursor = "move";
      } else {
        canvas.style.cursor = "crosshair";
      }
    }
  };

  const handleMouseUp = () => {
    setDraggingIdx(null);
  };

  const handleTouchStart = (e) => {
    const coords = getTouchCoords(e);
    if (!coords) return;
    
    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    let foundIdx = -1;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const ptX = pt.x * width;
      const ptY = pt.y * height;
      const dist = Math.sqrt((coords.pxX - ptX) ** 2 + (coords.pxY - ptY) ** 2);
      if (dist < 20) { // Larger hit tolerance for fingers
        foundIdx = i;
        break;
      }
    }

    if (foundIdx !== -1) {
      setDraggingIdx(foundIdx);
      e.preventDefault(); // Prevent scrolling/zooming when dragging
    } else {
      setPoints([...points, { x: coords.x, y: coords.y }]);
    }
  };

  const handleTouchMove = (e) => {
    if (draggingIdx === null) return;
    const coords = getTouchCoords(e);
    if (!coords) return;

    const x = Math.max(0, Math.min(1, coords.x));
    const y = Math.max(0, Math.min(1, coords.y));

    const newPoints = [...points];
    newPoints[draggingIdx] = { x, y };
    setPoints(newPoints);
    e.preventDefault();
  };

  const handleClear = () => {
    setPoints([]);
  };

  const handleUndo = () => {
    setPoints(points.slice(0, -1));
  };

  const handleSave = () => {
    if (points.length < 3) {
      alert("A zona precisa ter pelo menos 3 pontos desenhados.");
      return;
    }
    if (!zoneName.trim()) {
      alert("Por favor, dê um nome para a zona.");
      return;
    }
    onSave({
      name: zoneName,
      zone_type: zoneType,
      coordinates: points,
      risk_multiplier: zoneType === "restricted" ? 1.5 : (zoneType === "ignored" ? 0.0 : 1.0),
    });
  };

  // Re-draw points and lines on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    
    // Set internal canvas dimensions to match display dimensions
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (points.length === 0) return;
    
    ctx.lineWidth = 3;
    let strokeColor = "#f59e0b";
    let fillColor = "rgba(245, 158, 11, 0.15)";
    if (zoneType === "restricted") {
      strokeColor = "#ef4444";
      fillColor = "rgba(239, 68, 68, 0.15)";
    } else if (zoneType === "ignored") {
      strokeColor = "#9ca3af";
      fillColor = "rgba(156, 163, 175, 0.2)";
    } else if (zoneType === "manual_car" || zoneType === "manual_motorcycle") {
      strokeColor = "#10b981";
      fillColor = "rgba(16, 185, 129, 0.15)";
    }
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const cx = pt.x * canvas.width;
      const cy = pt.y * canvas.height;
      if (idx === 0) {
        ctx.moveTo(cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }
    });
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    
    // Draw point anchors with highlighted state for dragging
    points.forEach((pt, idx) => {
      ctx.beginPath();
      ctx.arc(pt.x * canvas.width, pt.y * canvas.height, idx === draggingIdx ? 7 : 5, 0, 2 * Math.PI);
      ctx.fillStyle = idx === draggingIdx ? "#fbbf24" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    });
  }, [points, zoneType, draggingIdx]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h4 style={styles.title}>Desenhar Nova Zona de Monitoramento</h4>
        <p style={styles.subtitle}>Clique na tela para desenhar o polígono. Arraste os pontos brancos para ajustar a posição.</p>
      </div>
      
      <div ref={containerRef} style={styles.canvasWrapper}>
        <WebRTCOverlayPlayer 
          streamId={cameraId} 
          status={status} 
          zones={zones} 
          showDetections={true}
          allowIgnore={true}
        />
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          style={styles.canvas}
        />
      </div>

      <div style={styles.form}>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Nome da Zona</label>
          <input
            type="text"
            placeholder="Ex: Portão A, Setor Proibido, etc."
            value={zoneName}
            onChange={(e) => setZoneName(e.target.value)}
            className="input-field"
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Tipo de Zona</label>
          <select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            className="input-field"
            style={{ appearance: "auto" }}
          >
            <option value="restricted">Área Restrita (Invasão gera alerta Crítico)</option>
            <option value="parking">Vaga de Veículo (Área comum de trânsito)</option>
            <option value="transit">Via de Trânsito rápido</option>
            <option value="ignored">Área Ignorada (YOLO desconsidera e não rastreia objetos aqui)</option>
            <option value="manual_car">🚗 Carro Confirmado (Fixo - Forçar detecção manual)</option>
            <option value="manual_motorcycle">🏍️ Moto Confirmada (Fixo - Forçar detecção manual)</option>
          </select>
        </div>
      </div>

      {zones && zones.length > 0 && (
        <div style={styles.existingZonesSection}>
          <label style={styles.label}>Zonas Configuradas ({zones.length})</label>
          <div style={styles.zonesList}>
            {zones.map((zone) => (
              <div key={zone.id} style={styles.zoneItem}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={styles.zoneNameText}>{zone.name}</span>
                  <span style={styles.zoneTypeText}>
                    {zone.zone_type === "restricted" ? "🚫 Área Restrita" : 
                     (zone.zone_type === "parking" ? "🚗 Vaga" : 
                      (zone.zone_type === "ignored" ? "👁️‍🗨️ Área Ignorada (Falso Positivo)" : 
                       (zone.zone_type === "manual_car" ? "📌 Carro Confirmado" : 
                        (zone.zone_type === "manual_motorcycle" ? "📌 Moto Confirmada" : "🛣️ Via de Trânsito"))))}
                  </span>
                </div>
                {onDeleteZone && (
                  <button 
                    onClick={() => onDeleteZone(zone.id)} 
                    style={styles.btnDeleteZone}
                    title="Excluir esta zona"
                  >
                    🗑️
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {falsePositives && falsePositives.length > 0 && (
        <div style={styles.existingZonesSection}>
          <label style={styles.label}>Objetos Desconsiderados (Falsos Positivos) ({falsePositives.length})</label>
          <div style={styles.zonesList}>
            {falsePositives.map((fp) => (
              <div key={fp.id} style={styles.zoneItem}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={styles.zoneNameText}>🚫 {fp.obj_type === "person" ? "Falsa Pessoa" : "Falso Veículo"}</span>
                  <span style={styles.zoneTypeText}>
                    Posição: X: {fp.coordinates.x1?.toFixed(2)}, Y: {fp.coordinates.y1?.toFixed(2)}
                  </span>
                </div>
                <button 
                  onClick={() => handleDeleteFalsePositive(fp.id)} 
                  style={styles.btnDeleteZone}
                  title="Reativar detecção deste objeto"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={styles.actions}>
        <button onClick={handleUndo} className="btn-secondary" disabled={points.length === 0}>Desfazer</button>
        <button onClick={handleClear} className="btn-secondary" disabled={points.length === 0}>Limpar Pontos</button>
        <button onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button onClick={handleSave} className="btn-primary">Salvar Zona</button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: "20px",
    background: "#121216",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  header: {
    marginBottom: "16px",
  },
  title: {
    color: "#fff",
    fontSize: "18px",
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: "13px",
    marginTop: "4px",
  },
  canvasWrapper: {
    position: "relative",
    width: "100%",
    aspectRatio: "16/9",
    background: "#000",
    borderRadius: "8px",
    overflow: "hidden",
  },
  cameraPlaceholder: {
    position: "absolute",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  placeholderText: {
    color: "#4b5563",
    fontSize: "14px",
  },
  canvas: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 2,
    cursor: "crosshair",
  },
  form: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginTop: "16px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    color: "#f3f4f6",
    fontSize: "14px",
    fontWeight: "500",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "20px",
  },
  existingZonesSection: {
    marginTop: "20px",
    paddingTop: "16px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  zonesList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "10px",
    maxHeight: "150px",
    overflowY: "auto",
  },
  zoneItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "rgba(255,255,255,0.04)",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  zoneNameText: {
    color: "#fff",
    fontSize: "13px",
    fontWeight: "600",
  },
  zoneTypeText: {
    color: "#9ca3af",
    fontSize: "11px",
    marginTop: "2px",
  },
  btnDeleteZone: {
    background: "transparent",
    border: "none",
    color: "#ef4444",
    cursor: "pointer",
    fontSize: "14px",
    padding: "4px",
    borderRadius: "4px",
    transition: "background 0.2s",
  },
};
