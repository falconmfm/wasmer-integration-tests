# **Task 02 - CloudProber Monitoring Stack**

This project provides a complete setup to deploy **CloudProber** integrated with **Prometheus** and **Grafana** for monitoring various components. It includes all necessary configurations, scripts, and setup files to run the solution locally.

---

## **Project Structure**

The project folder is organized as follows:

```plaintext
.
├── cloudprober.cfg                   # Main CloudProber configuration for local execution
├── config
│   ├── cloudprober.cfg               # Alternative CloudProber configuration
│   └── prometheus.yml                # Prometheus configuration to connect CloudProber
├── docker-compose.yaml               # Docker Compose file to deploy CloudProber locally
├── prometheus.yml                    # Main Prometheus configuration
└── stack-prometheus-grafana          # Full stack: CloudProber, Prometheus, and Grafana
    ├── alertmanager
    │   └── config.yml                # Alertmanager configuration
    ├── cloudprober.cfg               # CloudProber configuration loading hosts from a file
    ├── convert_hosts.py              # Script to convert hosts list to CloudProber format
    ├── docker-compose.yml            # Docker Compose file for the full stack
    ├── grafana
    │   ├── config.monitoring         # Grafana configuration file
    │   └── provisioning
    │       ├── dashboards
    │       │   └── dashboard.yml     # Grafana dashboard configuration
    │       └── datasources
    │           └── datasource.yml    # Prometheus datasource for Grafana
    ├── hosts.json                    # Hosts file in JSON format
    ├── hosts.yaml                    # Input file with hosts and IPs
    ├── prometheus
    │   ├── alert.rules               # Prometheus alert rules
    │   └── prometheus.yml            # Prometheus configuration
    └── prometheus.yml                # Main Prometheus configuration
```

---

## **Prerequisites**

To execute this project, ensure the following tools are installed:

- **Docker** and **Docker Compose**
- **Python 3.x** (to run the `convert_hosts.py` script)
- **CloudProber**
- **Prometheus**
- **Grafana**

---

## **Setup and Execution**

### **1. CloudProber Configuration**

The main configuration for CloudProber is located in the `cloudprober.cfg` file. It includes:

- **Targets**: Loaded from the `hosts.yaml` file using the `convert_hosts.py` script.
- **Probes**: Defines latency, availability, and other checks.
- **Prometheus Integration**: Exports metrics compatible with Prometheus.

---

### **2. Converting Hosts to CloudProber Format**

To convert the `hosts.yaml` file into a valid CloudProber format, run the following script:

```bash
python3 stack-prometheus-grafana/convert_hosts.py stack-prometheus-grafana/hosts.yaml
```

---

### **3. Running CloudProber Locally**

To start CloudProber for local checks, use the following commands:

```bash
docker-compose up -d cloudprober
docker logs -f cloudprober
docker-compose down
```

Once running, you can access **CloudProber** at:

```plaintext
http://localhost:9313
```

---

### **4. Deploying the Full Monitoring Stack**

To deploy the full stack (CloudProber + Prometheus + Grafana), navigate to the `stack-prometheus-grafana` folder and run:

```bash
cd stack-prometheus-grafana
docker-compose up -d
```

---

### **5. Accessing Grafana**

Grafana is accessible at:

```plaintext
http://localhost:3000
```

**Credentials** (defined in `grafana/config.monitoring`):

- **Username**: `admin`
- **Password**: `foobar`

**Set Grafana Credentials in docker-compose.yml**
To configure the Grafana credentials, update the docker-compose.yml file by adding environment variables under the Grafana service definition:

```yaml

services:
  grafana:
    image: grafana/grafana
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=foobar
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - ./grafana/config.monitoring:/etc/grafana/grafana.ini
    depends_on:
      - prometheus
```

---

## **Prometheus Configuration**

The `prometheus.yml` file defines the connection to CloudProber's exported metrics and sets up alert rules.

---
## **Key Files**

- **cloudprober.cfg**: CloudProber main configuration file.
- **prometheus.yml**: Prometheus configuration.
- **docker-compose.yml**: Automates the deployment of CloudProber and the monitoring stack.
- **convert_hosts.py**: Script to process the list of hosts.

---
