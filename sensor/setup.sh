#!/bin/bash
# Saturday Nights Billiard - Raspberry Pi Setup Script
# Run this on your Raspberry Pi after flashing Raspberry Pi OS

echo "🎱 Setting up Billiard Sensor System on Raspberry Pi..."

# Update system
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Python dependencies
pip3 install RPi.GPIO requests python-dotenv --break-system-packages

# Copy env file
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  Edit .env with your backend URL and sensor API key!"
fi

# Create systemd service so sensor starts automatically on boot
sudo tee /etc/systemd/system/billiard-sensor.service > /dev/null << 'EOF'
[Unit]
Description=Saturday Nights Billiard Sensor System
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/billiard-sensor/sensor.py
WorkingDirectory=/home/pi/billiard-sensor
Restart=always
RestartSec=10
User=pi

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable billiard-sensor
echo "✅ Service installed! It will start automatically on boot."
echo ""
echo "Commands:"
echo "  sudo systemctl start billiard-sensor   # Start now"
echo "  sudo systemctl stop billiard-sensor    # Stop"
echo "  sudo systemctl status billiard-sensor  # Check status"
echo "  journalctl -u billiard-sensor -f       # View live logs"
echo ""
echo "To test WITHOUT hardware:"
echo "  python3 sensor.py --simulate"
