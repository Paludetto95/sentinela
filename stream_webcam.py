import cv2
import subprocess
import shutil
import sys
import time

# Configurations
WEBCAM_INDEX = 0  # 0 is usually the built-in webcam
STREAM_PATH = "56f74236-5658-4bd7-b7fa-34caf5e847fe"  # ID da câmera ZV-E10 no banco de dados
RTMP_URL = f"rtmp://localhost:1935/{STREAM_PATH}"

def check_requirements():
    print("[1/2] Verificando dependências locais...")
    
    # Check OpenCV
    try:
        import cv2
    except ImportError:
        print("\n[ERRO] O pacote 'opencv-python' não está instalado no seu Python local.")
        print("Por favor, instale executando: pip install opencv-python")
        sys.exit(1)
        
    # Check FFmpeg
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        print("\n[Aviso] O executável 'ffmpeg' não foi encontrado no seu PATH do Windows.")
        print("Para enviar o sinal da sua webcam, você tem duas opções:")
        print("---------------------------------------------------------")
        print("Opção A (Recomendada - Fácil):")
        print("  1. Baixe e instale o OBS Studio (https://obsproject.com/).")
        print("  2. Adicione sua Webcam como fonte ('Dispositivo de Captura de Vídeo').")
        print("  3. Vá em Configurações > Transmissão e escolha:")
        print("     - Serviço: Personalizado")
        print("     - Servidor: rtmp://localhost:1935")
        print("     - Chave de Transmissão: webcam")
        print("  4. Clique em 'Iniciar Transmissão' no OBS!")
        print("---------------------------------------------------------")
        print("Opção B (Linha de comando):")
        print("  1. Baixe o ffmpeg (ex: de https://www.gyan.dev/ffmpeg/builds/).")
        print("  2. Adicione a pasta 'bin' do ffmpeg ao PATH do Windows e reinicie este script.")
        sys.exit(1)
        
    print("-> OpenCV e FFmpeg encontrados com sucesso!\n")

def stream():
    check_requirements()
    
    # Initialize webcam
    cap = cv2.VideoCapture(WEBCAM_INDEX)
    if not cap.isOpened():
        print(f"[ERRO] Não foi possível abrir a webcam no índice {WEBCAM_INDEX}.")
        sys.exit(1)
        
    # Get webcam properties
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0 or fps > 60:
        fps = 15 # default fallback
        
    print(f"Webcam iniciada: {width}x{height} @ {fps} FPS")
    print(f"Transmitindo para: {RTMP_URL}")
    print("---------------------------------------------------------")
    print("Para cadastrar no Sentinel AI:")
    print("Use o seguinte endereço no campo URL da câmera:")
    print("-> rtsp://mediamtx:8554/webcam")
    print("---------------------------------------------------------")
    print("Pressione 'Ctrl+C' no terminal para parar a transmissão.")
    
    # Ffmpeg command to ingest raw video frames from stdin and encode to RTMP
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",  # input from stdin pipe
        "-vcodec", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-f", "flv",
        RTMP_URL
    ]
    
    # Start ffmpeg process
    process = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                print("[Aviso] Falha ao ler frame da webcam.")
                time.sleep(0.03)
                continue
                
            # Write raw frame to ffmpeg stdin pipe
            try:
                process.stdin.write(frame.tobytes())
            except IOError:
                print("[Aviso] Conexão com o ffmpeg fechada.")
                break
                
    except KeyboardInterrupt:
        print("\nParando transmissão...")
    finally:
        cap.release()
        if process.stdin:
            process.stdin.close()
        process.terminate()
        process.wait()
        print("Transmissão finalizada.")

if __name__ == "__main__":
    stream()
