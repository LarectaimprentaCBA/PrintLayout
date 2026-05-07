"""
Envia un payload al plotter via TCP.

Uso:
    python enviar.py <archivo.bin> [ip] [puerto]
"""
import socket
import sys


IP_DEFAULT = "192.168.100.250"
PUERTO_DEFAULT = 8080


def enviar(data: bytes, ip: str = IP_DEFAULT, puerto: int = PUERTO_DEFAULT,
           timeout: float = 10.0) -> None:
    with socket.create_connection((ip, puerto), timeout=timeout) as s:
        s.sendall(data)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    archivo = sys.argv[1]
    ip = sys.argv[2] if len(sys.argv) > 2 else IP_DEFAULT
    puerto = int(sys.argv[3]) if len(sys.argv) > 3 else PUERTO_DEFAULT

    with open(archivo, "rb") as f:
        data = f.read()

    print(f"Archivo: {archivo} ({len(data)} bytes)")
    print(f"Destino: {ip}:{puerto}")
    print()
    print("ATENCION: la maquina va a cortar. Asegurate de tener material cargado.")
    input("Enter para continuar, Ctrl+C para abortar... ")

    enviar(data, ip, puerto)
    print(f"OK. Enviados {len(data)} bytes.")


if __name__ == "__main__":
    main()
