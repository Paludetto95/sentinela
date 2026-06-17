import urllib.request
import os

url = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt"
output_path = "ai_engine/yolo11n.pt"

print("Iniciando o download do YOLOv11 (yolo11n.pt)...")
try:
    urllib.request.urlretrieve(url, output_path)
    print("Download concluído com sucesso!")
except Exception as e:
    print(f"Erro ao baixar o modelo: {e}")
