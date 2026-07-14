"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Shield, 
  Camera, 
  Map, 
  AlertTriangle, 
  Users, 
  CreditCard, 
  LogOut, 
  Plus, 
  Check, 
  Trash, 
  Play, 
  Eye, 
  User, 
  Car,
  Bell,
  Menu
} from "lucide-react";
import WebRTCOverlayPlayer from "@/components/WebRTCOverlayPlayer";
import CameraZoneDrawer from "@/components/CameraZoneDrawer";
import LeafletMap from "@/components/LeafletMap";

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

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [role, setRole] = useState("");
  const [userName, setUserName] = useState("");
  const [activeTab, setActiveTab] = useState("monitoramento");

  // State lists
  const [cameras, setCameras] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [users, setUsers] = useState([]);
  const [condos, setCondos] = useState([]);
  const [plans, setPlans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [subscription, setSubscription] = useState(null);

  // Form states
  const [newCondo, setNewCondo] = useState({ name: "", cnpj: "", address: "", city: "", state: "", cep: "", email: "", towersInput: "" });
  const [editingCondo, setEditingCondo] = useState(null); // holds condo object being edited
  const [condoError, setCondoError] = useState("");
  const [newCamera, setNewCamera] = useState({ name: "", description: "", rtsp_url: "", location_name: "", latitude: "", longitude: "", condominium_id: "" });
  const [isWebcamSelected, setIsWebcamSelected] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ plate: "", brand: "", model: "", year: "", color: "", nickname: "" });
  const [showZoneDrawer, setShowZoneDrawer] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [expandedCameraId, setExpandedCameraId] = useState(null);
  const [isClosingModal, setIsClosingModal] = useState(false);

  const closeExpandedCamera = () => {
    setIsClosingModal(true);
    setTimeout(() => {
      setExpandedCameraId(null);
      setIsClosingModal(false);
    }, 250);
  };


  const [gridSize, setGridSize] = useState(4); // 1, 4, 9, 16
  const [selectedCondoFilter, setSelectedCondoFilter] = useState("");

  // Modal resolution state
  const [resolvingEventId, setResolvingEventId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [viewingEvent, setViewingEvent] = useState(null);

  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  // Monitorar vaga states
  const [monitorings, setMonitorings] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedCameraForMonitoring, setSelectedCameraForMonitoring] = useState("");
  const [isDrawingMonitoringSpot, setIsDrawingMonitoringSpot] = useState(false);
  const [tempPoints, setTempPoints] = useState([]);
  const [startPoint, setStartPoint] = useState(null);
  const [isDraggingSpot, setIsDraggingSpot] = useState(false);
  const [showSnappingConfirm, setShowSnappingConfirm] = useState(false);
  const [snappedPoints, setSnappedPoints] = useState([]);
  const [suggestedVehicleType, setSuggestedVehicleType] = useState("");
  const lastCheckedEventTime = useRef(new Date());
  const [activeAlarmEvent, setActiveAlarmEvent] = useState(null);
  const [blinkState, setBlinkState] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("default");

  // Responsive Layout detection
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const mobileMode = window.innerWidth < 768 || window.innerHeight < 500 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      setIsMobile(mobileMode);
      if (!mobileMode) {
        setSidebarOpen(false); // Close sidebar on transition to desktop
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const modalRef = useRef(null);

  // Fullscreen API effect for Mobile
  useEffect(() => {
    if (expandedCameraId && isMobile && modalRef.current) {
      const el = modalRef.current;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch((err) => {
          console.warn("Fullscreen request failed:", err);
        });
      } else if (el.webkitRequestFullscreen) { // Safari
        el.webkitRequestFullscreen();
      }
    }
  }, [expandedCameraId, isMobile]);

  // Sync fullscreen change event with expandedCameraId state
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement && expandedCameraId) {
        setExpandedCameraId(null);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [expandedCameraId]);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedRole = localStorage.getItem("role");
    const savedName = localStorage.getItem("user_name");

    if (!savedToken) {
      router.push("/");
      return;
    }

    setToken(savedToken);
    setRole(savedRole);
    setUserName(savedName);
    
    // Register Service Worker for system notifications
    if (typeof window !== "undefined" && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW Registered'))
        .catch(err => console.error('SW Failed', err));
    }

    // Read push notification permissions in browser on mount
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    
    fetchData(savedToken, savedRole);
  }, []);

  // Play warning audio using Web Audio API (cross-browser synthesized pleasant chime sound)
  const playAlarmSound = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const playTone = (freq, duration, startTime, volume) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine'; // Pleasant pure sine wave
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioCtx.currentTime;
      // Elegant high-end electronics chime (C6, E6, G6 cascade)
      playTone(1046.50, 0.45, now, 0.12);
      playTone(1318.51, 0.55, now + 0.15, 0.10);
      playTone(1567.98, 0.70, now + 0.30, 0.08);
    } catch (err) {
      console.warn("Could not play alarm sound due to AudioContext restrictions or compatibility", err);
    }
  };

  // Handle eventId query parameter to open the occurrence modal directly
  useEffect(() => {
    if (!token) return;
    
    const checkUrlParam = async () => {
      const params = new URLSearchParams(window.location.search);
      const eventIdParam = params.get("eventId");
      if (eventIdParam) {
        try {
          const headers = { Authorization: `Bearer ${token}` };
          const res = await fetch(`${getBackendUrl()}/api/events/${eventIdParam}`, { headers });
          if (res.ok) {
            const eventData = await res.json();
            setViewingEvent(eventData);
            setActiveTab("ocorrencias");
            
            // Clean the URL param
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
          }
        } catch (err) {
          console.error("Failed to fetch clicked notification event:", err);
        }
      }
    };
    checkUrlParam();
  }, [token]);

  // Poll for new critical events to trigger browser push notifications and alarms
  useEffect(() => {
    if (!token) return;
    
    const interval = setInterval(async () => {
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const res = await fetch(`${getBackendUrl()}/api/events/`, { headers });
        if (res.ok) {
          const fetchedEvents = await res.json();
          // Filter events to notify: for admins, critical & high; for residents, all (since backend already filters to theirs)
          const newCriticalEvents = fetchedEvents.filter((evt) => {
            const evtTime = new Date(evt.created_at);
            const shouldNotify = role === "morador" || evt.risk_level === "critical" || evt.risk_level === "high";
            return (
              shouldNotify &&
              !evt.is_resolved &&
              evtTime > lastCheckedEventTime.current
            );
          });
          
          if (newCriticalEvents.length > 0) {
            // Play pleasant chime alert sound once on new event arrival
            playAlarmSound();

            newCriticalEvents.forEach((evt) => {
              const alertMsg = evt.details?.message || `${evt.event_type} detectado!`;
              const eventImageUrl = `${getBackendUrl()}/api/events/media/sentinel-alerts/${evt.id}/alert_frame.jpg`;
              
              // Trigger Native Browser/Mobile Push Notification
              if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.ready.then((registration) => {
                    registration.showNotification("Alerta de Segurança Sentinel AI", {
                      body: alertMsg,
                      icon: "/favicon.ico",
                      image: eventImageUrl,
                      vibrate: [300, 100, 300],
                      tag: evt.id,
                      data: { eventId: evt.id }
                    });
                  });
                } else {
                  const n = new Notification("Alerta de Segurança Sentinel AI", {
                    body: alertMsg,
                    icon: "/favicon.ico",
                    image: eventImageUrl
                  });
                  n.onclick = () => {
                    window.focus();
                    setViewingEvent(evt);
                    setActiveTab("ocorrencias");
                  };
                }
              }
              // Toast fallback / update lists
              console.log("🚨 ALERTA CRÍTICO RECEBIDO:", alertMsg);
            });
            
            // Update dashboard state lists dynamically
            fetchData(token, role);
          }
          
          if (fetchedEvents.length > 0) {
            const mostRecent = new Date(fetchedEvents[0].created_at);
            if (mostRecent > lastCheckedEventTime.current) {
              lastCheckedEventTime.current = mostRecent;
            }
          }
        }
      } catch (err) {
        console.error("Erro no polling de eventos:", err);
      }
    }, 2000); // Poll every 2 seconds for snappier notifications
    
    return () => clearInterval(interval);
  }, [token, role]);

  const fetchData = async (authToken, userRole) => {
    setLoading(true);
    setApiError("");
    const headers = { Authorization: `Bearer ${authToken}` };

    try {
      // 1. Stats
      const statsRes = await fetch(`${getBackendUrl()}/api/events/dashboard/stats`, { headers });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // 2. Events (All roles need events)
      const eventsRes = await fetch(`${getBackendUrl()}/api/events/`, { headers });
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setEvents(eventsData);
      }

      // Fetch active/inactive vehicle monitorings
      const monitoringsRes = await fetch(`${getBackendUrl()}/api/monitoring/`, { headers });
      if (monitoringsRes.ok) {
        setMonitorings(await monitoringsRes.json());
      }

      // 3. Conditional fetches based on roles
      if (userRole === "super_admin") {
        const condosRes = await fetch(`${getBackendUrl()}/api/condos/`, { headers });
        if (condosRes.ok) setCondos(await condosRes.json());

        const camerasRes = await fetch(`${getBackendUrl()}/api/cameras/`, { headers });
        if (camerasRes.ok) setCameras(await camerasRes.json());

        const usersRes = await fetch(`${getBackendUrl()}/api/users/`, { headers });
        if (usersRes.ok) setUsers(await usersRes.json());

        const vehiclesRes = await fetch(`${getBackendUrl()}/api/vehicles/`, { headers });
        if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
      } else {
        // Tenants, Admins, Operators, Residents need Cameras
        const camerasRes = await fetch(`${getBackendUrl()}/api/cameras/`, { headers });
        if (camerasRes.ok) setCameras(await camerasRes.json());

        // Vehicles
        const vehiclesRes = await fetch(`${getBackendUrl()}/api/vehicles/`, { headers });
        if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());

        // Billing and condo info for admins
        if (userRole in { admin_condominio: 1, administradora: 1 }) {
          const condosRes = await fetch(`${getBackendUrl()}/api/condos/`, { headers });
          if (condosRes.ok) setCondos(await condosRes.json());

          const plansRes = await fetch(`${getBackendUrl()}/api/billing/plans`, { headers });
          if (plansRes.ok) setPlans(await plansRes.json());

          const subRes = await fetch(`${getBackendUrl()}/api/billing/subscription`, { headers });
          if (subRes.ok) setSubscription(await subRes.json());

          const invoicesRes = await fetch(`${getBackendUrl()}/api/billing/invoices`, { headers });
          if (invoicesRes.ok) setInvoices(await invoicesRes.json());
          
          const usersRes = await fetch(`${getBackendUrl()}/api/users/`, { headers });
          if (usersRes.ok) setUsers(await usersRes.json());
        }
      }
    } catch (err) {
      console.error(err);
      setApiError("Falha ao comunicar com os servidores do Sentinel AI.");
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAlarm = async () => {
    if (!activeAlarmEvent) return;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/events/${activeAlarmEvent.id}/resolve`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          resolution_notes: "Fui eu (Morador confirmou saída autorizada)"
        })
      });
      if (res.ok) {
        setActiveAlarmEvent(null);
        fetchData(token, role);
      } else {
        alert("Erro ao responder ao alerta.");
      }
    } catch (err) {
      console.error(err);
      alert("Falha de conexão com o servidor.");
    }
  };

  const handleDismissAlarm = () => {
    setActiveAlarmEvent(null);
  };

  const handleTabClick = (tabName) => {
    setActiveTab(tabName);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    router.push("/");
  };

  const handleRequestNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        if (permission === "granted") {
          alert("Notificações de segurança ativadas com sucesso!");
        }
      } catch (err) {
        console.error("Erro ao solicitar permissão:", err);
      }
    }
  };

  const handleSendTestAlert = async (userId) => {
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/events/test-notification/${userId}`, {
        method: "POST",
        headers
      });
      if (res.ok) {
        alert("Alerta de teste enviado com sucesso! O morador receberá o push e a sirene visual/sonora.");
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.detail || "Erro ao enviar alerta de teste.");
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao se conectar ao servidor.");
    }
  };

  // --- ACTIONS ---

  const handleCreateCondo = async (e) => {
    e.preventDefault();
    setCondoError("");
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Reminder": "true"
    };
    try {
      const towersList = newCondo.towersInput
        ? newCondo.towersInput.split(",").map(t => t.trim()).filter(t => t.length > 0)
        : [];
      const payload = {
        name: newCondo.name,
        cnpj: newCondo.cnpj,
        address: newCondo.address,
        city: newCondo.city,
        state: newCondo.state,
        cep: newCondo.cep,
        email: newCondo.email,
        towers: towersList
      };
      const res = await fetch(`${getBackendUrl()}/api/condos/`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      let data;
      try { data = await res.json(); } catch (_) { data = {}; }
      if (!res.ok) {
        setCondoError(data.detail || "Erro ao criar condomínio. Verifique os dados.");
        return;
      }
      setNewCondo({ name: "", cnpj: "", address: "", city: "", state: "", cep: "", email: "", towersInput: "" });
      fetchData(token, role);
    } catch (err) {
      setCondoError("Falha de conexão com o servidor. Tente novamente.");
    }
  };

  const handleUpdateCondo = async (e) => {
    e.preventDefault();
    setCondoError("");
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Reminder": "true"
    };
    try {
      const towersList = editingCondo.towersInput
        ? editingCondo.towersInput.split(",").map(t => t.trim()).filter(t => t.length > 0)
        : [];
      const res = await fetch(`${getBackendUrl()}/api/condos/${editingCondo.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: editingCondo.name,
          cnpj: editingCondo.cnpj,
          address: editingCondo.address,
          city: editingCondo.city,
          state: editingCondo.state,
          cep: editingCondo.cep,
          email: editingCondo.email,
          phone: editingCondo.phone || null,
          logo_url: editingCondo.logo_url || null,
          towers: towersList
        })
      });
      let data;
      try { data = await res.json(); } catch (_) { data = {}; }
      if (!res.ok) {
        setCondoError(data.detail || "Erro ao atualizar condomínio.");
        return;
      }
      setEditingCondo(null);
      fetchData(token, role);
    } catch (err) {
      setCondoError("Falha de conexão com o servidor. Tente novamente.");
    }
  };

  const handleCreateCamera = async (e) => {
    e.preventDefault();
    let rtspUrl = newCamera.rtsp_url;
    
    if (isWebcamSelected) {
      // Generate a unique stream key for MediaMTX
      const generatedId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      rtspUrl = `rtsp://mediamtx:8554/${generatedId}?source=publisher`;
    }

    const rtspUrlLower = rtspUrl.toLowerCase();
    const isPrivateIp = !isWebcamSelected && (
                        rtspUrlLower.includes("192.168.") || 
                        rtspUrlLower.includes("10.") || 
                        rtspUrlLower.includes("127.0.0.1") || 
                        rtspUrlLower.includes("localhost") ||
                        /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(rtspUrlLower));
    
    if (isPrivateIp) {
      const confirmProceed = confirm(
        "Atenção: Você está cadastrando uma câmera com IP local (privado).\n\n" +
        "Se a câmera NÃO estiver na mesma rede física que o servidor do Sentinel AI (ex: em outra casa ou localidade), " +
        "este IP local não funcionará.\n\n" +
        "Nesse caso, você precisa configurar um Redirecionamento de Portas (Port Forwarding) no roteador da câmera " +
        "e usar o IP público ou DDNS. Deseja cadastrar assim mesmo?"
      );
      if (!confirmProceed) return;
    }

    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    const payload = {
      ...newCamera,
      rtsp_url: rtspUrl,
      latitude: newCamera.latitude === "" ? null : parseFloat(newCamera.latitude),
      longitude: newCamera.longitude === "" ? null : parseFloat(newCamera.longitude),
      condominium_id: newCamera.condominium_id === "" ? null : newCamera.condominium_id
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Erro ao cadastrar câmera");
      setNewCamera({ name: "", description: "", rtsp_url: "", location_name: "", latitude: "", longitude: "", condominium_id: "" });
      setIsWebcamSelected(false);
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateVehicle = async (e) => {
    e.preventDefault();
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    const payload = {
      ...newVehicle,
      year: newVehicle.year === "" ? null : parseInt(newVehicle.year, 10)
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/vehicles/`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        let errMsg = "Erro ao cadastrar veículo.";
        try {
          const data = await res.json();
          errMsg = data.detail || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
      }
      setNewVehicle({ plate: "", brand: "", model: "", year: "", color: "", nickname: "" });
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleApproveUser = async (userId) => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/users/${userId}/approve`, {
        method: "PUT",
        headers
      });
      if (!res.ok) throw new Error("Erro ao aprovar usuário");
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveZone = async (zoneData) => {
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/${selectedCameraId}/zones`, {
        method: "POST",
        headers,
        body: JSON.stringify(zoneData)
      });
      if (!res.ok) throw new Error("Erro ao salvar zona de monitoramento.");
      setShowZoneDrawer(false);
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteZone = async (zoneId) => {
    if (!confirm("Tem certeza que deseja excluir esta zona de monitoramento?")) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/zones/${zoneId}`, {
        method: "DELETE",
        headers
      });
      if (!res.ok) throw new Error("Erro ao excluir a zona.");
      fetchData(token, role);
      alert("Zona excluída com sucesso!");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateMonitoring = async (coordinates) => {
    if (!selectedVehicleId) {
      alert("Por favor, selecione um veículo primeiro.");
      return;
    }
    if (!selectedCameraForMonitoring) {
      alert("Por favor, selecione uma câmera primeiro.");
      return;
    }
    
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/monitoring/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          camera_id: selectedCameraForMonitoring,
          vehicle_id: selectedVehicleId,
          coordinates
        })
      });
      if (!res.ok) {
        let errMsg = "Erro ao salvar vaga monitorada.";
        try {
          const data = await res.json();
          errMsg = data.detail || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
      }
      setIsDrawingMonitoringSpot(false);
      setSelectedCameraForMonitoring("");
      fetchData(token, role);
      alert("Monitoramento de vaga ativado com sucesso!");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleStartDrawing = (clientX, clientY, target) => {
    const rect = target.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    
    setStartPoint({ x, y });
    setIsDraggingSpot(true);
    setShowSnappingConfirm(false);
    setTempPoints([
      { x, y },
      { x, y },
      { x, y },
      { x, y }
    ]);
  };

  const handleMoveDrawing = (clientX, clientY, target) => {
    if (!isDraggingSpot || !startPoint) return;
    
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    
    const xMin = Math.min(startPoint.x, x);
    const xMax = Math.max(startPoint.x, x);
    const yMin = Math.min(startPoint.y, y);
    const yMax = Math.max(startPoint.y, y);
    
    setTempPoints([
      { x: xMin, y: yMin },
      { x: xMax, y: yMin },
      { x: xMax, y: yMax },
      { x: xMin, y: yMax }
    ]);
  };

  const handleEndDrawing = () => {
    if (!isDraggingSpot) return;
    setIsDraggingSpot(false);
    
    if (tempPoints.length === 4) {
      const xDiff = Math.abs(tempPoints[2].x - tempPoints[0].x);
      const yDiff = Math.abs(tempPoints[2].y - tempPoints[0].y);
      if (xDiff < 0.015 || yDiff < 0.015) {
        setTempPoints([]);
        setStartPoint(null);
        return;
      }
      
      triggerAISnapping(tempPoints);
    }
  };

  const triggerAISnapping = async (points) => {
    if (!points || points.length !== 4) return;
    
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/${selectedCameraForMonitoring}/detections`);
      if (!res.ok) return;
      const detections = await res.json();
      
      if (!detections || detections.length === 0) {
        return;
      }
      
      const uxMin = Math.min(...points.map(p => p.x));
      const uxMax = Math.max(...points.map(p => p.x));
      const uyMin = Math.min(...points.map(p => p.y));
      const uyMax = Math.max(...points.map(p => p.y));
      
      const ucx = (uxMin + uxMax) / 2;
      const ucy = (uyMin + uyMax) / 2;
      
      let candidateVehicle = null;
      
      // 1. Try finding overlapping vehicle
      for (const d of detections) {
        const isOverlapping = uxMin < d.x2 && uxMax > d.x1 && uyMin < d.y2 && uyMax > d.y1;
        if (isOverlapping) {
          candidateVehicle = d;
          break;
        }
      }
      
      // 2. If no overlap, try closest vehicle within 0.4
      if (!candidateVehicle) {
        let minDistance = Infinity;
        for (const d of detections) {
          const dcx = (d.x1 + d.x2) / 2;
          const dcy = (d.y1 + d.y2) / 2;
          const dist = Math.sqrt((ucx - dcx)**2 + (ucy - dcy)**2);
          if (dist < minDistance) {
            minDistance = dist;
            candidateVehicle = d;
          }
        }
        if (minDistance > 0.4) {
          candidateVehicle = null;
        }
      }
      
      if (candidateVehicle) {
        const snapped = [
          { x: candidateVehicle.x1, y: candidateVehicle.y1 },
          { x: candidateVehicle.x2, y: candidateVehicle.y1 },
          { x: candidateVehicle.x2, y: candidateVehicle.y2 },
          { x: candidateVehicle.x1, y: candidateVehicle.y2 }
        ];
        
        setSnappedPoints(snapped);
        const translatedType = candidateVehicle.obj_type === "car" ? "Carro" 
                             : candidateVehicle.obj_type === "motorcycle" ? "Moto"
                             : candidateVehicle.obj_type === "truck" ? "Caminhão"
                             : "Veículo";
        setSuggestedVehicleType(translatedType);
        setShowSnappingConfirm(true);
      }
    } catch (err) {
      console.error("Erro no snapping assistido por IA:", err);
    }
  };

  const handleToggleMonitoring = async (monitoringId) => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/monitoring/${monitoringId}/toggle`, {
        method: "PUT",
        headers
      });
      if (!res.ok) throw new Error("Erro ao alterar o status do monitoramento.");
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteMonitoring = async (monitoringId) => {
    if (!confirm("Tem certeza que deseja remover esta vaga monitorada?")) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/monitoring/${monitoringId}`, {
        method: "DELETE",
        headers
      });
      if (!res.ok) throw new Error("Erro ao remover o monitoramento.");
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleResolveEvent = async (e) => {
    e.preventDefault();
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/events/${resolvingEventId}/resolve`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ resolution_notes: resolutionNotes })
      });
      if (!res.ok) throw new Error("Erro ao registrar a resolução da ocorrência.");
      setResolvingEventId(null);
      setResolutionNotes("");
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedEventIds.length === 0) return;
    if (!confirm(`Tem certeza que deseja excluir as ${selectedEventIds.length} ocorrências selecionadas?`)) {
      return;
    }
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/events/delete-bulk`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event_ids: selectedEventIds,
          delete_all: false
        })
      });
      if (!res.ok) throw new Error("Erro ao excluir as ocorrências selecionadas.");
      setSelectedEventIds([]);
      fetchData(token, role);
      alert("Ocorrências excluídas com sucesso!");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm("ATENÇÃO: Tem certeza que deseja excluir TODAS as ocorrências? Esta ação é irreversível!")) {
      return;
    }
    const headers = { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    try {
      const res = await fetch(`${getBackendUrl()}/api/events/delete-bulk`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event_ids: [],
          delete_all: true
        })
      });
      if (!res.ok) throw new Error("Erro ao excluir todas as ocorrências.");
      setSelectedEventIds([]);
      fetchData(token, role);
      alert("Todas as ocorrências foram excluídas com sucesso!");
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePayInvoice = async (invoiceId) => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/billing/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers
      });
      if (!res.ok) throw new Error("Erro ao realizar pagamento simulado.");
      fetchData(token, role);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTestCamera = async (camId) => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/${camId}/test`, {
        method: "POST",
        headers
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Status da Câmera: ${data.status.toUpperCase()}`);
        fetchData(token, role);
      }
    } catch (err) {
      alert("Erro ao testar stream.");
    }
  };

  const handleDeleteCamera = async (camId) => {
    if (!confirm("Tem certeza que deseja excluir esta câmera?")) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await fetch(`${getBackendUrl()}/api/cameras/${camId}`, {
        method: "DELETE",
        headers
      });
      if (res.ok) {
        alert("Câmera excluída com sucesso!");
        fetchData(token, role);
      } else {
        throw new Error("Erro ao excluir a câmera");
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredCameras = (role === "super_admin" || role === "administradora") && selectedCondoFilter
    ? cameras.filter((c) => c.condominium_id === selectedCondoFilter)
    : cameras;

  const filteredEvents = (role === "super_admin" || role === "administradora") && selectedCondoFilter
    ? events.filter((e) => e.condominium_id === selectedCondoFilter)
    : events;

  const filteredUsers = (role === "super_admin" || role === "administradora") && selectedCondoFilter
    ? users.filter((u) => u.condominium_id === selectedCondoFilter)
    : users;

  if (loading) {
    return (
      <div style={styles.loadingPage}>
        <div style={styles.spinner} />
        <span style={styles.loadingText}>Conectando ao Sentinel AI...</span>
      </div>
    );
  }

  const responsiveSidebarStyle = isMobile ? {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "260px",
    height: "100vh",
    zIndex: 1000,
    margin: 0,
    borderRadius: "0 16px 16px 0",
    transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
    transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    boxShadow: sidebarOpen ? "0 0 30px rgba(0, 0, 0, 0.7)" : "none",
    background: "rgba(18, 18, 22, 0.95)",
    backdropFilter: "blur(20px)",
    display: "flex",
    flexDirection: "column",
    padding: "16px"
  } : styles.sidebar;

  return (
    <div style={styles.dashboardContainer}>

      {/* Notification permission request banner */}
      {typeof window !== "undefined" && "Notification" in window && notificationPermission === "default" && (
        <div style={{
          backgroundColor: "#4f46e5",
          color: "#fff",
          padding: "10px 16px",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: "600",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
          zIndex: 9999
        }}>
          <span>🔔 Ative as notificações no navegador para receber alertas sonoros e de segurança em tempo real.</span>
          <button 
            onClick={handleRequestNotificationPermission}
            style={{
              backgroundColor: "#fff",
              color: "#4f46e5",
              border: "none",
              borderRadius: "4px",
              padding: "4px 12px",
              fontSize: "12px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            Ativar Notificações
          </button>
        </div>
      )}
      {/* HEADER NAVBAR */}
      <header style={styles.navbar} className="glass-panel">
        <div style={styles.navBrand}>
          <Shield size={24} color="#6366f1" />
          <h3 style={styles.navTitle}>SENTINEL AI</h3>
          {!isMobile && (
            <span style={styles.roleBadge} className="badge badge-low">
              {role.toUpperCase()}
            </span>
          )}
          {!isMobile && (role === "super_admin" || role === "administradora") && (
            <div style={{ marginLeft: "20px" }}>
              <select
                value={selectedCondoFilter}
                onChange={(e) => setSelectedCondoFilter(e.target.value)}
                className="input-field"
                style={{ 
                  padding: "4px 8px", 
                  width: "220px", 
                  fontSize: "13px", 
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  borderRadius: "6px",
                  outline: "none"
                }}
              >
                <option value="" style={{ background: "#18181b" }}>Todos os Condomínios</option>
                {condos.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: "#18181b" }}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div style={styles.navUser}>
          {!isMobile && <User size={16} color="#9ca3af" />}
          {!isMobile && <span style={styles.userName}>{userName}</span>}
          <button onClick={handleLogout} style={styles.btnLogout}>
            <LogOut size={16} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <div style={styles.layoutBody}>
        {/* Mobile Sidebar Overlay Backdrop */}
        {isMobile && sidebarOpen && (
          <div 
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
              zIndex: 999,
              animation: "fadeIn 0.2s ease-out"
            }}
          />
        )}

        {/* SIDEBAR TABS (Only shown on Desktop) */}
        {!isMobile && (
          <aside style={styles.sidebar} className="glass-panel">
            <nav style={styles.sidebarNav}>
              <button 
                onClick={() => handleTabClick("monitoramento")} 
                style={{...styles.sidebarBtn, ...(activeTab === "monitoramento" ? styles.sidebarBtnActive : {})}}
              >
                <Camera size={18} />
                <span>Central Live</span>
              </button>
              <button 
                onClick={() => handleTabClick("mapa")} 
                style={{...styles.sidebarBtn, ...(activeTab === "mapa" ? styles.sidebarBtnActive : {})}}
              >
                <Map size={18} />
                <span>Mapa</span>
              </button>
              
              <button 
                onClick={() => handleTabClick("ocorrencias")} 
                style={{...styles.sidebarBtn, ...(activeTab === "ocorrencias" ? styles.sidebarBtnActive : {})}}
              >
                <AlertTriangle size={18} />
                <span>Ocorrências</span>
                {stats.critical_unresolved_count > 0 && (
                  <span style={styles.alertCounter}>{stats.critical_unresolved_count}</span>
                )}
              </button>

              <button 
                onClick={() => handleTabClick("monitorar_vaga")} 
                style={{...styles.sidebarBtn, ...(activeTab === "monitorar_vaga" ? styles.sidebarBtnActive : {})}}
              >
                <Car size={18} />
                <span>Monitorar Vaga</span>
              </button>

              <button 
                onClick={() => handleTabClick("cadastros")} 
                style={{...styles.sidebarBtn, ...(activeTab === "cadastros" ? styles.sidebarBtnActive : {})}}
              >
                <Users size={18} />
                <span>Cadastros & Painel</span>
              </button>

              {role in { admin_condominio: 1, administradora: 1 } && (
                <button 
                  onClick={() => handleTabClick("faturamento")} 
                  style={{...styles.sidebarBtn, ...(activeTab === "faturamento" ? styles.sidebarBtnActive : {})}}
                >
                  <CreditCard size={18} />
                  <span>Assinatura</span>
                </button>
              )}
            </nav>
          </aside>
        )}

        {/* MAIN PANEL CONTENT */}
        <main style={{ ...styles.mainPanel, paddingBottom: isMobile ? "80px" : "4px" }}>
          {isMobile && (role === "super_admin" || role === "administradora") && (
            <div style={{ marginBottom: "16px", padding: "0 4px" }}>
              <select
                value={selectedCondoFilter}
                onChange={(e) => setSelectedCondoFilter(e.target.value)}
                className="input-field"
                style={{ 
                  width: "100%", 
                  padding: "10px 12px", 
                  fontSize: "14px", 
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  borderRadius: "8px",
                  outline: "none"
                }}
              >
                <option value="" style={{ background: "#18181b" }}>Todos os Condomínios</option>
                {condos.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: "#18181b" }}>
                    🏢 {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {apiError && <div style={styles.errorBanner}>{apiError}</div>}

          {/* TAB 1: MONITORAMENTO CENTRAL */}
          {activeTab === "monitoramento" && (
            <div style={styles.tabContent}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>Central de Monitoramento</h2>
                <div style={styles.gridControls}>
                  <span style={styles.gridLabel}>Grade:</span>
                  {[1, 4, 9, 16].map((num) => (
                    <button 
                      key={num} 
                      onClick={() => setGridSize(num)} 
                      style={{...styles.gridBtn, ...(gridSize === num ? styles.gridBtnActive : {})}}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera Stream Grid */}
              <div style={{
                ...styles.streamsGrid, 
                gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.ceil(Math.sqrt(gridSize))}, 1fr)`
              }}>
                {filteredCameras.slice(0, gridSize).map((cam) => {
                  const isAlarming = activeAlarmEvent && activeAlarmEvent.camera_id === cam.id;
                  const alarmCardStyle = isAlarming 
                    ? { 
                        border: blinkState ? "3px solid #eab308" : "3px solid #ef4444", 
                        boxShadow: blinkState ? "0 0 20px #eab308" : "0 0 20px #ef4444", 
                        backgroundColor: blinkState ? "rgba(234, 179, 8, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        transition: "all 0.15s ease-in-out"
                      } 
                    : {};
                  return (
                    <div key={cam.id} style={{ ...styles.streamCard, ...alarmCardStyle }} className="glass-card">
                    <div style={styles.streamHeader}>
                      <span style={styles.streamName}>{cam.name}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                        <span className={`badge badge-${cam.status === "online" ? "low" : "high"}`}>
                          {cam.status}
                        </span>
                        <button 
                          onClick={() => setExpandedCameraId(cam.id)}
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px"
                          }}
                          title="Expandir câmera"
                        >
                          ⛶ Expandir
                        </button>
                      </div>
                    </div>
                    <div style={styles.streamBody}>
                      <WebRTCOverlayPlayer 
                        streamId={cam.id} 
                        status={cam.status} 
                        showDetections={true}
                        activeMonitorings={monitorings.filter(m => m.camera_id === cam.id && m.is_active)}
                        zones={cam.zones || []}
                        rtspUrl={cam.rtsp_url}
                      />
                    </div>
                    {(role in { admin_condominio: 1, administradora: 1 } || role === "super_admin") && (
                      <div style={styles.streamFooter}>
                        <button 
                          onClick={() => {
                            setSelectedCameraId(cam.id);
                            setShowZoneDrawer(true);
                          }} 
                          style={styles.actionLink}
                        >
                          📐 Configurar Zonas
                        </button>
                        <button onClick={() => handleTestCamera(cam.id)} style={styles.actionLink}>
                          🔄 Testar RTSP
                        </button>
                      </div>
                    )}
                  </div>
                ); })}
                {filteredCameras.length === 0 && (
                  <div style={styles.emptyGrid}>
                    <p style={styles.emptyText}>Nenhuma câmera cadastrada neste condomínio.</p>
                  </div>
                )}
              </div>

              {/* Zone drawing overlay popup */}
              {showZoneDrawer && (
                <div style={styles.modalOverlay}>
                  <div style={styles.modalContainer}>
                    <CameraZoneDrawer 
                      cameraId={selectedCameraId}
                      status={cameras.find(c => c.id === selectedCameraId)?.status}
                      zones={cameras.find(c => c.id === selectedCameraId)?.zones || []}
                      onSave={handleSaveZone} 
                      onDeleteZone={handleDeleteZone}
                      onCancel={() => setShowZoneDrawer(false)} 
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: INTERACTIVE MAP */}
          {activeTab === "mapa" && (
            <div style={{ ...styles.tabContent, height: "calc(100vh - 140px)" }}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>Visualização de Câmeras e Zonas</h2>
              </div>
              <LeafletMap cameras={filteredCameras} events={filteredEvents} />
            </div>
          )}

          {/* TAB 3: OCORRENCIAS / ALERTS */}
          {activeTab === "ocorrencias" && (
            <div style={styles.tabContent}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>Histórico de Eventos & Alertas</h2>
                <div style={{ display: "flex", gap: "10px" }}>
                  {selectedEventIds.length > 0 && (
                    <button 
                      onClick={handleDeleteSelected} 
                      style={styles.btnDanger}
                    >
                      🗑️ Excluir Selecionados ({selectedEventIds.length})
                    </button>
                  )}
                  {filteredEvents.length > 0 && (
                    <button 
                      onClick={handleDeleteAll} 
                      style={styles.btnDangerOutline}
                    >
                      🗑️ Excluir Todas
                    </button>
                  )}
                </div>
              </div>

              {isMobile ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {filteredEvents.map((evt) => (
                        <div key={evt.id} style={{
                          background: "rgba(255, 255, 255, 0.03)",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: "12px",
                          padding: "16px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                              🕒 {new Date(evt.created_at).toLocaleString("pt-BR")}
                            </span>
                            <span className={`badge badge-${evt.risk_level}`} style={{ fontSize: "11px" }}>
                              {evt.risk_level.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={styles.objectLabel}>{evt.object_type.toUpperCase()}</span>
                            <span style={{ color: "#fff", fontWeight: "600", fontSize: "14px" }}>{evt.event_type}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "10px" }}>
                            <div>
                              {evt.is_resolved ? (
                                <span style={{ color: "var(--success)", fontSize: "13px" }}>✅ Resolvido</span>
                              ) : (
                                <span style={{ color: "var(--danger)", fontSize: "13px" }}>🚨 Ativo</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button 
                                onClick={() => setViewingEvent(evt)} 
                                style={styles.btnActionView}
                              >
                                👁 Ver
                              </button>
                              {role !== "morador" && !evt.is_resolved && (
                                <button 
                                  onClick={() => setResolvingEventId(evt.id)} 
                                  style={styles.btnActionResolve}
                                >
                                  Resolver
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredEvents.length === 0 && (
                        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                          Nenhuma ocorrência registrada até o momento.
                        </div>
                      )}
                    </div>
                  ) : (
                    <table style={styles.table}>
                      <thead>
                        <tr style={styles.tr}>
                          <th style={{ ...styles.th, width: "40px", textAlign: "center" }}>
                            <input 
                              type="checkbox" 
                              checked={filteredEvents.length > 0 && selectedEventIds.length === filteredEvents.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedEventIds(filteredEvents.map(evt => evt.id));
                                } else {
                                  setSelectedEventIds([]);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            />
                          </th>
                          <th style={styles.th}>Data/Hora</th>
                          <th style={styles.th}>Objeto</th>
                          <th style={styles.th}>Tipo de Alerta</th>
                          <th style={styles.th}>Risco</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEvents.map((evt) => (
                          <tr key={evt.id} style={{ ...styles.tr, backgroundColor: selectedEventIds.includes(evt.id) ? "rgba(239, 68, 68, 0.05)" : "transparent" }}>
                            <td style={{ ...styles.td, textAlign: "center" }}>
                              <input 
                                type="checkbox" 
                                checked={selectedEventIds.includes(evt.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedEventIds([...selectedEventIds, evt.id]);
                                  } else {
                                    setSelectedEventIds(selectedEventIds.filter(id => id !== evt.id));
                                  }
                                }}
                                style={{ cursor: "pointer" }}
                              />
                            </td>
                            <td style={styles.td}>
                              {new Date(evt.created_at).toLocaleString("pt-BR")}
                            </td>
                            <td style={styles.td}>
                              <span style={styles.objectLabel}>{evt.object_type.toUpperCase()}</span>
                            </td>
                            <td style={styles.td}>{evt.event_type}</td>
                            <td style={styles.td}>
                              <span className={`badge badge-${evt.risk_level}`}>
                                {evt.risk_level.toUpperCase()} ({evt.risk_score})
                              </span>
                            </td>
                            <td style={styles.td}>
                              {evt.is_resolved ? (
                                <span style={{ color: "var(--success)" }}>✅ Resolvido</span>
                              ) : (
                                <span style={{ color: "var(--danger)" }}>🚨 Ativo</span>
                              )}
                            </td>
                            <td style={styles.td}>
                              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <button 
                                  onClick={() => setViewingEvent(evt)} 
                                  style={styles.btnActionView}
                                >
                                  👁 Ver
                                </button>
                                {role !== "morador" && (
                                  !evt.is_resolved ? (
                                    <button 
                                      onClick={() => setResolvingEventId(evt.id)} 
                                      style={styles.btnActionResolve}
                                    >
                                      Resolver
                                    </button>
                                  ) : (
                                    <span style={styles.textNotes} title={evt.resolution_notes}>
                                      Resolvido
                                    </span>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredEvents.length === 0 && (
                          <tr>
                            <td colSpan={7} style={styles.emptyTableTd}>
                              Nenhum alerta ou ocorrência registrada até o momento.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}

              {/* Event Details and Media Modal */}
              {viewingEvent && (
                <div style={styles.modalOverlay}>
                  <div style={styles.occurrenceDetailsCard} className="glass-panel">
                    <h3 style={styles.modalTitle} style={{ margin: "0 0 16px 0", color: "#fff" }}>Detalhes da Ocorrência</h3>
                    
                    <div style={styles.detailsGrid}>
                      <div>
                        <p style={styles.detailLabel}>Data/Hora</p>
                        <p style={styles.detailValue}>{new Date(viewingEvent.created_at).toLocaleString("pt-BR")}</p>
                      </div>
                      <div>
                        <p style={styles.detailLabel}>Tipo de Alerta</p>
                        <p style={styles.detailValue}>{viewingEvent.event_type}</p>
                      </div>
                      <div>
                        <p style={styles.detailLabel}>Objeto</p>
                        <p style={styles.detailValue}>{viewingEvent.object_type.toUpperCase()}</p>
                      </div>
                      <div>
                        <p style={styles.detailLabel}>Nível de Risco</p>
                        <p style={styles.detailValue}>
                          <span className={`badge badge-${viewingEvent.risk_level}`}>
                            {viewingEvent.risk_level.toUpperCase()} ({viewingEvent.risk_score})
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Specific details from JSON */}
                    {viewingEvent.details && Object.keys(viewingEvent.details).length > 0 && (
                      <div style={styles.detailsSection}>
                        <p style={styles.detailLabel}>Informações Adicionais</p>
                        <div style={styles.jsonDetails}>
                          {viewingEvent.details.message && (
                            <p style={{ margin: "4px 0", color: "#e2e8f0" }}>
                              <strong>Mensagem:</strong> {viewingEvent.details.message}
                            </p>
                          )}
                          {viewingEvent.details.plate && (
                            <p style={{ margin: "4px 0", color: "#e2e8f0" }}>
                              <strong>Placa do Veículo:</strong> {viewingEvent.details.plate}
                            </p>
                          )}
                          {viewingEvent.details.duration_seconds && (
                            <p style={{ margin: "4px 0", color: "#e2e8f0" }}>
                              <strong>Duração da Suspeita:</strong> {viewingEvent.details.duration_seconds} segundos
                            </p>
                          )}
                          {viewingEvent.details.zone && (
                            <p style={{ margin: "4px 0", color: "#e2e8f0" }}>
                              <strong>Zona de Interesse:</strong> {viewingEvent.details.zone}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Resolution Section if resolved */}
                    {viewingEvent.is_resolved && (
                      <div style={styles.resolutionSection}>
                        <p style={styles.detailLabel} style={{ color: "var(--success)", fontWeight: "600", fontSize: "11px", margin: "0 0 4px 0" }}>Histórico de Resolução</p>
                        <p style={{ margin: "2px 0", color: "#fff", fontSize: "13px" }}>
                          <strong>Notas de Resolução:</strong> "{viewingEvent.resolution_notes}"
                        </p>
                      </div>
                    )}

                    {/* Media Display */}
                    <div style={styles.mediaContainer}>
                      {/* Image Frame */}
                      {viewingEvent.images && viewingEvent.images.length > 0 ? (
                        <div style={styles.mediaItem}>
                          <p style={styles.mediaLabel}>📸 Frame do Alerta</p>
                          <img 
                            src={viewingEvent.images[0].image_url.startsWith("http") ? viewingEvent.images[0].image_url : `${getBackendUrl()}${viewingEvent.images[0].image_url}`}
                            alt="Frame do Alerta" 
                            style={styles.mediaImage} 
                          />
                        </div>
                      ) : (
                        <div style={styles.mediaItem}>
                          <p style={styles.mediaLabel}>📸 Frame do Alerta</p>
                          <div style={styles.mediaPlaceholder}>
                            📸 Sem imagem registrada para esta ocorrência.
                          </div>
                        </div>
                      )}

                      {/* Video Clip */}
                      {viewingEvent.videos && viewingEvent.videos.length > 0 ? (
                        <div style={styles.mediaItem}>
                          <p style={styles.mediaLabel}>🎥 Clipe Gravado</p>
                          <video 
                            src={viewingEvent.videos[0].video_url.startsWith("http") ? viewingEvent.videos[0].video_url : `${getBackendUrl()}${viewingEvent.videos[0].video_url}`}
                            controls 
                            playsInline
                            muted
                            preload="auto"
                            style={styles.mediaVideo} 
                          />
                        </div>
                      ) : (
                        <div style={styles.mediaItem}>
                          <p style={styles.mediaLabel}>🎥 Clipe Gravado</p>
                          <div style={styles.mediaPlaceholder}>
                            🎥 Sem clipe de vídeo gravado para esta ocorrência.
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={styles.modalActions} style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                      <button 
                        type="button" 
                        onClick={() => setViewingEvent(null)} 
                        className="btn-primary"
                        style={{ padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Event Resolution Modal */}
              {resolvingEventId && (
                <div style={styles.modalOverlay}>
                  <form onSubmit={handleResolveEvent} style={styles.resolutionForm} className="glass-panel">
                    <h3 style={styles.modalTitle}>Registrar Resolução de Alerta</h3>
                    <p style={styles.modalDesc}>Por favor, registre a ocorrência ou as medidas adotadas (ex: contato com morador, verificação local).</p>
                    <textarea
                      required
                      placeholder="Descreva a resolução aqui..."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      style={styles.textarea}
                    />
                    <div style={styles.modalActions}>
                      <button 
                        type="button" 
                        onClick={() => setResolvingEventId(null)} 
                        className="btn-secondary"
                      >
                        Cancelar
                      </button>
                      <button type="submit" className="btn-primary">Salvar</button>
                    </div>
                  </form>
                </div>
              )}


            </div>
          )}

          {/* TAB 4: CADASTROS & CONFIGS */}
          {activeTab === "cadastros" && (
            <div style={styles.tabContent}>
              {(role === "super_admin" || role === "administradora" || role === "admin_condominio") ? (
                // SUPER ADMIN / ADMIN CONDO / ADMINISTRADORA VIEWS
                <div style={styles.adminConfigs}>
                  {/* Row 1: Condomínios */}
                  <div style={styles.tabGrid}>
                    <div style={styles.formCard} className="glass-panel">
                      <h3 style={styles.formTitle}>
                        {editingCondo ? "✏️ Editar Condomínio" : "Cadastrar Novo Condomínio"}
                      </h3>
                      {condoError && (
                        <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 14px", color: "#fca5a5", fontSize: "13px", marginBottom: "12px" }}>
                          ⚠️ {condoError}
                        </div>
                      )}
                      <form onSubmit={editingCondo ? handleUpdateCondo : handleCreateCondo} style={styles.formElement}>
                        <input
                          type="text" required placeholder="Nome do Condomínio"
                          value={editingCondo ? editingCondo.name : newCondo.name}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, name: e.target.value}) : setNewCondo({...newCondo, name: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="text" required placeholder="CNPJ"
                          value={editingCondo ? editingCondo.cnpj : newCondo.cnpj}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, cnpj: e.target.value}) : setNewCondo({...newCondo, cnpj: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="text" required placeholder="Endereço"
                          value={editingCondo ? editingCondo.address : newCondo.address}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, address: e.target.value}) : setNewCondo({...newCondo, address: e.target.value})}
                          className="input-field"
                        />
                        <div style={styles.dualInputs}>
                          <input
                            type="text" required placeholder="Cidade"
                            value={editingCondo ? editingCondo.city : newCondo.city}
                            onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, city: e.target.value}) : setNewCondo({...newCondo, city: e.target.value})}
                            className="input-field"
                          />
                          <input
                            type="text" required placeholder="Estado"
                            value={editingCondo ? editingCondo.state : newCondo.state}
                            onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, state: e.target.value}) : setNewCondo({...newCondo, state: e.target.value})}
                            className="input-field"
                          />
                        </div>
                        <input
                          type="text" required placeholder="CEP"
                          value={editingCondo ? editingCondo.cep : newCondo.cep}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, cep: e.target.value}) : setNewCondo({...newCondo, cep: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="email" required placeholder="E-mail de Contato"
                          value={editingCondo ? editingCondo.email : newCondo.email}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, email: e.target.value}) : setNewCondo({...newCondo, email: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="text" placeholder="Torres (Separadas por vírgula, ex: Torre A, Torre B)"
                          value={editingCondo ? (editingCondo.towersInput || "") : (newCondo.towersInput || "")}
                          onChange={(e) => editingCondo ? setEditingCondo({...editingCondo, towersInput: e.target.value}) : setNewCondo({...newCondo, towersInput: e.target.value})}
                          className="input-field"
                        />
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                            {editingCondo ? "💾 Salvar Alterações" : "Criar Condomínio"}
                          </button>
                          {editingCondo && (
                            <button type="button" className="btn-secondary" onClick={() => { setEditingCondo(null); setCondoError(""); }} style={{ flex: 1 }}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      </form>
                    </div>

                    <div style={styles.tableCard} className="glass-panel">
                      <h3 style={styles.formTitle}>Condomínios Cadastrados</h3>
                      {isMobile ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {condos.map((c) => (
                            <div key={c.id} style={{
                              background: "rgba(255, 255, 255, 0.03)",
                              border: "1px solid rgba(255, 255, 255, 0.08)",
                              borderRadius: "12px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px"
                            }}>
                              <div style={{ fontWeight: "600", color: "#fff" }}>{c.name}</div>
                              {c.towers && c.towers.length > 0 && (
                                <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                                  🏢 Torres: {c.towers.join(", ")}
                                </div>
                              )}
                              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                CNPJ: {c.cnpj} | {c.city} - {c.state}
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                <span style={{ color: "#10b981", fontSize: "12px" }}>💚 Ativo</span>
                                <button
                                  onClick={() => { setEditingCondo({...c, towersInput: c.towers ? c.towers.join(", ") : ""}); setCondoError(""); }}
                                  style={{ background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#60a5fa", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px" }}
                                >
                                  ✏️ Editar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <table style={styles.table}>
                          <thead>
                            <tr style={styles.tr}>
                              <th style={styles.th}>Nome / Torres</th>
                              <th style={styles.th}>CNPJ</th>
                              <th style={styles.th}>Cidade</th>
                              <th style={styles.th}>Status</th>
                              <th style={styles.th}>Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {condos.map((c) => (
                              <tr key={c.id} style={styles.tr}>
                                <td style={styles.td}>
                                  <div style={{ fontWeight: "600" }}>{c.name}</div>
                                  {c.towers && c.towers.length > 0 && (
                                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                                      🏢 Torres: {c.towers.join(", ")}
                                    </div>
                                  )}
                                </td>
                                <td style={styles.td}>{c.cnpj}</td>
                                <td style={styles.td}>{c.city} - {c.state}</td>
                                <td style={styles.td}>💚 Ativo</td>
                                <td style={styles.td}>
                                  <button
                                    onClick={() => { setEditingCondo({...c, towersInput: c.towers ? c.towers.join(", ") : ""}); setCondoError(""); }}
                                    style={{ background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#60a5fa", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px" }}
                                  >
                                    ✏️ Editar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Câmeras */}
                  <div style={{...styles.tabGrid, marginTop: "24px"}}>
                    <div style={styles.formCard} className="glass-panel">
                      <h3 style={styles.formTitle}>Cadastrar Câmera</h3>
                      <form onSubmit={handleCreateCamera} style={styles.formElement}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                          <input
                            type="checkbox"
                            id="super_admin_is_webcam"
                            checked={isWebcamSelected}
                            onChange={(e) => {
                              setIsWebcamSelected(e.target.checked);
                              setNewCamera({
                                ...newCamera,
                                rtsp_url: e.target.checked ? "" : newCamera.rtsp_url
                              });
                            }}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                          <label htmlFor="super_admin_is_webcam" style={{ fontSize: "14px", fontWeight: "500", cursor: "pointer", color: "#e4e4e7" }}>
                            Usar Webcam USB Local
                          </label>
                        </div>
                        <input
                          type="text" required placeholder="Nome da Câmera"
                          value={newCamera.name} onChange={(e) => setNewCamera({...newCamera, name: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="text" placeholder="Descrição"
                          value={newCamera.description} onChange={(e) => setNewCamera({...newCamera, description: e.target.value})}
                          className="input-field"
                        />
                        {!isWebcamSelected ? (
                          <input
                            type="text" required placeholder="Link RTSP (ou IP Webcam)"
                            value={newCamera.rtsp_url} onChange={(e) => setNewCamera({...newCamera, rtsp_url: e.target.value})}
                            className="input-field"
                          />
                        ) : (
                          <div style={{ fontSize: "12px", color: "#10b981", padding: "10px", border: "1px dashed #10b981", borderRadius: "6px", marginBottom: "10px", background: "rgba(16, 185, 129, 0.05)" }}>
                            📹 Webcam Local USB ativa. A URL do canal de streaming será gerada automaticamente ao criar.
                          </div>
                        )}
                        <input
                          type="text" placeholder="Localização (Ex: Portão Principal)"
                          value={newCamera.location_name} onChange={(e) => setNewCamera({...newCamera, location_name: e.target.value})}
                          className="input-field"
                        />
                        
                        <select
                          required
                          value={newCamera.condominium_id || ""}
                          onChange={(e) => setNewCamera({...newCamera, condominium_id: e.target.value})}
                          className="input-field"
                          style={{ appearance: "auto" }}
                        >
                          <option value="">Selecione o Condomínio da Câmera</option>
                          {condos.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        <div style={styles.dualInputs}>
                          <input
                            type="text" placeholder="Latitude"
                            value={newCamera.latitude} onChange={(e) => setNewCamera({...newCamera, latitude: e.target.value})}
                            className="input-field"
                          />
                          <input
                            type="text" placeholder="Longitude"
                            value={newCamera.longitude} onChange={(e) => setNewCamera({...newCamera, longitude: e.target.value})}
                            className="input-field"
                          />
                        </div>
                        <button type="submit" className="btn-primary">Criar Câmera</button>
                      </form>
                    </div>

                    <div style={styles.tableCard} className="glass-panel">
                      <h3 style={styles.formTitle}>Gerenciar Câmeras</h3>
                      {isMobile ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {filteredCameras.map((c) => {
                            const condoName = condos.find(condo => condo.id === c.condominium_id)?.name || "N/A";
                            return (
                              <div key={c.id} style={{
                                background: "rgba(255, 255, 255, 0.03)",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: "12px",
                                padding: "16px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px"
                              }}>
                                <div style={{ fontWeight: "600", color: "#fff" }}>{c.name}</div>
                                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                  🏢 Condomínio: {condoName}
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  🔗 {c.rtsp_url && c.rtsp_url.includes("source=publisher") ? "Webcam USB Local" : c.rtsp_url}
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                  <span className={`badge badge-${c.status === "online" ? "low" : "high"}`} style={{ fontSize: "11px" }}>
                                    {c.status}
                                  </span>
                                  <div style={{ display: "flex", gap: "8px" }}>
                                    <button onClick={() => handleTestCamera(c.id)} style={styles.btnActionResolve}>
                                      Testar
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteCamera(c.id)} 
                                      style={{
                                        ...styles.btnActionResolve, 
                                        color: "#ef4444", 
                                        borderColor: "rgba(239,68,68,0.3)"
                                      }}
                                    >
                                      Excluir
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <table style={styles.table}>
                          <thead>
                            <tr style={styles.tr}>
                              <th style={styles.th}>Câmera</th>
                              <th style={styles.th}>Condomínio</th>
                              <th style={styles.th}>RTSP</th>
                              <th style={styles.th}>Status</th>
                              <th style={styles.th}>Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCameras.map((c) => {
                              const condoName = condos.find(condo => condo.id === c.condominium_id)?.name || "N/A";
                              return (
                                <tr key={c.id} style={styles.tr}>
                                  <td style={styles.td}>{c.name}</td>
                                  <td style={styles.td} style={{ fontSize: "12px", color: "var(--text-muted)" }}>{condoName}</td>
                                  <td style={styles.td} style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {c.rtsp_url && c.rtsp_url.includes("source=publisher") ? "🔌 Webcam USB Local (Nativa)" : c.rtsp_url}
                                  </td>
                                  <td style={styles.td}>{c.status}</td>
                                  <td style={styles.td}>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                      <button onClick={() => handleTestCamera(c.id)} style={styles.btnActionResolve}>
                                        Testar
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteCamera(c.id)} 
                                        style={{
                                          ...styles.btnActionResolve, 
                                          color: "#ef4444", 
                                          borderColor: "rgba(239,68,68,0.3)"
                                        }}
                                      >
                                        Excluir
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Approvals */}
                  <div style={{ ...styles.tableCard, marginTop: "24px" }} className="glass-panel">
                    <h3 style={styles.formTitle}>Aprovação de Moradores & Operadores</h3>
                    {isMobile ? (
                       <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                         {filteredUsers.map((u) => {
                           const condoName = condos.find(c => c.id === u.condominium_id)?.name || "N/A";
                           return (
                             <div key={u.id} style={{
                               background: "rgba(255, 255, 255, 0.03)",
                               border: "1px solid rgba(255, 255, 255, 0.08)",
                               borderRadius: "12px",
                               padding: "16px",
                               display: "flex",
                               flexDirection: "column",
                               gap: "8px"
                             }}>
                               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                 <span style={{ fontWeight: "600", color: "#fff" }}>{u.name}</span>
                                 <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{u.role_id}</span>
                               </div>
                               <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                 🏢 {condoName} {u.apartment ? `| Apto: ${u.apartment} (${u.tower || "Torre 1"})` : ""}
                               </div>
                               <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                 ✉️ {u.email} | CPF: {u.cpf}
                               </div>
                               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                 <span style={{ fontSize: "12px" }}>Status: {u.status}</span>
                                 <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                   {u.status === "pending" && (
                                     <button onClick={() => handleApproveUser(u.id)} style={styles.btnApprove}>
                                       Aprovar
                                     </button>
                                   )}
                                   {u.role_id === "morador" && (
                                     <button
                                       onClick={() => handleSendTestAlert(u.id)}
                                       style={{
                                         background: "rgba(99,102,241,0.2)",
                                         border: "1px solid #6366f1",
                                         color: "#818cf8",
                                         padding: "4px 10px",
                                         borderRadius: "6px",
                                         cursor: "pointer",
                                         fontSize: "12px"
                                       }}
                                     >
                                       🔔 Testar Push
                                     </button>
                                   )}
                                 </div>
                               </div>
                             </div>
                           );
                         })}
                       </div>
                     ) : (
                       <table style={styles.table}>
                         <thead>
                           <tr style={styles.tr}>
                             <th style={styles.th}>Nome</th>
                             <th style={styles.th}>Condomínio</th>
                             <th style={styles.th}>Apto / Torre</th>
                             <th style={styles.th}>E-mail</th>
                             <th style={styles.th}>CPF</th>
                             <th style={styles.th}>Função</th>
                             <th style={styles.th}>Status</th>
                             <th style={styles.th}>Ação</th>
                           </tr>
                         </thead>
                         <tbody>
                           {filteredUsers.map((u) => {
                             const condoName = condos.find(c => c.id === u.condominium_id)?.name || "N/A";
                             return (
                               <tr key={u.id} style={styles.tr}>
                                 <td style={styles.td}>{u.name}</td>
                                 <td style={styles.td} style={{ fontSize: "13px", color: "var(--text-muted)" }}>{condoName}</td>
                                 <td style={styles.td} style={{ fontSize: "13px" }}>{u.apartment ? `${u.apartment} - ${u.tower || "Torre 1"}` : "-"}</td>
                                 <td style={styles.td}>{u.email}</td>
                                 <td style={styles.td}>{u.cpf}</td>
                                 <td style={styles.td}>{u.role_id}</td>
                                 <td style={styles.td}>{u.status}</td>
                                 <td style={styles.td}>
                                   <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                     {u.status === "pending" ? (
                                       <button onClick={() => handleApproveUser(u.id)} style={styles.btnApprove}>
                                         Aprovar
                                       </button>
                                     ) : (
                                       <span style={{ color: "var(--text-muted)" }}>Ativo</span>
                                     )}
                                     {u.role_id === "morador" && (
                                       <button
                                         onClick={() => handleSendTestAlert(u.id)}
                                         style={{
                                           background: "rgba(99,102,241,0.2)",
                                           border: "1px solid #6366f1",
                                           color: "#818cf8",
                                           padding: "6px 12px",
                                           borderRadius: "6px",
                                           cursor: "pointer",
                                           fontSize: "12px"
                                         }}
                                       >
                                         Testar Sirene
                                       </button>
                                     )}
                                   </div>
                                 </td>
                               </tr>
                             );
                           })}
                         </tbody>
                       </table>
                     )}
                  </div>

                </div>
              ) : role === "morador" ? (
                // MORADOR VIEWS
                <div style={styles.tabGrid}>
                  <div style={styles.formCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Cadastrar Novo Veículo</h3>
                    <form onSubmit={handleCreateVehicle} style={styles.formElement}>
                      <input
                        type="text" required placeholder="Placa (Ex: ABC1D23)"
                        value={newVehicle.plate} onChange={(e) => setNewVehicle({...newVehicle, plate: e.target.value})}
                        className="input-field"
                      />
                      <input
                        type="text" placeholder="Marca"
                        value={newVehicle.brand} onChange={(e) => setNewVehicle({...newVehicle, brand: e.target.value})}
                        className="input-field"
                      />
                      <input
                        type="text" placeholder="Modelo"
                        value={newVehicle.model} onChange={(e) => setNewVehicle({...newVehicle, model: e.target.value})}
                        className="input-field"
                      />
                      <input
                        type="text" placeholder="Ano"
                        value={newVehicle.year} onChange={(e) => setNewVehicle({...newVehicle, year: e.target.value})}
                        className="input-field"
                      />
                      <input
                        type="text" placeholder="Cor"
                        value={newVehicle.color} onChange={(e) => setNewVehicle({...newVehicle, color: e.target.value})}
                        className="input-field"
                      />
                      <input
                        type="text" placeholder="Apelido / Descrição (Ex: Carro do João)"
                        value={newVehicle.nickname} onChange={(e) => setNewVehicle({...newVehicle, nickname: e.target.value})}
                        className="input-field"
                      />
                      <button type="submit" className="btn-primary">Registrar Veículo</button>
                    </form>
                  </div>

                  <div style={styles.tableCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Seus Veículos Autorizados</h3>
                    <table style={styles.table}>
                      <thead>
                        <tr style={styles.tr}>
                          <th style={styles.th}>Placa</th>
                          <th style={styles.th}>Modelo</th>
                          <th style={styles.th}>Cor</th>
                          <th style={styles.th}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicles.map((v) => (
                          <tr key={v.id} style={styles.tr}>
                            <td style={styles.td}><strong>{v.plate}</strong></td>
                            <td style={styles.td}>{v.brand} {v.model}</td>
                            <td style={styles.td}>{v.color}</td>
                            <td style={styles.td}>
                              <span style={{ color: "var(--success)" }}>✓ Autorizado</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                // ADMIN CONDO / ADMINISTRADORA VIEWS
                <div style={styles.adminConfigs}>
                  <div style={styles.tabGrid}>
                    {/* Form camera */}
                    <div style={styles.formCard} className="glass-panel">
                      <h3 style={styles.formTitle}>Cadastrar Câmera</h3>
                      <form onSubmit={handleCreateCamera} style={styles.formElement}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                          <input
                            type="checkbox"
                            id="condo_admin_is_webcam"
                            checked={isWebcamSelected}
                            onChange={(e) => {
                              setIsWebcamSelected(e.target.checked);
                              setNewCamera({
                                ...newCamera,
                                rtsp_url: e.target.checked ? "" : newCamera.rtsp_url
                              });
                            }}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                          <label htmlFor="condo_admin_is_webcam" style={{ fontSize: "14px", fontWeight: "500", cursor: "pointer", color: "#e4e4e7" }}>
                            Usar Webcam USB Local
                          </label>
                        </div>
                        <input
                          type="text" required placeholder="Nome da Câmera"
                          value={newCamera.name} onChange={(e) => setNewCamera({...newCamera, name: e.target.value})}
                          className="input-field"
                        />
                        <input
                          type="text" placeholder="Descrição"
                          value={newCamera.description} onChange={(e) => setNewCamera({...newCamera, description: e.target.value})}
                          className="input-field"
                        />
                        {!isWebcamSelected ? (
                          <input
                            type="text" required placeholder="Link RTSP (ou IP Webcam)"
                            value={newCamera.rtsp_url} onChange={(e) => setNewCamera({...newCamera, rtsp_url: e.target.value})}
                            className="input-field"
                          />
                        ) : (
                          <div style={{ fontSize: "12px", color: "#10b981", padding: "10px", border: "1px dashed #10b981", borderRadius: "6px", marginBottom: "10px", background: "rgba(16, 185, 129, 0.05)" }}>
                            📹 Webcam Local USB ativa. A URL do canal de streaming será gerada automaticamente ao criar.
                          </div>
                        )}
                        <input
                          type="text" placeholder="Localização (Ex: Portão Principal)"
                          value={newCamera.location_name} onChange={(e) => setNewCamera({...newCamera, location_name: e.target.value})}
                          className="input-field"
                        />
                        <div style={styles.dualInputs}>
                          <input
                            type="text" placeholder="Latitude"
                            value={newCamera.latitude} onChange={(e) => setNewCamera({...newCamera, latitude: e.target.value})}
                            className="input-field"
                          />
                          <input
                            type="text" placeholder="Longitude"
                            value={newCamera.longitude} onChange={(e) => setNewCamera({...newCamera, longitude: e.target.value})}
                            className="input-field"
                          />
                        </div>
                        <button type="submit" className="btn-primary">Criar Câmera</button>
                      </form>
                    </div>

                    {/* Table lists */}
                    <div style={styles.tableCard} className="glass-panel">
                      <h3 style={styles.formTitle}>Gerenciar Câmeras</h3>
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tr}>
                            <th style={styles.th}>Câmera</th>
                            <th style={styles.th}>RTSP</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cameras.map((c) => (
                            <tr key={c.id} style={styles.tr}>
                              <td style={styles.td}>{c.name}</td>
                              <td style={styles.td} style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {c.rtsp_url && c.rtsp_url.includes("source=publisher") ? "🔌 Webcam USB Local (Nativa)" : c.rtsp_url}
                              </td>
                              <td style={styles.td}>{c.status}</td>
                              <td style={styles.td}>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button onClick={() => handleTestCamera(c.id)} style={styles.btnActionResolve}>
                                    Testar
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteCamera(c.id)} 
                                    style={{
                                      ...styles.btnActionResolve, 
                                      color: "#ef4444", 
                                      borderColor: "rgba(239,68,68,0.3)"
                                    }}
                                  >
                                    Excluir
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pending user approval panel */}
                  <div style={{ ...styles.tableCard, marginTop: "24px" }} className="glass-panel">
                    <h3 style={styles.formTitle}>Aprovação de Moradores & Operadores</h3>
                    <table style={styles.table}>
                      <thead>
                        <tr style={styles.tr}>
                          <th style={styles.th}>Nome</th>
                          <th style={styles.th}>Apto / Torre</th>
                          <th style={styles.th}>E-mail</th>
                          <th style={styles.th}>CPF</th>
                          <th style={styles.th}>Função</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} style={styles.tr}>
                            <td style={styles.td}>{u.name}</td>
                            <td style={styles.td} style={{ fontSize: "13px" }}>{u.apartment ? `${u.apartment} - ${u.tower || "Torre 1"}` : "-"}</td>
                            <td style={styles.td}>{u.email}</td>
                            <td style={styles.td}>{u.cpf}</td>
                            <td style={styles.td}>{u.role_id}</td>
                            <td style={styles.td}>{u.status}</td>
                            <td style={styles.td}>
                              {u.status === "pending" ? (
                                <button onClick={() => handleApproveUser(u.id)} style={styles.btnApprove}>
                                  Aprovar
                                </button>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>Ativo</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            )

            {/* TAB: MONITORAR VAGA NA RUA */}
            {activeTab === "monitorar_vaga" && (
              <div style={styles.tabContent}>
                <div style={styles.sectionHeader}>
                  <h2 style={styles.sectionTitle}>Monitorar Vaga na Rua</h2>
                </div>

                <div style={styles.tabGrid}>
                  {/* Ativação / Cadastro */}
                  <div style={styles.formCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Marcar Vaga Estacionada</h3>
                    <div style={styles.formElement}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ color: "#fff", fontSize: "14px", marginBottom: "6px" }}>Selecione o seu Veículo</label>
                        <select
                          value={selectedVehicleId}
                          onChange={(e) => setSelectedVehicleId(e.target.value)}
                          className="input-field"
                          style={{ appearance: "auto" }}
                        >
                          <option value="">Selecione o seu Veículo</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.brand} {v.model} ({v.plate})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                        <label style={{ color: "#fff", fontSize: "14px", marginBottom: "6px" }}>Selecione a Câmera</label>
                        <select
                          value={selectedCameraForMonitoring}
                          onChange={(e) => setSelectedCameraForMonitoring(e.target.value)}
                          className="input-field"
                          style={{ appearance: "auto" }}
                        >
                          <option value="">Selecione a Câmera</option>
                          {cameras.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.location_name ? `- ${c.location_name}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        onClick={() => {
                          if (!selectedVehicleId) {
                            alert("Selecione um veículo.");
                            return;
                          }
                          if (!selectedCameraForMonitoring) {
                            alert("Selecione uma câmera.");
                            return;
                          }
                          setTempPoints([]);
                          setIsDrawingMonitoringSpot(true);
                        }}
                        className="btn-primary"
                        style={{ marginTop: "20px" }}
                      >
                        Marcar Vaga na Câmera
                      </button>
                    </div>
                  </div>

                  {/* Vagas monitoradas ativas */}
                  <div style={styles.tableCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Suas Vagas Monitoradas</h3>
                    {isMobile ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {monitorings.map((m) => {
                          const vehicleName = vehicles.find((v) => v.id === m.vehicle_id);
                          const carLabel = vehicleName ? `${vehicleName.brand} ${vehicleName.model} (${vehicleName.plate})` : "Veículo";
                          const camName = cameras.find((c) => c.id === m.camera_id)?.name || "Câmera";
                          return (
                            <div key={m.id} style={{
                              background: "rgba(255, 255, 255, 0.03)",
                              border: "1px solid rgba(255, 255, 255, 0.08)",
                              borderRadius: "12px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px"
                            }}>
                              <div style={{ fontWeight: "600", color: "#fff" }}>{carLabel}</div>
                              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                📹 Câmera: {camName}
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                <button
                                  onClick={() => handleToggleMonitoring(m.id)}
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: "12px",
                                    borderRadius: "4px",
                                    border: "none",
                                    cursor: "pointer",
                                    background: m.is_active ? "var(--success)" : "var(--bg-secondary)",
                                    color: "#fff"
                                  }}
                                >
                                  {m.is_active ? "🟢 ATIVO" : "🔴 INATIVO"}
                                </button>
                                <button
                                  onClick={() => handleDeleteMonitoring(m.id)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#ef4444",
                                    cursor: "pointer"
                                  }}
                                >
                                  <Trash size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {monitorings.length === 0 && (
                          <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)" }}>
                            Nenhum veículo sendo monitorado no momento.
                          </div>
                        )}
                      </div>
                    ) : (
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tr}>
                            <th style={styles.th}>Veículo</th>
                            <th style={styles.th}>Câmera</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monitorings.map((m) => {
                            const vehicleName = vehicles.find((v) => v.id === m.vehicle_id);
                            const carLabel = vehicleName ? `${vehicleName.brand} ${vehicleName.model} (${vehicleName.plate})` : "Veículo";
                            const camName = cameras.find((c) => c.id === m.camera_id)?.name || "Câmera";
                            return (
                              <tr key={m.id} style={styles.tr}>
                                <td style={styles.td}><strong>{carLabel}</strong></td>
                                <td style={styles.td}>{camName}</td>
                                <td style={styles.td}>
                                  <button
                                    onClick={() => handleToggleMonitoring(m.id)}
                                    style={{
                                      padding: "4px 8px",
                                      fontSize: "12px",
                                      borderRadius: "4px",
                                      border: "none",
                                      cursor: "pointer",
                                      background: m.is_active ? "var(--success)" : "var(--bg-secondary)",
                                      color: "#fff"
                                    }}
                                  >
                                    {m.is_active ? "🟢 ATIVO" : "🔴 INATIVO"}
                                  </button>
                                </td>
                                <td style={styles.td}>
                                  <button
                                    onClick={() => handleDeleteMonitoring(m.id)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#ef4444",
                                      cursor: "pointer"
                                    }}
                                  >
                                    <Trash size={16} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {monitorings.length === 0 && (
                            <tr>
                              <td colSpan={4} style={styles.emptyTableTd}>
                                Nenhum veículo sendo monitorado no momento.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Drawing modal for resident parking spot */}
                {isDrawingMonitoringSpot && selectedCameraForMonitoring && (
                  <div style={styles.modalOverlay}>
                    <div style={{ ...styles.modalContainer, width: "640px" }} className="glass-panel">
                      <div style={{ padding: "20px" }}>
                        <h3 style={styles.formTitle}>Desenhe a Vaga de Estacionamento (Arraste o Dedo)</h3>
                        <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "12px" }}>
                          Arraste o dedo (no celular) ou o mouse para desenhar um quadrado sobre o seu veículo na câmera.
                        </p>
                        
                        <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000", borderRadius: "8px", overflow: "hidden", touchAction: "none" }}>
                          <WebRTCOverlayPlayer 
                             streamId={selectedCameraForMonitoring} 
                             status={cameras.find(c => c.id === selectedCameraForMonitoring)?.status} 
                             activeMonitorings={monitorings.filter(m => m.camera_id === selectedCameraForMonitoring && m.is_active)}
                             zones={cameras.find(c => c.id === selectedCameraForMonitoring)?.zones || []}
                             rtspUrl={cameras.find(c => c.id === selectedCameraForMonitoring)?.rtsp_url}
                          />
                          <canvas
                            onMouseDown={(e) => handleStartDrawing(e.clientX, e.clientY, e.currentTarget)}
                            onMouseMove={(e) => handleMoveDrawing(e.clientX, e.clientY, e.currentTarget)}
                            onMouseUp={handleEndDrawing}
                            onTouchStart={(e) => {
                              e.preventDefault();
                              const touch = e.touches[0];
                              handleStartDrawing(touch.clientX, touch.clientY, e.currentTarget);
                            }}
                            onTouchMove={(e) => {
                              e.preventDefault();
                              const touch = e.touches[0];
                              handleMoveDrawing(touch.clientX, touch.clientY, e.currentTarget);
                            }}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              handleEndDrawing();
                            }}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: "100%",
                              cursor: "crosshair",
                              zIndex: 10
                            }}
                            ref={(canvas) => {
                              if (!canvas) return;
                              const ctx = canvas.getContext("2d");
                              const rect = canvas.getBoundingClientRect();
                              canvas.width = rect.width;
                              canvas.height = rect.height;
                              ctx.clearRect(0, 0, canvas.width, canvas.height);
                              
                              // Draw user drawn rectangle
                              if (tempPoints.length > 0) {
                                ctx.lineWidth = 3;
                                ctx.strokeStyle = "#10b981";
                                ctx.fillStyle = "rgba(16, 185, 129, 0.2)";
                                ctx.beginPath();
                                tempPoints.forEach((pt, idx) => {
                                  const cx = pt.x * canvas.width;
                                  const cy = pt.y * canvas.height;
                                  if (idx === 0) ctx.moveTo(cx, cy);
                                  else ctx.lineTo(cx, cy);
                                });
                                if (tempPoints.length === 4) ctx.closePath();
                                ctx.stroke();
                                if (tempPoints.length === 4) ctx.fill();
                                
                                // Draw anchors
                                ctx.fillStyle = "#ffffff";
                                tempPoints.forEach((pt) => {
                                  ctx.beginPath();
                                  ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
                                  ctx.fill();
                                });
                              }

                              // Draw AI suggested snapped rectangle
                              if (showSnappingConfirm && snappedPoints.length === 4) {
                                ctx.lineWidth = 2;
                                ctx.strokeStyle = "#f59e0b";
                                ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
                                ctx.setLineDash([6, 4]); // dashed line
                                ctx.beginPath();
                                snappedPoints.forEach((pt, idx) => {
                                  const cx = pt.x * canvas.width;
                                  const cy = pt.y * canvas.height;
                                  if (idx === 0) ctx.moveTo(cx, cy);
                                  else ctx.lineTo(cx, cy);
                                });
                                ctx.closePath();
                                ctx.stroke();
                                ctx.fill();
                                ctx.setLineDash([]); // reset dash

                                // Draw AI label
                                ctx.fillStyle = "#f59e0b";
                                ctx.font = "bold 12px sans-serif";
                                ctx.fillText("🤖 Sugestão da IA", snappedPoints[0].x * canvas.width + 4, snappedPoints[0].y * canvas.height - 6);
                              }
                            }}
                          />
                        </div>

                        {showSnappingConfirm && (
                          <div style={{
                            background: "rgba(245, 158, 11, 0.1)",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            borderRadius: "8px",
                            padding: "14px",
                            marginTop: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px"
                          }}>
                            <p style={{ color: "#fef3c7", fontSize: "14px", margin: 0, lineHeight: "1.4" }}>
                              🤖 <strong>IA Sentinel:</strong> Encontramos um veículo ({suggestedVehicleType}) na área. Deseja ajustar o quadrado exatamente sobre ele?
                            </p>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                onClick={() => {
                                  setTempPoints(snappedPoints);
                                  setShowSnappingConfirm(false);
                                }}
                                className="btn-primary"
                                style={{ padding: "6px 12px", fontSize: "12px", background: "#f59e0b", borderColor: "#d97706" }}
                              >
                                Sim, Ajustar
                              </button>
                              <button
                                onClick={() => {
                                  setShowSnappingConfirm(false);
                                }}
                                className="btn-secondary"
                                style={{ padding: "6px 12px", fontSize: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)" }}
                              >
                                Não, Manter Meu Desenho
                              </button>
                              <button
                                onClick={() => {
                                  setShowSnappingConfirm(false);
                                  setTempPoints([]);
                                }}
                                className="btn-secondary"
                                style={{ padding: "6px 12px", fontSize: "12px", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
                              >
                                Refazer
                              </button>
                            </div>
                          </div>
                        )}
                        
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
                          <button 
                            onClick={() => {
                              setTempPoints([]);
                              setShowSnappingConfirm(false);
                            }} 
                            className="btn-secondary"
                            style={{ padding: "8px 16px" }}
                          >
                            Limpar
                          </button>
                          <button 
                            onClick={() => {
                              setIsDrawingMonitoringSpot(false);
                              setTempPoints([]);
                              setShowSnappingConfirm(false);
                            }} 
                            className="btn-secondary"
                            style={{ padding: "8px 16px" }}
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={() => {
                              if (tempPoints.length !== 4) {
                                alert("Arraste o dedo ou o mouse para desenhar a vaga.");
                                return;
                              }
                              handleCreateMonitoring(tempPoints);
                            }} 
                            className="btn-primary"
                            style={{ padding: "8px 16px" }}
                            disabled={showSnappingConfirm}
                          >
                            Ativar Monitoramento
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: FATURAMENTO & COBRANÇA */}
            {activeTab === "faturamento" && (role === "admin_condominio" || role === "administradora") && (
              <div style={styles.tabContent}>
                <div style={styles.sectionHeader}>
                  <h2 style={styles.sectionTitle}>Gerenciamento de Planos e Cobrança</h2>
                </div>

                <div style={styles.tabGrid}>
                  {/* Active subscription info */}
                  <div style={styles.formCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Sua Assinatura</h3>
                    <div style={styles.subDetail}>
                      <p>Status: <strong style={{ color: "var(--success)" }}>{subscription.status.toUpperCase()}</strong></p>
                      <p>Plano Atual: <strong>{plans.find((p) => p.id === subscription.plan_id)?.name || "Starter"}</strong></p>
                      <p>Validade: <strong>{new Date(subscription.current_period_end).toLocaleDateString()}</strong></p>
                    </div>

                    <div style={{ marginTop: "24px" }}>
                      <h4 style={{ color: "#fff", marginBottom: "12px" }}>Alterar Plano</h4>
                      <div style={styles.plansList}>
                        {plans.map((p) => (
                          <div key={p.id} style={styles.planItem} className="glass-card">
                            <div>
                              <strong>{p.name}</strong>
                              <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                Limite: {p.max_cameras} câmeras | {p.video_retention_days} dias de vídeo
                              </p>
                            </div>
                            <button 
                              onClick={() => {
                                fetch(`${getBackendUrl()}/api/billing/subscribe?plan_id=${p.id}`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${token}` }
                                }).then((res) => {
                                  if (res.ok) {
                                    alert("Inscrição efetuada! Pague a fatura gerada.");
                                    fetchData(token, role);
                                  }
                                });
                              }} 
                              className="btn-primary" 
                              style={{ padding: "6px 12px", fontSize: "13px" }}
                            >
                              R$ {p.price_cents / 100}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Invoices list */}
                  <div style={styles.tableCard} className="glass-panel">
                    <h3 style={styles.formTitle}>Faturas Emitidas (Stripe)</h3>
                    {isMobile ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {invoices.map((inv) => (
                          <div key={inv.id} style={{
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            borderRadius: "12px",
                            padding: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px"
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: "600", color: "#fff" }}>R$ {inv.amount_cents / 100}</span>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                📅 Vencimento: {new Date(inv.due_date).toLocaleDateString()}
                              </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                              <div>
                                {inv.status === "paid" ? (
                                  <span style={{ color: "var(--success)", fontSize: "12px" }}>Pago</span>
                                ) : (
                                  <span style={{ color: "var(--warning)", fontSize: "12px" }}>Pendente</span>
                                )}
                              </div>
                              {inv.status !== "paid" && (
                                <button onClick={() => handlePayInvoice(inv.id)} style={styles.btnApprove}>
                                  Pagar
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tr}>
                            <th style={styles.th}>Vencimento</th>
                            <th style={styles.th}>Valor</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv) => (
                            <tr key={inv.id} style={styles.tr}>
                              <td style={styles.td}>{new Date(inv.due_date).toLocaleDateString()}</td>
                              <td style={styles.td}>R$ {inv.amount_cents / 100}</td>
                              <td style={styles.td}>
                                {inv.status === "paid" ? (
                                  <span style={{ color: "var(--success)" }}>Pago</span>
                                ) : (
                                  <span style={{ color: "var(--warning)" }}>Pendente</span>
                                )}
                              </td>
                              <td style={styles.td}>
                                {inv.status !== "paid" && (
                                  <button onClick={() => handlePayInvoice(inv.id)} style={styles.btnApprove}>
                                    Pagar
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Fullscreen Expanded Camera Modal */}
            {expandedCameraId && (
              <div 
                ref={modalRef}
                style={{
                  ...styles.modalOverlay,
                  background: isMobile ? "#000" : "rgba(0,0,0,0.8)"
                }} 
                className={isClosingModal ? "modal-overlay-closing" : "modal-overlay-open"}
              >
                {isMobile ? (
                  /* Fullscreen Mobile View */
                  <div 
                    style={{ 
                      position: "relative", 
                      width: "100vw", 
                      height: "100vh", 
                      background: "#000", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      overflow: "hidden"
                    }}
                    className={isClosingModal ? "modal-container-closing" : "modal-container-open"}
                  >
                    {/* Floating Header Badge */}
                    <div style={{
                      position: "absolute",
                      top: "16px",
                      left: "16px",
                      zIndex: 1000,
                      background: "rgba(0, 0, 0, 0.6)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      borderRadius: "20px",
                      padding: "6px 14px",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                      <span style={{ color: "#fff", fontSize: "13px", fontWeight: "600" }}>
                        🎥 {cameras.find(c => c.id === expandedCameraId)?.name || "Câmera"}
                      </span>
                    </div>

                    {/* Floating Close Button */}
                    <button 
                      onClick={closeExpandedCamera}
                      style={{
                        position: "absolute",
                        top: "16px",
                        right: "16px",
                        zIndex: 1000,
                        background: "rgba(0, 0, 0, 0.6)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#fff",
                        fontSize: "20px",
                        cursor: "pointer",
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
                      }}
                    >
                      &times;
                    </button>

                    {/* 100% Fullscreen player wrapper */}
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <WebRTCOverlayPlayer 
                        streamId={expandedCameraId} 
                        status={cameras.find(c => c.id === expandedCameraId)?.status} 
                        showDetections={true}
                        activeMonitorings={monitorings.filter(m => m.camera_id === expandedCameraId && m.is_active)}
                        zones={cameras.find(c => c.id === expandedCameraId)?.zones || []}
                        rtspUrl={cameras.find(c => c.id === expandedCameraId)?.rtsp_url}
                        isFullscreen={true}
                      />
                    </div>
                  </div>
                ) : (
                  /* Standard Desktop Modal View */
                  <div 
                    style={{ 
                      ...styles.modalContainer, 
                      width: "90vw", 
                      maxWidth: "960px", 
                      height: "auto", 
                      maxHeight: "90vh", 
                      overflowY: "hidden", 
                      display: "flex", 
                      flexDirection: "column" 
                    }} 
                    className={`glass-panel ${isClosingModal ? "modal-container-closing" : "modal-container-open"}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <h3 style={{ margin: 0, color: "#fff" }}>
                        {cameras.find(c => c.id === expandedCameraId)?.name || "Câmera Expandida"}
                      </h3>
                      <button 
                        onClick={closeExpandedCamera}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#fff",
                          fontSize: "24px",
                          cursor: "pointer",
                          lineHeight: "1"
                        }}
                      >
                        &times;
                      </button>
                    </div>
                    <div style={{ flex: 1, position: "relative", background: "#000", overflow: "hidden" }}>
                      <WebRTCOverlayPlayer 
                        streamId={expandedCameraId} 
                        status={cameras.find(c => c.id === expandedCameraId)?.status} 
                        showDetections={true}
                        activeMonitorings={monitorings.filter(m => m.camera_id === expandedCameraId && m.is_active)}
                        zones={cameras.find(c => c.id === expandedCameraId)?.zones || []}
                        rtspUrl={cameras.find(c => c.id === expandedCameraId)?.rtsp_url}
                        isFullscreen={true}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          </main>
        </div>
        {isMobile && (
          <div style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            height: "64px",
            background: "rgba(15, 23, 42, 0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            zIndex: 999,
            paddingBottom: "safe-area-inset-bottom"
          }}>
            <button 
              onClick={() => setActiveTab("monitoramento")} 
              style={{
                background: "none",
                border: "none",
                color: activeTab === "monitoramento" ? "#6366f1" : "#9ca3af",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "10px",
                fontWeight: activeTab === "monitoramento" ? "700" : "500",
                cursor: "pointer",
                flex: 1
              }}
            >
              <Camera size={20} />
              <span>Live</span>
            </button>
            <button 
              onClick={() => setActiveTab("mapa")} 
              style={{
                background: "none",
                border: "none",
                color: activeTab === "mapa" ? "#6366f1" : "#9ca3af",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "10px",
                fontWeight: activeTab === "mapa" ? "700" : "500",
                cursor: "pointer",
                flex: 1
              }}
            >
              <Map size={20} />
              <span>Mapa</span>
            </button>
            <button 
              onClick={() => setActiveTab("ocorrencias")} 
              style={{
                background: "none",
                border: "none",
                color: activeTab === "ocorrencias" ? "#6366f1" : "#9ca3af",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "10px",
                fontWeight: activeTab === "ocorrencias" ? "700" : "500",
                cursor: "pointer",
                position: "relative",
                flex: 1
              }}
            >
              <AlertTriangle size={20} />
              <span>Alertas</span>
              {stats.critical_unresolved_count > 0 && (
                <span style={{
                  position: "absolute",
                  top: "-2px",
                  right: "24%",
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: "9px",
                  fontWeight: "700",
                  minWidth: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "2px"
                }}>{stats.critical_unresolved_count}</span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab("monitorar_vaga")} 
              style={{
                background: "none",
                border: "none",
                color: activeTab === "monitorar_vaga" ? "#6366f1" : "#9ca3af",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "10px",
                fontWeight: activeTab === "monitorar_vaga" ? "700" : "500",
                cursor: "pointer",
                flex: 1
              }}
            >
              <Car size={20} />
              <span>Vagas</span>
            </button>
            <button 
              onClick={() => setActiveTab("cadastros")} 
              style={{
                background: "none",
                border: "none",
                color: activeTab === "cadastros" ? "#6366f1" : "#9ca3af",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "10px",
                fontWeight: activeTab === "cadastros" ? "700" : "500",
                cursor: "pointer",
                flex: 1
              }}
            >
              <Users size={20} />
              <span>Painel</span>
            </button>
          </div>
        )}
      </div>
    );
  }

const styles = {
  dashboardContainer: {
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
    background: "#08080a",
  },
  navbar: {
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    margin: "12px",
    borderRadius: "12px",
  },
  navBrand: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  navTitle: {
    color: "#fff",
    fontSize: "18px",
    fontWeight: "700",
    letterSpacing: "1px",
  },
  roleBadge: {
    fontSize: "11px",
    padding: "3px 8px",
  },
  navUser: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  userName: {
    color: "var(--text-primary)",
    fontSize: "14px",
    fontWeight: "500",
  },
  btnLogout: {
    background: "none",
    border: "none",
    color: "#ef4444",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "14px",
    fontWeight: "600",
  },
  layoutBody: {
    display: "flex",
    flex: 1,
    padding: "0 12px 12px 12px",
    overflow: "hidden",
  },
  sidebar: {
    width: "240px",
    marginRight: "12px",
    padding: "16px",
    borderRadius: "12px",
  },
  sidebarNav: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sidebarBtn: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "12px 16px",
    background: "none",
    border: "none",
    color: "var(--text-secondary)",
    fontSize: "14px",
    fontWeight: "500",
    borderRadius: "8px",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s ease",
  },
  sidebarBtnActive: {
    background: "rgba(99,102,241,0.15)",
    color: "#fff",
    borderLeft: "4px solid var(--accent)",
  },
  alertCounter: {
    marginLeft: "auto",
    background: "#ef4444",
    color: "#fff",
    fontSize: "11px",
    fontWeight: "700",
    padding: "2px 6px",
    borderRadius: "9999px",
  },
  mainPanel: {
    flex: 1,
    overflowY: "auto",
    paddingRight: "4px",
  },
  errorBanner: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid var(--danger)",
    color: "#fca5a5",
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    textAlign: "center",
  },
  tabContent: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: "#fff",
    fontSize: "22px",
  },
  gridControls: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  gridLabel: {
    color: "var(--text-secondary)",
    fontSize: "13px",
  },
  gridBtn: {
    background: "var(--bg-secondary)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-color)",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  },
  gridBtnActive: {
    background: "var(--accent)",
    color: "#fff",
    borderColor: "var(--accent)",
  },
  streamsGrid: {
    display: "grid",
    gap: "16px",
    width: "100%",
  },
  streamCard: {
    display: "flex",
    flexDirection: "column",
    height: "auto",
    padding: "12px",
  },
  streamHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  streamName: {
    color: "#fff",
    fontWeight: "600",
    fontSize: "14px",
  },
  streamBody: {
    flex: 1,
    overflow: "hidden",
    borderRadius: "6px",
  },
  streamFooter: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "8px",
    fontSize: "12px",
  },
  actionLink: {
    background: "none",
    border: "none",
    color: "#6366f1",
    cursor: "pointer",
  },
  emptyGrid: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "300px",
    background: "var(--bg-secondary)",
    borderRadius: "12px",
    border: "1px dashed var(--border-color)",
  },
  emptyText: {
    color: "var(--text-secondary)",
  },
  eventsWrapper: {
    marginTop: "12px",
  },
  tableCard: {
    padding: "20px",
    borderRadius: "12px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
  },
  tr: {
    borderBottom: "1px solid var(--border-color)",
  },
  th: {
    padding: "12px 16px",
    color: "var(--text-secondary)",
    fontWeight: "600",
    fontSize: "13px",
  },
  td: {
    padding: "16px",
    color: "var(--text-primary)",
    fontSize: "14px",
  },
  objectLabel: {
    background: "rgba(255,255,255,0.05)",
    padding: "4px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
  },
  btnActionResolve: {
    background: "rgba(99,102,241,0.1)",
    border: "1px solid rgba(99,102,241,0.3)",
    color: "#818cf8",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
  },
  btnActionView: {
    background: "rgba(14,165,233,0.1)",
    border: "1px solid rgba(14,165,233,0.3)",
    color: "#38bdf8",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
  },
  btnDanger: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#ef4444",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
  },
  btnDangerOutline: {
    background: "transparent",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#9ca3af",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
  },
  occurrenceDetailsCard: {
    padding: "24px",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    width: "720px",
    maxWidth: "95%",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "rgba(15, 23, 42, 0.95)",
    backdropFilter: "blur(16px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "16px",
    background: "rgba(255, 255, 255, 0.02)",
    padding: "16px",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.03)",
  },
  detailLabel: {
    color: "var(--text-secondary)",
    fontSize: "11px",
    margin: "0 0 4px 0",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  detailValue: {
    color: "#fff",
    fontSize: "14px",
    fontWeight: "600",
    margin: 0,
  },
  detailsSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  jsonDetails: {
    background: "rgba(255, 255, 255, 0.03)",
    padding: "12px",
    borderRadius: "8px",
    fontSize: "13px",
    border: "1px solid rgba(255, 255, 255, 0.04)",
  },
  resolutionSection: {
    background: "rgba(34, 197, 94, 0.04)",
    border: "1px solid rgba(34, 197, 94, 0.15)",
    padding: "12px",
    borderRadius: "8px",
    fontSize: "13px",
  },
  mediaContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
    margin: "8px 0",
  },
  mediaItem: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  mediaLabel: {
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--text-secondary)",
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  mediaImage: {
    width: "100%",
    height: "200px",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    objectFit: "cover",
  },
  mediaVideo: {
    width: "100%",
    height: "200px",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "#000",
  },
  mediaPlaceholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "200px",
    background: "rgba(255, 255, 255, 0.01)",
    borderRadius: "8px",
    border: "1px dashed rgba(255, 255, 255, 0.08)",
    color: "var(--text-muted)",
    fontSize: "13px",
    textAlign: "center",
    padding: "16px",
  },
  textNotes: {
    fontSize: "12px",
    color: "var(--text-secondary)",
    cursor: "help",
    textDecoration: "underline",
  },
  emptyTableTd: {
    textAlign: "center",
    padding: "40px",
    color: "var(--text-muted)",
  },
  tabGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "24px",
  },
  formCard: {
    padding: "24px",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  formTitle: {
    color: "#fff",
    fontSize: "18px",
    marginBottom: "12px",
  },
  formElement: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  dualInputs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  adminConfigs: {
    display: "flex",
    flexDirection: "column",
  },
  btnApprove: {
    background: "var(--success)",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
  },
  subDetail: {
    background: "rgba(255,255,255,0.02)",
    padding: "16px",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  plansList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  planItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
  },
  modalOverlay: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.8)",
    zIndex: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modalContainer: {
    width: "90%",
    maxWidth: "700px",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  resolutionForm: {
    width: "480px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  modalTitle: {
    color: "#fff",
    fontSize: "18px",
  },
  modalDesc: {
    color: "var(--text-secondary)",
    fontSize: "13px",
  },
  textarea: {
    width: "100%",
    height: "100px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    color: "#fff",
    padding: "12px",
    borderRadius: "8px",
    outline: "none",
    resize: "none",
    fontSize: "14px",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
  },
  loadingPage: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#08080a",
    gap: "16px",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "3px solid rgba(99,102,241,0.1)",
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: {
    color: "var(--text-secondary)",
    fontSize: "14px",
  },
};
