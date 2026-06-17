import requests
import socket
from urllib.parse import urlparse
from app.core.config import settings

class MediaMTXService:
    def __init__(self):
        self.api_url = settings.MEDIAMTX_API_URL
        self.auth = ("admin", "sentinel_admin_pass")

    def add_path(self, path_name: str, rtsp_url: str) -> bool:
        """
        Dynamically adds an RTSP ingest path to MediaMTX config.
        """
        url = f"{self.api_url}/config/paths/add/{path_name}"
        source = "publisher" if "source=publisher" in rtsp_url.lower() else rtsp_url
        payload = {
            "source": source,
            "sourceOnDemand": False
        }
        try:
            response = requests.post(url, json=payload, auth=self.auth, timeout=5)
            if response.status_code not in [200, 201]:
                print(f"DEBUG MediaMTX add_path failed status {response.status_code}: {response.text}")
            return response.status_code in [200, 201]
        except Exception as e:
            print(f"Error adding path to MediaMTX: {e}")
            return False

    def remove_path(self, path_name: str) -> bool:
        """
        Removes a path from MediaMTX config.
        """
        url = f"{self.api_url}/config/paths/delete/{path_name}"
        try:
            response = requests.delete(url, auth=self.auth, timeout=5)
            if response.status_code not in [200, 204]:
                print(f"DEBUG MediaMTX remove_path failed status {response.status_code}: {response.text}")
            return response.status_code in [200, 204]
        except Exception as e:
            print(f"Error deleting path from MediaMTX: {e}")
            return False

    def test_rtsp_connection(self, rtsp_url: str) -> bool:
        """
        Tests if an RTSP, HTTP, local file, or local webcam index is reachable.
        """
        if not rtsp_url:
            return False
            
        rtsp_url_str = str(rtsp_url).strip()
        
        # Check if it's a browser-native publisher webcam
        if "source=publisher" in rtsp_url_str.lower():
            try:
                parsed = urlparse(rtsp_url_str)
                path_name = parsed.path.lstrip("/")
                url = f"{self.api_url}/paths/list"
                response = requests.get(url, auth=self.auth, timeout=3.0)
                if response.status_code == 200:
                    data = response.json()
                    items = data.get("items", [])
                    for item in items:
                        if item.get("name") == path_name:
                            return item.get("ready", False)
            except Exception as e:
                print(f"Error checking MediaMTX path status: {e}")
            return False

        # 1. Local USB Webcam check (e.g. "0", "1")
        if rtsp_url_str.isdigit():
            try:
                import cv2
                cap = cv2.VideoCapture(int(rtsp_url_str))
                if cap.isOpened():
                    cap.release()
                    return True
                return False
            except Exception:
                return False

        try:
            parsed = urlparse(rtsp_url_str)
            # 2. Local file path check
            if not parsed.scheme or not parsed.hostname:
                import os
                if os.path.exists(rtsp_url_str):
                    return True
                return False
                
            # 3. HTTP/HTTPS URLs (IP Webcams / MJPEG Streams / Image URLs)
            if parsed.scheme in ["http", "https"]:
                try:
                    # Try a HEAD request first with 3s timeout
                    response = requests.head(rtsp_url_str, timeout=3.0)
                    if response.status_code < 400:
                        return True
                except Exception:
                    pass
                try:
                    # Fallback to GET request for servers that block HEAD requests
                    response = requests.get(rtsp_url_str, timeout=3.0, stream=True)
                    if response.status_code < 400:
                        return True
                except Exception:
                    pass

            # 4. Socket TCP handshake for network streams (RTSP / RTMP / etc)
            host = parsed.hostname
            port = parsed.port
            if not port:
                scheme = parsed.scheme.lower()
                if scheme in ["rtsp", "rtspu"]:
                    port = 554
                elif scheme == "rtmp":
                    port = 1935
                elif scheme == "http":
                    port = 80
                elif scheme == "https":
                    port = 443
                else:
                    port = 554
                    
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(3.0)
                s.connect((host, port))
                return True
        except Exception as e:
            print(f"RTSP connection test failed for {rtsp_url_str}: {e}")
            return False

mediamtx_service = MediaMTXService()
