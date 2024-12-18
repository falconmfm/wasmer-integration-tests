import yaml
import json

# Función principal
def process_yaml_to_json(input_file, output_file):
    # Cargar el archivo YAML
    with open(input_file, 'r') as yaml_file:
        hosts = yaml.safe_load(yaml_file)

    # Procesar los datos
    resources = []
    for host in hosts:
        resource = {
            "name": host["name"],
            "ip": host["global_ip4"],  # Extraer global_ip4
            "labels": {
                "device_type": "host"
            }
        }
        resources.append(resource)

    # Crear la estructura final
    output_data = {
        "resource": resources
    }

    # Guardar el resultado en formato JSON
    with open(output_file, 'w') as json_file:
        json.dump(output_data, json_file, indent=2)

    print(f"Archivo JSON generado: {output_file}")

# Archivos de entrada y salida
input_yaml = "hosts.yaml"    # Archivo de entrada en formato YAML
output_json = "hosts.json"   # Archivo de salida en formato JSON

# Ejecutar la función
process_yaml_to_json(input_yaml, output_json)

