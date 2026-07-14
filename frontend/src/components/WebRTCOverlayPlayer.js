"use client";

import { useEffect, useRef, useState } from "react";

if (typeof window !== "undefined" && !window.__fetchPatched) {
  window.__fetchPatched = true;
  const _orig = window.fetch;
  window.fetch = (url, opts = {}) => {
    opts.headers = { "Bypass-Tunnel-Reminder": "true", ...opts.headers };
    return _orig(url, opts);
  };
}

export default function WebRTCOverlayPlayer({ 
  streamId, 
  status, 
  showDetections = false, 
  activeMonitorings = [], 
  zones = [],
  allowIgnore = false,
  rtspUrl = ""
}) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detections, setDetections] = useState([]);
  const [imgRetry, setImgRetry] = useState(0);
  
  // Drag-to-pan state for mobile landscape viewports
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  // Reset pan when camera changes
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [streamId]);

  const handleStart = (clientX, clientY) => {
    isDragging.current = true;
    dragStart.current = { x: clientX - pan.x, y: clientY - pan.y };
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging.current) return;
    const newX = clientX - dragStart.current.x;
    const newY = clientY - dragStart.current.y;
    // Limit translation bounds so the video doesn't drag completely away
    const clampedX = Math.max(-400, Math.min(400, newX));
    const clampedY = Math.max(-400, Math.min(400, newY));
    setPan({ x: clampedX, y: clampedY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  const handleDoubleClick = () => {
    setPan({ x: 0, y: 0 });
  };

  // Local WebRTC publishing state
  const isWebcam = rtspUrl && rtspUrl.includes("source=publisher");
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    if (typeof window !== "undefined" && window.__activeWhipPublishers?.[streamId]) {
      return window.__activeWhipPublishers[streamId].deviceId;
    }
    return "";
  });
  const [isPublishing, setIsPublishing] = useState(() => {
    if (typeof window !== "undefined" && window.__activeWhipPublishers?.[streamId]) {
      return window.__activeWhipPublishers[streamId].isPublishing;
    }
    return false;
  });
  const [publishError, setPublishError] = useState(null);
  
  const whipPcRef = useRef(null);
  const localStreamRef = useRef(null);

  // Retrieve active publisher from global window object on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.__activeWhipPublishers?.[streamId]) {
      const active = window.__activeWhipPublishers[streamId];
      whipPcRef.current = active.pc;
      localStreamRef.current = active.stream;
    }
  }, [streamId]);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined"
    ? (window.location.port === "3000"
        ? `${window.location.protocol}//${window.location.hostname}:8000`
        : window.location.origin)
    : "http://localhost:8000");

  // Load available camera devices
  useEffect(() => {
    if (!isWebcam) return;
    
    const getDevices = async () => {
      try {
        // Request temporary camera permission to get device labels, then clean up
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
        if (tempStream) {
          tempStream.getTracks().forEach(track => track.stop());
        }
        
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error("Erro ao listar dispositivos de vídeo:", err);
      }
    };
    
    getDevices();
  }, [isWebcam]);

  const startWhipPublishing = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Seu navegador não suporta acesso à câmera.");
      return;
    }
    
    setPublishError(null);
    try {
      const constraints = {
        video: selectedDeviceId 
          ? { 
              deviceId: { exact: selectedDeviceId },
              width: { ideal: 3840 },
              height: { ideal: 2160 }
            } 
          : {
              width: { ideal: 3840 },
              height: { ideal: 2160 }
            },
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      // Refresh devices list to get labels after permission is granted
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
      } catch (e) {
        console.warn("Failed to refresh devices:", e);
      }
      
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      whipPcRef.current = pc;
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const whipUrl = `${backendUrl}/api/cameras/${streamId}/whip`;
      
      const response = await fetch(whipUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });
      if (!response.ok) {
        throw new Error(`Falha no handshake WHIP: ${response.statusText}`);
      }
      
      const answerSdp = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
      
      if (typeof window !== "undefined") {
        if (!window.__activeWhipPublishers) window.__activeWhipPublishers = {};
        window.__activeWhipPublishers[streamId] = {
          pc: pc,
          stream: stream,
          deviceId: selectedDeviceId,
          isPublishing: true
        };
      }
      
      setIsPublishing(true);
    } catch (err) {
      console.error("Erro ao publicar stream WHIP:", err);
      setPublishError(`Não foi possível iniciar a transmissão: ${err.message || err.name || err.toString()}`);
      stopWhipPublishing();
    }
  };

  const stopWhipPublishing = () => {
    if (whipPcRef.current) {
      try { whipPcRef.current.close(); } catch(e){}
      whipPcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (typeof window !== "undefined" && window.__activeWhipPublishers?.[streamId]) {
      delete window.__activeWhipPublishers[streamId];
    }
    setIsPublishing(false);
  };

  // Clean up WHIP on unmount
  useEffect(() => {
    return () => {
      // Do NOT close the connection on unmount if it is registered globally,
      // so the transmission continues when switching between grid and expanded views.
      if (typeof window !== "undefined" && window.__activeWhipPublishers?.[streamId]) {
        return;
      }
      if (whipPcRef.current) {
        try { whipPcRef.current.close(); } catch(e){}
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [streamId]);

  // WHEP Player connection
  useEffect(() => {
    const shouldConnect = streamId && (status === "online" || isPublishing);
    if (!shouldConnect) {
      setError(null);
      return;
    }

    // Detect if we are on a remote hostname (Vercel) accessing a local backend/MediaMTX
    const isRemote = typeof window !== "undefined" && 
                     window.location.hostname !== "localhost" && 
                     window.location.hostname !== "127.0.0.1";
                     
    if (isRemote) {
      setError("WebRTC not supported on remote domain. Using MJPEG stream.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
        console.warn("WebRTC connection failed, closed or disconnected. Falling back to MJPEG.");
        setError("Conexão WebRTC fechada.");
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed" || pc.iceConnectionState === "disconnected") {
        console.warn("WebRTC ICE connection failed, closed or disconnected. Falling back to MJPEG.");
        setError("Conexão WebRTC fechada.");
      }
    };


    // WHEP requires adding audio/video transceivers first
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const startSession = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const whepUrl = `${backendUrl}/api/cameras/${streamId}/whep`;
        
        const response = await fetch(whepUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });
        if (!response.ok) {
          throw new Error(`Falha no handshake WHEP: ${response.statusText}`);
        }

        const answerSdp = await response.text();
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: answerSdp })
        );
        setLoading(false);
      } catch (err) {
        console.error("WebRTC Error: ", err);
        setError("Erro ao conectar à transmissão ao vivo.");
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      startSession();
    }, isPublishing ? 400 : 0);

    return () => {
      clearTimeout(timer);
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [streamId, status, isPublishing]);

  // Polling for YOLO Detections (only if showDetections is true)
  useEffect(() => {
    if (!showDetections || !streamId || (status !== "online" && !isPublishing)) {
      setDetections([]);
      return;
    }

    const fetchDets = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/cameras/${streamId}/detections`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Bypass-Tunnel-Reminder": "true",
          }
        });
        if (res.ok) {
          const data = await res.json();
          setDetections(data);
        }
      } catch (err) {
        console.error("Error fetching detections:", err);
      }
    };

    fetchDets();
    const interval = setInterval(fetchDets, 120); // Poll every 120ms

    return () => clearInterval(interval);
  }, [showDetections, streamId, status, isPublishing, backendUrl, token]);

  const handleMarkFalsePositive = async (det) => {
    const objLabel = det.obj_type === "person" ? "Pessoa" : (det.obj_type === "car" ? "Carro" : (det.obj_type === "motorcycle" ? "Moto" : det.obj_type));
    if (!confirm(`Deseja desconsiderar este objeto específico detectado como "${objLabel}"? O Sentinel AI irá ignorar apenas detecções nessa exata posição, sem perder a visão de pessoas que passem ou fiquem na área ao redor.`)) {
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/cameras/${streamId}/false-positives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          obj_type: det.obj_type,
          coordinates: {
            x1: det.x1,
            y1: det.y1,
            x2: det.x2,
            y2: det.y2
          }
        })
      });
      if (res.ok) {
        alert("Objeto desconsiderado com sucesso! Ele não será mais rastreado.");
      } else {
        const errData = await res.json();
        alert(`Erro ao salvar falso positivo: ${errData.detail || "Permissão negada."}`);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao conectar com o servidor.");
    }
  };

  const showPlayer = status === "online" || isPublishing;

  const renderWebcamControls = () => {
    if (!isWebcam) return null;
    return (
      <div style={styles.webcamControls}>
        <select
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          disabled={isPublishing}
          style={styles.webcamSelect}
        >
          {devices.length === 0 && <option value="">Carregando webcams...</option>}
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              📹 {device.label || `Câmera ${device.deviceId.slice(0, 5)}`}
            </option>
          ))}
        </select>
        <button
          onClick={isPublishing ? stopWhipPublishing : startWhipPublishing}
          style={{
            ...styles.webcamBtn,
            background: isPublishing ? "#ef4444" : "#10b981"
          }}
        >
          {isPublishing ? "🛑 Parar" : "⚡ Transmitir"}
        </button>
      </div>
    );
  };

  if (!showPlayer) {
    if (isWebcam) {
      return (
        <div style={styles.container}>
          <div style={styles.placeholder}>
            <div style={{ textAlign: "center", padding: "16px" }}>
              <span style={styles.textMuted}>Webcam USB Local</span>
              <div style={{ fontSize: "12px", color: "#71717a", marginTop: "4px" }}>
                Selecione o dispositivo abaixo e clique em Transmitir
              </div>
              {publishError && (
                <div style={{ color: "#f87171", fontSize: "11px", marginTop: "8px" }}>
                  ⚠️ {publishError}
                </div>
              )}
            </div>
          </div>
          {renderWebcamControls()}
        </div>
      );
    }

    return (
      <div style={styles.placeholder}>
        <span style={styles.textMuted}>Câmera Offline</span>
      </div>
    );
  }

  const fallbackUrl = `${backendUrl}/api/cameras/${streamId}/stream?token=${token || ""}&retry=${imgRetry}`;

  return (
    <div 
      style={{
        ...styles.container,
        transform: `translate(${pan.x}px, ${pan.y}px)`,
        cursor: isDragging.current ? "grabbing" : "grab",
        touchAction: "none"
      }}
      onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
      onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={(e) => {
        if (e.touches.length === 1) {
          handleStart(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 1) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchEnd={handleEnd}
      onDoubleClick={handleDoubleClick}
    >
      {loading && <div style={styles.overlay}>Conectando...</div>}

      {/* SVG Polygons for Zones and Active Monitorings */}
      {showPlayer && ((activeMonitorings && activeMonitorings.length > 0) || (zones && zones.length > 0)) && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          {/* Configured Zones */}
          {zones && zones.map((zone) => {
            if (!zone.coordinates) return null;
            const pointsStr = zone.coordinates.map(p => `${p.x * 100},${p.y * 100}`).join(" ");
            
            let fillColor = "rgba(245, 158, 11, 0.12)";
            let strokeColor = "#f59e0b";
            if (zone.zone_type === "restricted") {
              fillColor = "rgba(239, 68, 68, 0.12)";
              strokeColor = "#ef4444";
            } else if (zone.zone_type === "ignored") {
              fillColor = "rgba(156, 163, 175, 0.15)";
              strokeColor = "#9ca3af";
            } else if (zone.zone_type === "manual_car" || zone.zone_type === "manual_motorcycle") {
              fillColor = "rgba(16, 185, 129, 0.12)";
              strokeColor = "#10b981";
            }
            
            return (
              <polygon
                key={zone.id}
                points={pointsStr}
                style={{
                  fill: fillColor,
                  stroke: strokeColor,
                  strokeWidth: 0.5,
                }}
              />
            );
          })}

          {/* Active Parking Spot Monitorings */}
          {activeMonitorings && activeMonitorings.map((m) => {
            if (!m.coordinates) return null;
            const pointsStr = m.coordinates.map(p => `${p.x * 100},${p.y * 100}`).join(" ");
            return (
              <polygon
                key={m.id}
                points={pointsStr}
                style={{
                  fill: "rgba(16, 185, 129, 0.15)",
                  stroke: "#10b981",
                  strokeWidth: 0.6,
                }}
              />
            );
          })}
        </svg>
      )}

      {/* YOLO Bounding Box Divs */}
      {showPlayer && showDetections && detections.map((det, idx) => {
        const isManual = det.obj_type.startsWith("manual_");
        const cleanObjType = isManual ? det.obj_type.substring(7) : det.obj_type;

        // Find the matching monitoring whose spot contains this detected vehicle
        const isCarOrMotorcycle = cleanObjType === "car" || cleanObjType === "motorcycle";
        const matchedMonitoring = activeMonitorings && isCarOrMotorcycle
          ? activeMonitorings.find((m) => {
              if (!m.coordinates || m.coordinates.length < 3) return false;
              const xs = m.coordinates.map(p => p.x);
              const ys = m.coordinates.map(p => p.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const cx = (det.x1 + det.x2) / 2;
              const cy = (det.y1 + det.y2) / 2;
              return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
            })
          : null;

        const isUserCar = !!matchedMonitoring;

        const borderStyle = isManual
          ? "2px dashed #10b981"
          : (isUserCar
            ? "2px solid #10b981"
            : `2px solid ${det.obj_type === "person" ? "#ef4444" : "#3b82f6"}`);

        const shadowStyle = isUserCar || isManual
          ? "0 0 12px rgba(16, 185, 129, 0.9)"
          : "none";

        const bgStyle = isManual
          ? "#10b981"
          : (isUserCar
            ? "#10b981"
            : (det.obj_type === "person" ? "#ef4444" : "#3b82f6"));

        // Build rich label: vehicle model + owner name when available
        let labelText;
        if (isManual) {
          const typeName = cleanObjType === "car" ? "Carro (Fixo)" : (cleanObjType === "motorcycle" ? "Moto (Fixo)" : "Objeto (Fixo)");
          labelText = `📌 ${typeName}`;
        } else if (isUserCar) {
          const model = matchedMonitoring.vehicle_model || (cleanObjType === "car" ? "Carro" : "Moto");
          const owner = matchedMonitoring.user_name ? ` · ${matchedMonitoring.user_name.split(" ")[0]}` : "";
          labelText = `🚗 ${model}${owner}`;
        } else {
          labelText = det.obj_type === "person" ? "Pessoa" : (det.obj_type === "car" ? "Carro" : (det.obj_type === "motorcycle" ? "Moto" : det.obj_type));
        }

        return (
          <div
            key={det.track_id || idx}
            style={{
              position: "absolute",
              left: `${det.x1 * 100}%`,
              top: `${det.y1 * 100}%`,
              width: `${(det.x2 - det.x1) * 100}%`,
              height: `${(det.y2 - det.y1) * 100}%`,
              border: borderStyle,
              boxShadow: shadowStyle,
              borderRadius: "4px",
              zIndex: 11,
              pointerEvents: "auto",
              transition: "left 0.12s linear, top 0.12s linear, width 0.12s linear, height 0.12s linear",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "-20px",
                left: 0,
                background: bgStyle,
                color: "#fff",
                fontSize: isUserCar ? "11px" : "10px",
                fontWeight: "bold",
                padding: "2px 6px",
                borderRadius: "3px",
                whiteSpace: "nowrap",
                letterSpacing: isUserCar ? "0.3px" : "0",
              }}
            >
              {labelText}
            </span>

            {/* Ignore static object button */}
            {allowIgnore && !isUserCar && !isManual && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMarkFalsePositive(det);
                }}
                style={{
                  position: "absolute",
                  top: "-20px",
                  right: "-2px",
                  background: "#4b5563",
                  color: "#fff",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "9px",
                  fontWeight: "bold",
                  padding: "2px 5px",
                  zIndex: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
                }}
                title="Ignorar este objeto (Falso Positivo)"
              >
                🚫 Ignorar
              </button>
            )}
          </div>
        );
      })}

      {error ? (
        <img
          src={fallbackUrl}
          alt="Canal de transmissão de contingência"
          style={styles.video}
          onError={() => {
            console.log("Stream fallback error, retrying in 3s...");
            setTimeout(() => {
              setImgRetry(prev => prev + 1);
            }, 3000);
          }}
        />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={styles.video}
        />
      )}

      {/* Webcam overlay controls */}
      {renderWebcamControls()}
    </div>
  );
}

const styles = {
  container: {
    position: "relative",
    width: "100%",
    aspectRatio: "16/9",
    background: "#000",
    borderRadius: "8px",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  placeholder: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "#18181b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  textMuted: {
    color: "#71717a",
    fontSize: "14px",
    fontWeight: "500",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: "14px",
    zIndex: 2,
  },
  overlayError: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(220,38,38,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fca5a5",
    fontSize: "14px",
    zIndex: 2,
    padding: "16px",
    textAlign: "center",
  },
  webcamControls: {
    position: "absolute",
    bottom: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(24, 24, 27, 0.85)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "30px",
    padding: "6px 12px",
    zIndex: 100,
    width: "calc(100% - 24px)",
    maxWidth: "380px",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
  },
  webcamSelect: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "#f4f4f5",
    fontSize: "12px",
    fontWeight: "500",
    outline: "none",
    cursor: "pointer",
    paddingRight: "8px",
  },
  webcamBtn: {
    color: "#fff",
    border: "none",
    borderRadius: "20px",
    padding: "6px 14px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  },
};
