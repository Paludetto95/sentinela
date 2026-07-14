import os
import time
import cv2
import threading
import collections
import numpy as np
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from ultralytics import YOLO



import redis
import json

DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://sentinel_admin:sentinel_password@postgres:5432/sentinel_db"
)
BACKEND_URL = os.getenv("API_URL", "http://backend:8000/api")
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))

# Load YOLOv26 Medium model with PyTorch GPU acceleration
import torch
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Initializing YOLOv26 on device: {device}")
model = YOLO("yolo26m.pt")
yolo_lock = threading.Lock()

active_workers = {}  # camera_id -> worker thread control flag

def disable_monitoring_in_db(monitoring_id):
    """
    Deactivates a vehicle monitoring zone in the database once the vehicle leaves
    to prevent repeated spamming of alerts.
    """
    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("UPDATE vehicle_monitorings SET is_active = FALSE WHERE id = %s;", (monitoring_id,))
        conn.commit()
        cur.close()
        print(f"[DATABASE] Disabled vehicle monitoring ID: {monitoring_id}")
    except Exception as e:
        print(f"Error disabling monitoring {monitoring_id}: {e}")
    finally:
        if conn:
            conn.close()

def is_point_in_polygon(x, y, poly):
    """
    Ray-casting algorithm to determine if a point is inside a polygon.
    All coordinates (x, y, poly) are normalized between 0.0 and 1.0.
    """
    n = len(poly)
    inside = False
    if n == 0:
        return False
    p1x, p1y = poly[0]["x"], poly[0]["y"]
    for i in range(n + 1):
        p2x, p2y = poly[i % n]["x"], poly[i % n]["y"]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (y - p1y if p2y - p1y == 0 else p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def calculate_iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    
    interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    
    unionArea = boxAArea + boxBArea - interArea
    if unionArea <= 0.0:
        return 0.0
    return interArea / unionArea

def calculate_overlap_ratio(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    
    interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    
    minArea = min(boxAArea, boxBArea)
    if minArea <= 0.0:
        return 0.0
    return interArea / minArea

def get_fp_category(obj_type):
    if obj_type == "person":
        return "person"
    if obj_type in ["car", "motorcycle", "truck", "bus"]:
        return "vehicle"
    return "other"

class ThreadedCamera:
    def __init__(self, source, name, is_numeric=False):
        self.source = source
        self.name = name
        self.is_numeric = is_numeric
        self.cap = None
        self.ret = False
        self.frame = None
        self.last_frame_time = 0.0
        self.frame_id = 0
        self.stopped = False
        self.lock = threading.Lock()
        
        self.cap = self._open_capture()
        self.thread = threading.Thread(target=self._update, name=f"CapThread-{name}", daemon=True)
        self.thread.start()

    def _open_capture(self):
        try:
            if self.is_numeric:
                c = cv2.VideoCapture(self.source)
                c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                return c
            else:
                c = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
                c.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                c.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                return c
        except Exception as e:
            print(f"Error opening VideoCapture in ThreadedCamera for {self.name}: {e}")
            return None

    def _update(self):
        consecutive_failures = 0
        while not self.stopped:
            if self.cap is not None and self.cap.isOpened():
                try:
                    ret, frame = self.cap.read()
                    if ret and frame is not None and frame.size > 0:
                        consecutive_failures = 0
                        with self.lock:
                            self.ret = True
                            self.frame = frame
                            self.last_frame_time = time.time()
                            self.frame_id += 1
                    else:
                        consecutive_failures += 1
                        if consecutive_failures > 50: # ~0.5 second of continuous failures
                            print(f"[ThreadedCamera] Stream {self.name} connection lost. Reconnecting...")
                            try:
                                self.cap.release()
                            except Exception:
                                pass
                            self.cap = None
                            time.sleep(2.0)
                        else:
                            time.sleep(0.01)
                except Exception as e:
                    print(f"Exception during frame read on camera thread {self.name}: {e}")
                    consecutive_failures += 1
                    time.sleep(0.1)
            else:
                time.sleep(2.0)
                if self.cap is not None:
                    try:
                        self.cap.release()
                    except Exception:
                        pass
                self.cap = self._open_capture()

    def read(self):
        with self.lock:
            # If we haven't received a new frame in 15 seconds, treat it as offline/disconnected
            if self.frame is not None and (time.time() - self.last_frame_time < 15.0):
                return self.ret, self.frame.copy(), self.frame_id
            return False, None, 0

    def release(self):
        self.stopped = True
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass

    def isOpened(self):
        return not self.stopped


class CameraWorker(threading.Thread):
    def __init__(self, camera_id, name, rtsp_url, zones, monitorings, false_positives=None):
        super().__init__()
        self.camera_id = camera_id
        self.name = name
        self.rtsp_url = rtsp_url
        self.zones = zones
        self.monitorings = monitorings
        self.false_positives = false_positives if false_positives is not None else []
        self.track_cache = {} # track_id -> { "obj_type": obj_type, "box": (x1, y1, x2, y2), "last_seen": timestamp, "missed_frames": 0 }
        self.stopped = False
        
        # Rolling frame buffer (150 frames) for occurrence recording
        self.frame_buffer = collections.deque(maxlen=150)
        self.last_record_time = 0.0



        # Track historical loitering timestamps: track_id -> first_seen_time
        self.track_history = {}
        # Track ReID features: track_id -> embedding/histogram
        self.reid_history = {}

        # Monitoring helper structures:
        # monitoring_id -> timestamp first seen empty
        self.monitoring_empty_since = {}
        # (monitoring_id, track_id) -> timestamp first seen suspect lingering
        self.monitoring_suspect_since = {}
        # monitoring_id -> dict containing track_id, parked coordinates, is_moving status, etc.
        self.monitoring_states = {}
        # Virtual monitoring for unassigned static vehicles
        self.virtual_monitorings = {}
        # Dynamic night mode state
        self.is_night = False

    def extract_reid_features(self, crop):
        """
        Extracts a lightweight visual descriptor based on HSV color histograms and aspect ratio.
        This provides a robust signature to identify vehicle profiles without a license plate.
        """
        if crop is None or crop.size == 0:
            return None
        # Convert to HSV color space
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        # Calculate color histograms for H and S channels
        h_hist = cv2.calcHist([hsv], [0], None, [8], [0, 180])
        s_hist = cv2.calcHist([hsv], [1], None, [8], [0, 256])
        # Normalize
        cv2.normalize(h_hist, h_hist, 0, 1, cv2.NORM_MINMAX)
        cv2.normalize(s_hist, s_hist, 0, 1, cv2.NORM_MINMAX)
        
        aspect_ratio = crop.shape[1] / crop.shape[0] if crop.shape[0] > 0 else 1.0
        
        # Concat features into a lightweight vector
        features = np.concatenate([h_hist.flatten(), s_hist.flatten(), [aspect_ratio]])
        return features.tolist()

    def run(self):
        print(f"Starting AI Worker for Camera: {self.name} ({self.rtsp_url})")
        
        # Force FFmpeg to disable buffering, reduce probing time and use TCP for low latency
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            "rtsp_transport;tcp;fflags;nobuffer;flags;low_delay;max_delay;500000;analyzeduration;100000;probesize;100000"
        )

        url_str = str(self.rtsp_url).strip()
        import re
        match = re.match(r'^([a-zA-Z0-9\+\-\.]+)(://.*)$', url_str)
        if match:
            url_str = match.group(1).lower() + match.group(2)

        is_numeric = url_str.isdigit()
        source = int(url_str) if is_numeric else url_str

        cap = ThreadedCamera(source, self.name, is_numeric)
        
        frame_count = 0
        last_processed_frame_id = 0
        
        while not self.stopped:
            ret = False
            frame = None
            if cap is not None and cap.isOpened():
                try:
                    ret, raw_frame, frame_id = cap.read()
                    if ret and raw_frame is not None and raw_frame.size > 0:
                        if frame_id == last_processed_frame_id:
                            # Frame hasn't changed, sleep briefly to yield GIL and save resources
                            time.sleep(0.003)
                            continue
                        last_processed_frame_id = frame_id
                        try:
                            # Auto-rotate vertical streams (height > width) to horizontal
                            h_raw, w_raw = raw_frame.shape[:2]
                            if h_raw > w_raw:
                                raw_frame = cv2.rotate(raw_frame, cv2.ROTATE_90_CLOCKWISE)
                                
                            h, w = raw_frame.shape[:2]
                            if w > 1920:
                                scale = 1920 / w
                                frame = cv2.resize(raw_frame, (1920, int(h * scale)))
                            else:
                                frame = raw_frame
                            
                            # Calculate average frame brightness to detect night mode dynamically
                            try:
                                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                                brightness = np.mean(gray)
                                self.is_night = (brightness < 55.0)
                            except Exception as brightness_err:
                                print(f"Error calculating brightness: {brightness_err}")
                            
                            # Append to rolling frame buffer
                            self.frame_buffer.append(frame.copy())
                            # Keep a copy of the last frame for alert keyframe snapshots
                            self.last_frame = frame.copy()
                            
                            ret_enc, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
                            if ret_enc:
                                redis_client.set(f"camera:{self.camera_id}:frame", buffer.tobytes(), ex=5)
                        except Exception as e:
                            print(f"Error publishing frame to Redis: {e}")
                except Exception as e:
                    print(f"Exception during frame read on camera {self.name}: {e}")
                    ret = False
            
            if not ret or frame is None or frame.size == 0:
                print(f"Failed to read from camera {self.name} (ThreadedCamera). Reconnecting/waiting...")
                time.sleep(2)
                continue

            # Process every frame for smooth 30 FPS tracking

            # Use imgsz=1920 for 1080p high definition inference
            imgsz_val = 1920

            # Run YOLO inference with Custom BoT-SORT tracker and optimized parameters
            with yolo_lock:
                results = model.track(
                    frame, 
                    persist=True, 
                    device=device,
                    classes=[0, 2, 3, 5, 7], # 0: person, 2: car, 3: motorcycle, 5: bus, 7: truck
                    imgsz=imgsz_val,
                    conf=0.08, # Base confidence threshold to filter out low-level noise before tracking (lowered to 0.08 for weak matching)
                    iou=0.45,
                    tracker="app/custom_tracker.yaml", # Custom tracker parameters
                    verbose=False
                )
            
            if not results or len(results) == 0:
                continue

            boxes = results[0].boxes
            h_img, w_img, _ = frame.shape
            class_map = {0: "person", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

            # Get ignored zones for this camera
            ignored_zones = [z for z in self.zones if z.get("zone_type") == "ignored"]

            # Extract boxes info safely
            xyxy_list = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else boxes.xyxy
            cls_list = boxes.cls.cpu().numpy() if hasattr(boxes.cls, "cpu") else boxes.cls
            conf_list = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else boxes.conf

            # Extract raw detections from the current frame (using xyxy_list, cls_list)
            raw_dets = []
            weak_dets = []
            is_night = getattr(self, "is_night", False)
            if boxes.id is not None:
                track_ids = boxes.id.cpu().numpy() if hasattr(boxes.id, "cpu") else boxes.id
                for box, track_id, cls, conf in zip(xyxy_list, track_ids, cls_list, conf_list):
                    tid = int(track_id)
                    class_id = int(cls)
                    obj_type = class_map.get(class_id, "unknown")
                    confidence = float(conf)
                    
                    # Trust YOLO active tracks: apply lower confidence thresholds to prevent flickering
                    if obj_type == "person":
                        min_conf = 0.05
                    elif obj_type == "motorcycle":
                        min_conf = 0.12 if is_night else 0.15
                    else:
                        min_conf = 0.14 if is_night else 0.16
                        
                    if confidence >= min_conf:
                        if obj_type in ["person", "car", "motorcycle", "truck", "bus"]:
                            x1, y1, x2, y2 = map(int, box)
                            raw_dets.append({
                                "obj_type": obj_type,
                                "box": (x1, y1, x2, y2),
                                "yolo_tid": tid
                            })
                    elif confidence >= 0.04:
                        if obj_type in ["person", "car", "motorcycle", "truck", "bus"]:
                            x1, y1, x2, y2 = map(int, box)
                            weak_dets.append({
                                "obj_type": obj_type,
                                "box": (x1, y1, x2, y2),
                                "yolo_tid": tid
                            })
            else:
                for box, cls, conf in zip(xyxy_list, cls_list, conf_list):
                    class_id = int(cls)
                    obj_type = class_map.get(class_id, "unknown")
                    confidence = float(conf)
                    
                    # Apply class-specific confidence thresholds for untracked detections
                    if obj_type == "person":
                        min_conf = 0.05
                    elif obj_type == "motorcycle":
                        min_conf = 0.15 if is_night else 0.18
                    else:
                        min_conf = 0.18 if is_night else 0.20
                        
                    if confidence >= min_conf:
                        if obj_type in ["person", "car", "motorcycle", "truck", "bus"]:
                            x1, y1, x2, y2 = map(int, box)
                            raw_dets.append({
                                "obj_type": obj_type,
                                "box": (x1, y1, x2, y2),
                                "yolo_tid": None
                            })
                    elif confidence >= 0.04:
                        if obj_type in ["person", "car", "motorcycle", "truck", "bus"]:
                            x1, y1, x2, y2 = map(int, box)
                            weak_dets.append({
                                "obj_type": obj_type,
                                "box": (x1, y1, x2, y2),
                                "yolo_tid": None
                            })

            # Match detections to self.track_cache using Two-Stage BYTETrack-like matching
            now = time.time()
            matched_raw_indices = set()
            matched_weak_indices = set()
            
            # First pass: try to match to existing cached tracks using high confidence (raw_dets)
            for tid, cached in list(self.track_cache.items()):
                best_iou = 0.0
                best_idx = None
                for idx, det in enumerate(raw_dets):
                    if idx in matched_raw_indices:
                        continue
                    if det["obj_type"] == cached["obj_type"]:
                        # If yolo_tid matches, it's a perfect match
                        if det["yolo_tid"] == tid:
                            best_iou = 1.0
                            best_idx = idx
                            break
                        iou = calculate_iou(det["box"], cached["box"])
                        if iou > best_iou:
                            best_iou = iou
                            best_idx = idx
                
                if best_idx is not None and (best_iou > 0.40 or best_iou == 1.0):
                    # Update cached track
                    det = raw_dets[best_idx]
                    
                    # Calculate center displacement to determine if static
                    old_box = cached.get("box", (0, 0, 0, 0))
                    new_box = det["box"]
                    old_cx = (old_box[0] + old_box[2]) / 2.0
                    old_cy = (old_box[1] + old_box[3]) / 2.0
                    new_cx = (new_box[0] + new_box[2]) / 2.0
                    new_cy = (new_box[1] + new_box[3]) / 2.0
                    disp = ((new_cx - old_cx)**2 + (new_cy - old_cy)**2)**0.5
                    
                    h_box = max(1, new_box[3] - new_box[1])
                    norm_disp = disp / float(h_box)
                    
                    disp_hist = cached.get("disp_hist", [])
                    disp_hist.append(disp)
                    if len(disp_hist) > 10:
                        disp_hist.pop(0)
                        
                    norm_disp_hist = cached.get("norm_disp_hist", [])
                    norm_disp_hist.append(norm_disp)
                    if len(norm_disp_hist) > 10:
                        norm_disp_hist.pop(0)
                        
                    # Calculate average displacement over last history entries
                    avg_disp = sum(disp_hist) / len(disp_hist) if disp_hist else 0.0
                    avg_norm_disp = sum(norm_disp_hist) / len(norm_disp_hist) if norm_disp_hist else 0.0
                    
                    # If average displacement is small, consider it static (stationary)
                    # Require at least 3 historical matches to confirm it's static
                    is_static = avg_disp < 4.0 if len(disp_hist) >= 3 else False
                    
                    # Speed-based reclassification: if detected as "person" but moving fast, it is a motorcycle
                    # Lock class once it's classified as motorcycle to prevent flickering
                    if cached.get("obj_type") == "motorcycle":
                        obj_type = "motorcycle"
                    else:
                        obj_type = det["obj_type"]
                        if obj_type == "person" and len(disp_hist) >= 2:
                            if avg_disp > 8.0 or (avg_disp > 6.0 and avg_norm_disp > 0.25):
                                obj_type = "motorcycle"
                    
                    self.track_cache[tid] = {
                        "obj_type": obj_type,
                        "box": det["box"],
                        "last_seen": now,
                        "missed_frames": 0,
                        "disp_hist": disp_hist,
                        "norm_disp_hist": norm_disp_hist,
                        "is_static": is_static,
                        "frames_detected": cached.get("frames_detected", 0) + 1
                    }
                    matched_raw_indices.add(best_idx)
                else:
                    # Second pass: try to match remaining tracks to weak detections (weak_dets)
                    best_iou_weak = 0.0
                    best_idx_weak = None
                    for idx, det in enumerate(weak_dets):
                        if idx in matched_weak_indices:
                            continue
                        if det["obj_type"] == cached["obj_type"]:
                            if det["yolo_tid"] == tid:
                                best_iou_weak = 1.0
                                best_idx_weak = idx
                                break
                            iou = calculate_iou(det["box"], cached["box"])
                            if iou > best_iou_weak:
                                best_iou_weak = iou
                                best_idx_weak = idx
                    
                    if best_idx_weak is not None and (best_iou_weak > 0.30 or best_iou_weak == 1.0):
                        # Update cached track with weak detection
                        det = weak_dets[best_idx_weak]
                        
                        old_box = cached.get("box", (0, 0, 0, 0))
                        new_box = det["box"]
                        old_cx = (old_box[0] + old_box[2]) / 2.0
                        old_cy = (old_box[1] + old_box[3]) / 2.0
                        new_cx = (new_box[0] + new_box[2]) / 2.0
                        new_cy = (new_box[1] + new_box[3]) / 2.0
                        disp = ((new_cx - old_cx)**2 + (new_cy - old_cy)**2)**0.5
                        
                        h_box = max(1, new_box[3] - new_box[1])
                        norm_disp = disp / float(h_box)
                        
                        disp_hist = cached.get("disp_hist", [])
                        disp_hist.append(disp)
                        if len(disp_hist) > 10:
                            disp_hist.pop(0)
                            
                        norm_disp_hist = cached.get("norm_disp_hist", [])
                        norm_disp_hist.append(norm_disp)
                        if len(norm_disp_hist) > 10:
                            norm_disp_hist.pop(0)
                            
                        avg_disp = sum(disp_hist) / len(disp_hist) if disp_hist else 0.0
                        avg_norm_disp = sum(norm_disp_hist) / len(norm_disp_hist) if norm_disp_hist else 0.0
                        
                        is_static = avg_disp < 4.0 if len(disp_hist) >= 3 else False
                        
                        if cached.get("obj_type") == "motorcycle":
                            obj_type = "motorcycle"
                        else:
                            obj_type = det["obj_type"]
                            if obj_type == "person" and len(disp_hist) >= 2:
                                if avg_disp > 8.0 or (avg_disp > 6.0 and avg_norm_disp > 0.25):
                                    obj_type = "motorcycle"
                        
                        self.track_cache[tid] = {
                            "obj_type": obj_type,
                            "box": det["box"],
                            "last_seen": now,
                            "missed_frames": 0,
                            "disp_hist": disp_hist,
                            "norm_disp_hist": norm_disp_hist,
                            "is_static": is_static,
                            "frames_detected": cached.get("frames_detected", 0) + 1
                        }
                        matched_weak_indices.add(best_idx_weak)
                    else:
                        # Mark as missed
                        cached["missed_frames"] += 1
                        
            # Third pass: add unmatched raw detections (strong) as new tracks
            for idx, det in enumerate(raw_dets):
                if idx in matched_raw_indices:
                    continue
                # Determine track ID: use yolo_tid if available and not already in cache
                tid = det["yolo_tid"]
                if tid is None or tid in self.track_cache:
                    # Generate a new unique ID
                    tid = int(time.time() * 1000) % 1000000
                    while tid in self.track_cache:
                        tid = (tid + 1) % 1000000
                        
                self.track_cache[tid] = {
                    "obj_type": det["obj_type"],
                    "box": det["box"],
                    "last_seen": now,
                    "missed_frames": 0,
                    "disp_hist": [],
                    "norm_disp_hist": [],
                    "is_static": False,
                    "frames_detected": 1
                }
                
            # Remove expired tracks
            for tid in list(self.track_cache.keys()):
                cached = self.track_cache[tid]
                obj_type = cached["obj_type"]
                is_static = cached.get("is_static", False)
                
                # For vehicle classes, keep alive up to 100 frames if static, or 20 frames if moving (to prevent flickering)
                if obj_type in ["car", "motorcycle", "truck", "bus"]:
                    max_missed = 100 if is_static else 20
                elif obj_type == "person":
                    max_missed = 30
                else:
                    max_missed = 5
                    
                if cached["missed_frames"] > max_missed:
                    del self.track_cache[tid]

            # Build the final lists of active objects for this frame
            detected_objects = []
            detections_detected = []
            
            # Identify active monitoring zones (restricted, parking, transit)
            active_zones = [z for z in self.zones if z.get("zone_type") in ["restricted", "parking", "transit"]]
            
            for tid, cached in self.track_cache.items():
                # Require at least 3 consecutive frames of detection to prevent transient noise
                if cached.get("frames_detected", 1) < 3:
                    continue
                
                # If the object is currently missed, only hide it if it's a person and missed for more than 3 frames,
                # or if it's a non-static/moving object missed for more than 1 frame.
                # If the person is close to a vehicle, we allow keeping them visible for up to 15 frames during temporary occlusion.
                if cached.get("missed_frames", 0) > 0:
                    cached_obj_type = cached["obj_type"]
                    is_static_vehicle = cached_obj_type in ["car", "motorcycle", "truck", "bus"] and cached.get("is_static", False)
                    if not is_static_vehicle:
                        is_near_vehicle = False
                        if cached_obj_type == "person":
                            for other_tid, other_cached in self.track_cache.items():
                                if other_cached["obj_type"] in ["car", "motorcycle", "truck", "bus"]:
                                    # Check IoU or overlap ratio in absolute coordinates
                                    iou = calculate_iou(cached["box"], other_cached["box"])
                                    overlap = calculate_overlap_ratio(cached["box"], other_cached["box"])
                                    if iou > 0.02 or overlap > 0.05:
                                        is_near_vehicle = True
                                        break
                        
                        if cached_obj_type == "person" and is_near_vehicle:
                            max_missed_before_hide = 25
                        elif cached_obj_type in ["person", "car", "motorcycle", "truck", "bus"]:
                            max_missed_before_hide = 15
                        else:
                            max_missed_before_hide = 5
                            
                        if cached["missed_frames"] >= max_missed_before_hide:
                            continue
                
                obj_type = cached["obj_type"]
                x1, y1, x2, y2 = cached["box"]
                cx = ((x1 + x2) / 2.0) / w_img
                cy = y2 / h_img # bottom center
                cy_center = ((y1 + y2) / 2.0) / h_img
                
                # Check ignored zones
                is_ignored = False
                for iz in ignored_zones:
                    if is_point_in_polygon(cx, cy_center, iz["coordinates"]) or is_point_in_polygon(cx, cy, iz["coordinates"]):
                        is_ignored = True
                        break
                if is_ignored:
                    continue
                
                # If active zones or active resident monitorings exist, restrict detections to those areas
                in_active_zone = True
                has_filter_zones = len(active_zones) > 0 or len(self.monitorings) > 0
                if has_filter_zones:
                    in_active_zone = False
                    for az in active_zones:
                        if is_point_in_polygon(cx, cy, az["coordinates"]) or is_point_in_polygon(cx, cy_center, az["coordinates"]):
                            in_active_zone = True
                            break
                    if not in_active_zone:
                        for m in self.monitorings:
                            m_coords = m.get("coordinates", [])
                            if is_point_in_polygon(cx, cy, m_coords) or is_point_in_polygon(cx, cy_center, m_coords):
                                in_active_zone = True
                                break
                    
                # Check static false positives
                det_box = [x1 / w_img, y1 / h_img, x2 / w_img, y2 / h_img]
                is_false_positive = False
                det_cat = get_fp_category(obj_type)
                for fp in self.false_positives:
                    fp_cat = get_fp_category(fp.get("obj_type"))
                    if det_cat == fp_cat:
                        coords = fp.get("coordinates", {})
                        fp_box = [
                            coords.get("x1", 0.0),
                            coords.get("y1", 0.0),
                            coords.get("x2", 0.0),
                            coords.get("y2", 0.0)
                        ]
                        iou = calculate_iou(det_box, fp_box)
                        overlap = calculate_overlap_ratio(det_box, fp_box)
                        if iou > 0.40 or overlap > 0.60:
                            is_false_positive = True
                            break
                if is_false_positive:
                    continue
                    
                # Valid object - add to tracking list if inside active monitoring zone
                if in_active_zone:
                    detected_objects.append({
                        "track_id": tid,
                        "obj_type": obj_type,
                        "cx": cx,
                        "cy": cy,
                        "box": (x1, y1, x2, y2)
                    })
                
                # Add to Redis frontend overlay list (always show visually on the dashboard)
                detections_detected.append({
                    "track_id": tid,
                    "obj_type": obj_type,
                    "x1": x1 / w_img,
                    "y1": y1 / h_img,
                    "x2": x2 / w_img,
                    "y2": y2 / h_img
                })

            # Inject manual detections from zones of interest if YOLO did not detect them
            for zone in self.zones:
                zone_type = zone.get("zone_type")
                if zone_type in ["manual_car", "manual_motorcycle", "manual_person"]:
                    # Map zone_type to target object type (e.g. manual_car -> car)
                    target_obj_type = zone_type.split("_")[1]
                    coords = zone.get("coordinates", [])
                    if not coords or len(coords) < 3:
                        continue
                    
                    xs = [p["x"] for p in coords]
                    ys = [p["y"] for p in coords]
                    x1_norm = min(xs)
                    y1_norm = min(ys)
                    x2_norm = max(xs)
                    y2_norm = max(ys)
                    
                    x1 = int(x1_norm * w_img)
                    y1 = int(y1_norm * h_img)
                    x2 = int(x2_norm * w_img)
                    y2 = int(y2_norm * h_img)
                    
                    manual_box = [x1_norm, y1_norm, x2_norm, y2_norm]
                    has_overlap = False
                    for obj in detected_objects:
                        if obj["obj_type"] == target_obj_type:
                            obj_box = [
                                obj["box"][0] / w_img,
                                obj["box"][1] / h_img,
                                obj["box"][2] / w_img,
                                obj["box"][3] / h_img
                            ]
                            iou = calculate_iou(manual_box, obj_box)
                            if iou > 0.40:
                                has_overlap = True
                                break
                                
                    if not has_overlap:
                        # Generate stable track ID based on zone ID
                        import hashlib
                        zone_id_str = str(zone.get("id", ""))
                        hash_val = int(hashlib.md5(zone_id_str.encode('utf-8')).hexdigest(), 16)
                        tid = 900000 + (hash_val % 100000)
                        
                        cx = (x1_norm + x2_norm) / 2.0
                        cy = y2_norm # bottom center
                        
                        detected_objects.append({
                            "track_id": tid,
                            "obj_type": target_obj_type,
                            "cx": cx,
                            "cy": cy,
                            "box": (x1, y1, x2, y2)
                        })
                        
                        detections_detected.append({
                            "track_id": tid,
                            "obj_type": zone_type,
                            "x1": x1_norm,
                            "y1": y1_norm,
                            "x2": x2_norm,
                            "y2": y2_norm
                        })

            try:
                redis_client.set(
                    f"camera:{self.camera_id}:detections",
                    json.dumps(detections_detected),
                    ex=30  # Expire after 30 seconds
                )
            except Exception as e:
                print(f"Error writing detections to Redis for camera {self.camera_id}: {e}")

            # 1. Standard Zone Monitoring
            for obj in detected_objects:
                tid = obj["track_id"]
                obj_type = obj["obj_type"]
                cx, cy = obj["cx"], obj["cy"]
                x1, y1, x2, y2 = obj["box"]
                
                # Check point in active zones
                in_zone = None
                for zone in self.zones:
                    if is_point_in_polygon(cx, cy, zone["coordinates"]):
                        in_zone = zone
                        break
                        
                if in_zone:
                    # Update tracking time
                    now = time.time()
                    if tid not in self.track_history:
                        self.track_history[tid] = now
                        
                    duration = now - self.track_history[tid]
                    
                    # Loitering / Danger logic
                    # Case A: Person in restricted zone for over 8 seconds
                    if obj_type == "person" and in_zone["zone_type"] == "restricted" and duration > 8:
                        self.trigger_alert(
                            track_id=tid,
                            obj_type=obj_type,
                            event_type="Pessoa parada em área restrita",
                            risk_score=int(80 * in_zone["risk_multiplier"]),
                            risk_level="high",
                            details={"duration_seconds": round(duration), "zone": in_zone["name"]}
                        )
                        self.track_history[tid] = now + 30.0  # prevent spamming
                    
                    # Case B: Vehicle in restricted zone for over 10 seconds
                    elif obj_type in ["car", "motorcycle", "truck", "bus"] and in_zone["zone_type"] == "restricted" and duration > 10:
                        self.trigger_alert(
                            track_id=tid,
                            obj_type=obj_type,
                            event_type="Veículo em área restrita",
                            risk_score=int(90 * in_zone["risk_multiplier"]),
                            risk_level="critical",
                            details={
                                "message": f"Veículo ({obj_type.upper()}) estacionado ou parado na área restrita: {in_zone['name']}!",
                                "duration_seconds": round(duration),
                                "zone": in_zone['name']
                            }
                        )
                        self.track_history[tid] = now + 30.0  # prevent spamming
            # Compile virtual monitorings for unassigned static vehicles
            for obj in detected_objects:
                if obj["obj_type"] in ["car", "motorcycle", "truck", "bus"]:
                    tid = obj["track_id"]
                    is_static = obj.get("is_static", False)
                    
                    # Check if overlaps with any resident monitoring
                    overlap_with_resident = False
                    for m in self.monitorings:
                        poly = m.get("coordinates", [])
                        if is_point_in_polygon(obj["cx"], obj["cy"], poly):
                            overlap_with_resident = True
                            break
                            
                    if overlap_with_resident:
                        if tid in self.virtual_monitorings:
                            self.virtual_monitorings.pop(tid, None)
                    else:
                        if is_static:
                            if tid not in self.virtual_monitorings:
                                # Generate virtual polygon by expanding bounding box
                                x1, y1, x2, y2 = obj["box"]
                                x1_norm = x1 / w_img
                                y1_norm = y1 / h_img
                                x2_norm = x2 / w_img
                                y2_norm = y2 / h_img
                                
                                pad_x = 0.05
                                pad_y = 0.05
                                x1_pad = max(0.0, x1_norm - pad_x)
                                y1_pad = max(0.0, y1_norm - pad_y)
                                x2_pad = min(1.0, x2_norm + pad_x)
                                y2_pad = min(1.0, y2_norm + pad_y)
                                
                                virtual_poly = [
                                    {"x": x1_pad, "y": y1_pad},
                                    {"x": x2_pad, "y": y1_pad},
                                    {"x": x2_pad, "y": y2_pad},
                                    {"x": x1_pad, "y": y2_pad}
                                ]
                                
                                monitoring_id = f"virtual_{tid}"
                                self.virtual_monitorings[tid] = {
                                    "id": monitoring_id,
                                    "user_id": None,
                                    "vehicle_id": None,
                                    "plate": "NÃO CADASTRADO",
                                    "coordinates": virtual_poly,
                                    "is_virtual": True,
                                    "vehicle_track_id": tid
                                }

            all_monitorings = list(self.monitorings) + list(self.virtual_monitorings.values())

            # 2. Resident & Virtual Vehicle Parking Spot Monitoring
            current_suspect_keys = set()
            for monitoring in all_monitorings:
                monitoring_id = str(monitoring["id"])
                is_virtual = monitoring.get("is_virtual", False)
                vehicle_id = str(monitoring["vehicle_id"]) if monitoring.get("vehicle_id") else None
                plate = monitoring["plate"]
                poly = monitoring["coordinates"]
                
                # Check if monitored vehicle is present in its coordinates in this frame
                vehicle_in_spot = None
                for obj in detected_objects:
                    if obj["obj_type"] in ["car", "motorcycle", "truck", "bus"]:
                        if is_point_in_polygon(obj["cx"], obj["cy"], poly):
                            vehicle_in_spot = obj
                            break
                            
                # Get or initialize state for this monitoring
                if monitoring_id not in self.monitoring_states:
                    if vehicle_in_spot:
                        self.monitoring_states[monitoring_id] = {
                            "track_id": vehicle_in_spot["track_id"],
                            "parked_cx": vehicle_in_spot["cx"],
                            "parked_cy": vehicle_in_spot["cy"],
                            "last_seen_in_spot": time.time(),
                            "is_moving": False,
                            "first_absent_time": None
                        }
                    continue
                
                state = self.monitoring_states[monitoring_id]
                
                # Check if the tracked vehicle is in the current frame (inside or outside)
                tracked_vehicle = None
                for obj in detected_objects:
                    if obj["track_id"] == state["track_id"]:
                        tracked_vehicle = obj
                        break
                
                if tracked_vehicle:
                    # Calculate displacement
                    dx = tracked_vehicle["cx"] - state["parked_cx"]
                    dy = tracked_vehicle["cy"] - state["parked_cy"]
                    dist = (dx**2 + dy**2) ** 0.5
                    if dist > 0.05: # moved at least 5% of image width/height
                        state["is_moving"] = True
                    
                    if is_point_in_polygon(tracked_vehicle["cx"], tracked_vehicle["cy"], poly):
                        state["last_seen_in_spot"] = time.time()
                        state["first_absent_time"] = None
                else:
                    # Tracked vehicle not found. Is there another vehicle in the spot?
                    if vehicle_in_spot:
                        # Update track_id to the new one if they are close
                        dx = vehicle_in_spot["cx"] - state["parked_cx"]
                        dy = vehicle_in_spot["cy"] - state["parked_cy"]
                        dist = (dx**2 + dy**2) ** 0.5
                        if dist < 0.05:
                            state["track_id"] = vehicle_in_spot["track_id"]
                            state["last_seen_in_spot"] = time.time()
                            state["first_absent_time"] = None
                        else:
                            # Reset state for a new parked vehicle
                            state["track_id"] = vehicle_in_spot["track_id"]
                            state["parked_cx"] = vehicle_in_spot["cx"]
                            state["parked_cy"] = vehicle_in_spot["cy"]
                            state["last_seen_in_spot"] = time.time()
                            state["first_absent_time"] = None
                            state["is_moving"] = False

                # Determine if vehicle is absent in this frame
                if vehicle_in_spot is None:
                    if state["first_absent_time"] is None:
                        state["first_absent_time"] = time.time()
                    absent_duration = time.time() - state["first_absent_time"]
                else:
                    state["first_absent_time"] = None
                    absent_duration = 0.0
                    self.monitoring_empty_since.pop(monitoring_id, None)
                
                # If vehicle is present, we can also check for suspicious hovering
                if vehicle_in_spot:
                    for obj in detected_objects:
                        if obj["obj_type"] == "person":
                            # Check multiple contact points to capture a suspect standing right next to the car (even if feet are slightly outside)
                            px1, py1, px2, py2 = obj["box"]
                            px1_n = px1 / w_img
                            px2_n = px2 / w_img
                            py1_n = py1 / h_img
                            py2_n = py2 / h_img
                            p_cy_center = ((py1 + py2) / 2.0) / h_img
                            
                            is_close_to_spot = (
                                is_point_in_polygon(obj["cx"], obj["cy"], poly) or  # bottom center
                                is_point_in_polygon(obj["cx"], p_cy_center, poly) or  # center
                                is_point_in_polygon(px1_n, py2_n, poly) or  # bottom left
                                is_point_in_polygon(px2_n, py2_n, poly) or  # bottom right
                                is_point_in_polygon(px1_n, p_cy_center, poly) or  # mid left
                                is_point_in_polygon(px2_n, p_cy_center, poly)  # mid right
                            )
                            
                            if is_close_to_spot:
                                key = (monitoring_id, obj["track_id"])
                                current_suspect_keys.add(key)
                                now = time.time()
                                
                                if key not in self.monitoring_suspect_since:
                                    self.monitoring_suspect_since[key] = {
                                        "start_time": now,
                                        "max_w_h_ratio": 0.0
                                    }
                                
                                # Calculate current aspect ratio
                                x1, y1, x2, y2 = obj["box"]
                                w = x2 - x1
                                h = y2 - y1
                                ratio = (w / h) if h > 0 else 0.0
                                
                                self.monitoring_suspect_since[key]["max_w_h_ratio"] = max(
                                    self.monitoring_suspect_since[key]["max_w_h_ratio"],
                                    ratio
                                )
                                
                                duration = now - self.monitoring_suspect_since[key]["start_time"]
                                is_crouching = self.monitoring_suspect_since[key]["max_w_h_ratio"] > 0.6
                                required_threshold = 5.0 if is_crouching else 30.0
                                
                                if duration > required_threshold:
                                    if is_virtual:
                                        if is_crouching:
                                            event_type = "Suspeito agachado junto ao veículo"
                                            message = "Suspeito agachado mexendo nas rodas de um veículo não cadastrado!"
                                            risk_score = 98
                                        else:
                                            event_type = "Suspeito rondando o veículo"
                                            message = "Pessoa em atitude suspeita ao lado de um veículo não cadastrado por mais de 30 segundos!"
                                            risk_score = 90
                                    else:
                                        if is_crouching:
                                            event_type = "Suspeito agachado junto ao veículo"
                                            message = f"Suspeito agachado mexendo nas rodas do veículo de placa {plate}!"
                                            risk_score = 98
                                        else:
                                            event_type = "Suspeito rondando o veículo"
                                            message = f"Pessoa em atitude suspeita ao lado do veículo de placa {plate} por mais de 30 segundos!"
                                            risk_score = 90
                                        
                                    self.trigger_alert(
                                        track_id=obj["track_id"],
                                        obj_type="person",
                                        event_type=event_type,
                                        risk_score=risk_score,
                                        risk_level="critical",
                                        details={
                                            "message": message,
                                            "plate": plate,
                                            "vehicle_id": vehicle_id,
                                            "monitoring_id": monitoring_id,
                                            "is_virtual": is_virtual
                                        }
                                    )
                                    self.monitoring_suspect_since[key] = {
                                        "start_time": now + 30.0,
                                        "max_w_h_ratio": 0.0
                                    }
                
                # Check alert condition for removal/movement
                # Trigger only if absent > 2.0s and moved, OR absent > 30.0s (fallback)
                should_trigger_alarm = (absent_duration > 2.0 and state["is_moving"]) or (absent_duration > 30.0)
                
                if should_trigger_alarm:
                    if is_virtual:
                        self.trigger_alert(
                            track_id=0,
                            obj_type="car",
                            event_type="Veículo não cadastrado saiu",
                            risk_score=20,
                            risk_level="info",
                            details={
                                "message": "Um veículo não cadastrado foi retirado ou saiu do local de estacionamento virtual.",
                                "plate": "NÃO CADASTRADO",
                                "monitoring_id": monitoring_id,
                                "is_virtual": True
                            }
                        )
                        # Remove from virtual monitorings
                        virtual_tid = monitoring.get("vehicle_track_id")
                        if virtual_tid in self.virtual_monitorings:
                            self.virtual_monitorings.pop(virtual_tid, None)
                    else:
                        self.trigger_alert(
                            track_id=0,
                            obj_type="car",
                            event_type="Veículo fora da vaga monitorada",
                            risk_score=100,
                            risk_level="critical",
                            details={
                                "message": f"Alerta de Segurança! O veículo de placa {plate} foi removido ou saiu da vaga monitorada na rua!",
                                "plate": plate,
                                "vehicle_id": vehicle_id,
                                "monitoring_id": monitoring_id
                            }
                        )
                        # DB call to deactivate
                        disable_monitoring_in_db(monitoring_id)
                        self.monitorings = [m for m in self.monitorings if str(m["id"]) != monitoring_id]
                        
                    self.monitoring_states.pop(monitoring_id, None)
                    self.monitoring_empty_since.pop(monitoring_id, None)

            # Cleanup expired suspect timers for persons no longer in the zone
            for key in list(self.monitoring_suspect_since.keys()):
                monitoring_id, person_track_id = key
                # Only clean up if the person is completely evicted from the cache (lost track)
                if person_track_id not in self.track_cache:
                    self.monitoring_suspect_since.pop(key, None)

            # Cleanup expired monitoring states for deleted monitorings
            active_monitoring_ids = {str(m["id"]) for m in self.monitorings} | {str(m["id"]) for m in self.virtual_monitorings.values()}
            for mid in list(self.monitoring_states.keys()):
                if mid not in active_monitoring_ids:
                    self.monitoring_states.pop(mid, None)
            for mid in list(self.monitoring_empty_since.keys()):
                if mid not in active_monitoring_ids:
                    self.monitoring_empty_since.pop(mid, None)

            # Cleanup expired track history items
            if len(self.track_history) > 100:
                self.track_history = {k: v for k, v in self.track_history.items() if time.time() - v < 60}

        cap.release()
        print(f"Stopped worker for camera: {self.name}")

    def trigger_alert(self, track_id, obj_type, event_type, risk_score, risk_level, details):
        """
        Sends the identified alert event to the FastAPI backend API.
        """
        url = f"{BACKEND_URL}/events/"
        payload = {
            "camera_id": self.camera_id,
            "track_id": track_id,
            "object_type": obj_type,
            "event_type": event_type,
            "risk_score": min(risk_score, 100),
            "risk_level": risk_level,
            "details": details
        }
        try:
            res = requests.post(url, json=payload, timeout=3)
            if res.status_code == 201:
                event_data = res.json()
                event_id = event_data.get("id")
                print(f"[ALERT] {event_type} - Risco: {risk_level} ({risk_score})")
                
                # Check cooldown to trigger a recording (limit to 1 recording per 30 seconds per camera)
                # Bypass cooldown entirely for critical alerts
                now = time.time()
                is_critical = (risk_level == "critical")
                if is_critical or (now - getattr(self, "last_record_time", 0.0) > 30.0):
                    if not is_critical:
                        self.last_record_time = now
                    key_frame = getattr(self, "last_frame", None)
                    if key_frame is not None:
                        threading.Thread(
                            target=self.save_and_upload_occurrence_media,
                            args=(event_id, key_frame.copy()),
                            daemon=True
                        ).start()
        except Exception as e:
            print(f"Failed to post alert event: {e}")

    def save_and_upload_occurrence_media(self, event_id, key_frame):
        import tempfile
        import os
        
        # Wait 3 seconds to capture the event unfolding in the buffer
        time.sleep(3.0)
        
        # Take a snapshot of the frame buffer
        buffer_snapshot = list(self.frame_buffer)
        if not buffer_snapshot:
            return

        print(f"[MEDIA] Generating video and image for event {event_id} ({len(buffer_snapshot)} frames)...")
        
        img_path = None
        vid_path = None
        vid_path_temp = None
        try:
            # Create temporary files
            fd_img, img_path = tempfile.mkstemp(suffix=".jpg")
            os.close(fd_img)
            fd_vid, vid_path = tempfile.mkstemp(suffix=".mp4")
            os.close(fd_vid)

            # Write alert keyframe image
            cv2.imwrite(img_path, key_frame)

            # Compile video clip from buffer frames using standard mp4v codec
            h_f, w_f = buffer_snapshot[0].shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            
            # Temp raw video path
            fd_temp_raw, vid_path_temp = tempfile.mkstemp(suffix="_raw.mp4")
            os.close(fd_temp_raw)
            
            # 10 FPS creates a smooth video for the ~150 frames (approx 15 seconds)
            out = cv2.VideoWriter(vid_path_temp, fourcc, 10.0, (w_f, h_f))
            for frame in buffer_snapshot:
                out.write(frame)
            out.release()

            # Convert to browser-compatible H.264 using ffmpeg
            import subprocess
            print(f"[MEDIA] Converting video to H.264 using ffmpeg...")
            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", vid_path_temp,
                "-vcodec", "libopenh264", "-pix_fmt", "yuv420p",
                "-profile:v", "main",
                vid_path
            ]
            try:
                subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                print(f"[MEDIA] H.264 transcoding complete.")
                upload_vid_path = vid_path
            except Exception as ffmpeg_err:
                print(f"[MEDIA] Ffmpeg conversion failed, falling back to raw mp4v: {ffmpeg_err}")
                upload_vid_path = vid_path_temp

            # Upload to backend
            with open(img_path, 'rb') as f_img, open(upload_vid_path, 'rb') as f_vid:
                files = {
                    'image': ('alert_frame.jpg', f_img, 'image/jpeg'),
                    'video': ('occurrence.mp4', f_vid, 'video/mp4')
                }
                upload_res = requests.post(f"{BACKEND_URL}/events/{event_id}/media", files=files, timeout=20)
                if upload_res.status_code == 200:
                    print(f"[MEDIA] Media uploaded successfully for event {event_id}")
                else:
                    print(f"[MEDIA] Failed to upload media: Status {upload_res.status_code} - {upload_res.text}")
        except Exception as e:
            print(f"[MEDIA] Error creating or uploading media for event {event_id}: {e}")
        finally:
            # Cleanup temporary files
            for p in [img_path, vid_path, vid_path_temp]:
                if p and os.path.exists(p):
                    try:
                         os.unlink(p)
                    except Exception:
                         pass

def get_cameras_from_db():
    """
    Fetches all registered cameras, their configured zones, and active vehicle monitorings from the PostgreSQL database.
    """
    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Select all cameras
        cur.execute("SELECT id, name, rtsp_url, status FROM cameras;")
        cameras = cur.fetchall()
        
        for cam in cameras:
            # Select zones for this camera
            cur.execute(
                "SELECT id, name, zone_type, coordinates, risk_multiplier FROM camera_zones WHERE camera_id = %s;",
                (cam["id"],)
            )
            cam["zones"] = cur.fetchall()
            
            # Select active vehicle monitorings for this camera
            cur.execute(
                """
                SELECT vm.id, vm.user_id, vm.vehicle_id, vm.coordinates, v.plate 
                FROM vehicle_monitorings vm 
                JOIN vehicles v ON vm.vehicle_id = v.id 
                WHERE vm.camera_id = %s AND vm.is_active = TRUE;
                """,
                (cam["id"],)
            )
            cam["monitorings"] = cur.fetchall()
            
            # Select false positives for this camera
            cur.execute(
                "SELECT id, obj_type, coordinates FROM camera_false_positives WHERE camera_id = %s;",
                (cam["id"],)
            )
            cam["false_positives"] = cur.fetchall()
            
        cur.close()
        return cameras
    except Exception as e:
        print(f"Error querying database for cameras: {e}")
        return []
    finally:
        if conn:
            conn.close()

def main():
    print("Sentinel AI Worker Daemon started.")
    
    # Wait for DB to boot completely
    time.sleep(5)
    
    while True:
        try:
            cameras = get_cameras_from_db()
            
            # Start workers for new cameras or update zone configs
            active_ids = {str(c["id"]) for c in cameras}
            
            # Stop workers for deleted cameras
            for cid in list(active_workers.keys()):
                if cid not in active_ids:
                    print(f"Stopping worker for camera id: {cid}")
                    active_workers[cid].stopped = True
                    del active_workers[cid]
            
            for cam in cameras:
                cid = str(cam["id"])
                # If worker doesn't exist, is dead, or rtsp_url has changed, spawn/restart it
                if (cid not in active_workers 
                    or not active_workers[cid].is_alive()
                    or active_workers[cid].rtsp_url != cam["rtsp_url"]):
                    
                    if cid in active_workers:
                        print(f"Stopping worker for camera id: {cid} because rtsp_url changed")
                        active_workers[cid].stopped = True
                        
                    worker = CameraWorker(
                        camera_id=cid,
                        name=cam["name"],
                        rtsp_url=cam["rtsp_url"],
                        zones=cam["zones"],
                        monitorings=cam["monitorings"],
                        false_positives=cam.get("false_positives", [])
                    )
                    active_workers[cid] = worker
                    worker.start()
                else:
                    # Update zones, active monitorings and false positives on running worker
                    active_workers[cid].zones = cam["zones"]
                    active_workers[cid].monitorings = cam["monitorings"]
                    active_workers[cid].false_positives = cam.get("false_positives", [])
                    
        except Exception as e:
            print(f"Main loop error: {e}")
            
        time.sleep(10)

if __name__ == "__main__":
    main()
