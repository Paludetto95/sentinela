"use client";

import { useEffect, useState, useRef } from "react";
import "leaflet/dist/leaflet.css";

export default function LeafletMap({ cameras = [], events = [] }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mounted || !mapContainerRef.current || mapRef.current) return;

    // Dynamically require Leaflet on the client side
    const L = require("leaflet");
    LRef.current = L;

    // Reset default icon paths (Next.js asset paths issue)
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    });

    const defaultLat = -23.5505;
    const defaultLng = -46.6333;

    // Initialize map with default view (Sao Paulo)
    const map = L.map(mapContainerRef.current).setView([defaultLat, defaultLng], 13);
    mapRef.current = map;

    // Centering map on user location using Geolocation API
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          map.setView([lat, lng], 13);

          // Add a custom marker indicating user's location
          const userIcon = L.divIcon({
            className: "custom-marker-user",
            html: `<div style="background:#10b981; width:18px; height:18px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px rgba(16,185,129,0.8); display:flex; align-items:center; justify-content:center;"><span style="width:8px; height:8px; background:#fff; border-radius:50%;"></span></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          });

          L.marker([lat, lng], { icon: userIcon })
            .bindPopup('<div style="color:#000; font-family:sans-serif; font-weight:bold;">Sua Localização</div>')
            .addTo(map);
        },
        (err) => {
          console.warn("Erro ao obter geolocalização do usuário:", err);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    }

    // Add Dark Mode Style Map Layer (CartoDB Dark Matter fits Verkada/Tesla premium dark UI)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    }).addTo(map);

  }, [mounted]);

  // Sync Markers
  useEffect(() => {
    if (!mounted || !mapRef.current || !LRef.current) return;

    const L = LRef.current;
    const map = mapRef.current;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    // Custom Icon for Cameras
    const cameraIcon = L.divIcon({
      className: "custom-marker-camera",
      html: `<div style="background:#6366f1; width:24px; height:24px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px rgba(99,102,241,0.5); display:flex; align-items:center; justify-content:center;"><span style="font-size:10px; color:#fff;">📹</span></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    // Custom Icon for Alerts
    const alertIcon = L.divIcon({
      className: "custom-marker-alert",
      html: `<div style="background:#ef4444; width:28px; height:28px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 15px rgba(239,68,68,0.8); display:flex; align-items:center; justify-content:center; animation: marker-pulse 1.2s infinite;"><span style="font-size:11px; color:#fff;">🚨</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    // Add camera markers
    cameras.forEach((cam) => {
      if (cam.latitude && cam.longitude) {
        L.marker([cam.latitude, cam.longitude], { icon: cameraIcon })
          .bindPopup(`
            <div style="color:#000; font-family:sans-serif;">
              <strong>${cam.name}</strong><br/>
              Status: ${cam.status === "online" ? "💚 Online" : "💔 Offline"}<br/>
              Local: ${cam.location_name || "Estacionamento"}
            </div>
          `)
          .addTo(map);
      }
    });

    // Add event/alert markers (mock geolocations around cameras or default layout)
    events.forEach((evt) => {
      // Find camera latitude/longitude to offset slightly
      const cam = cameras.find((c) => c.id === evt.camera_id);
      if (cam && cam.latitude && cam.longitude) {
        const offsetLat = cam.latitude + (Math.random() - 0.5) * 0.001;
        const offsetLng = cam.longitude + (Math.random() - 0.5) * 0.001;
        
        L.marker([offsetLat, offsetLng], { icon: alertIcon })
          .bindPopup(`
            <div style="color:#000; font-family:sans-serif; min-width:150px;">
              <strong style="color:#ef4444;">ALERTA DE SEGURANÇA</strong><br/>
              Tipo: ${evt.event_type}<br/>
              Risco: <strong>${evt.risk_level.toUpperCase()} (${evt.risk_score})</strong><br/>
              Horário: ${new Date(evt.created_at).toLocaleTimeString()}<br/>
              Objeto: ${evt.object_type}
            </div>
          `)
          .addTo(map);
      }
    });

    // Adjust view to show all markers if any
    const allCoords = [
      ...cameras.filter(c => c.latitude).map(c => [c.latitude, c.longitude]),
    ];
    if (allCoords.length > 0) {
      map.fitBounds(allCoords, { padding: [50, 50], maxZoom: 15 });
    }

  }, [mounted, cameras, events]);

  return (
    <div style={styles.container}>
      <div ref={mapContainerRef} style={styles.map} />
      <style jsx global>{`
        @keyframes marker-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); box-shadow: 0 0 20px rgba(239,68,68,0.9); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    width: "100%",
    height: "100%",
    borderRadius: "12px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  map: {
    width: "100%",
    height: "100%",
    background: "#0c0c0e",
  },
};
