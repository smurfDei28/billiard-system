#!/usr/bin/env python3
"""
Saturday Nights Billiard - Module 7: Sensor-Based Scoring
Raspberry Pi Code for IR Sensor Detection

Hardware Setup:
  - 6x FC-51 IR Sensors (one per pocket)
  - Raspberry Pi Zero 2W (or any Pi with GPIO)
  - Connect each sensor's OUT pin to a GPIO pin below

Wiring (FC-51 IR Sensor):
  VCC  → 3.3V or 5V
  GND  → GND  
  OUT  → GPIO pin (see POCKET_PINS below)

Install dependencies:
  pip3 install RPi.GPIO requests python-dotenv
"""

import os
import sys
import time
import json
import logging
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ───
API_BASE_URL = os.getenv('API_BASE_URL', 'http://your-backend-url:3000')
SENSOR_API_KEY = os.getenv('SENSOR_API_KEY', 'your-sensor-api-key')
TABLE_ID = os.getenv('TABLE_ID', 'table-1-uuid-here')
SESSION_ID = None  # Set dynamically when game starts

# GPIO pin mapping for each pocket
# Adjust these to your actual wiring
POCKET_PINS = {
    'TOP_LEFT':     17,
    'TOP_RIGHT':    18,
    'MIDDLE_LEFT':  22,
    'MIDDLE_RIGHT': 23,
    'BOTTOM_LEFT':  24,
    'BOTTOM_RIGHT': 25,
}

# Debounce time in seconds (prevents double-triggers)
DEBOUNCE_TIME = 0.5

# ─── Logging Setup ───
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/billiard_sensor.log'),
    ]
)
logger = logging.getLogger(__name__)

# ─── Track last trigger time per pocket (debounce) ───
last_trigger = {pocket: 0 for pocket in POCKET_PINS}

def send_pocket_event(pocket_name, raw_signal=1.0):
    """Send pocket detection event to the backend API"""
    global SESSION_ID
    
    payload = {
        'tableId': TABLE_ID,
        'pocket': pocket_name,
        'rawSignal': raw_signal,
        'confidence': 0.95,
        'sessionId': SESSION_ID,
    }
    
    headers = {
        'Content-Type': 'application/json',
        'x-sensor-key': SENSOR_API_KEY,
    }
    
    try:
        response = requests.post(
            f'{API_BASE_URL}/api/sensor/pocket',
            json=payload,
            headers=headers,
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f'✅ Pocket {pocket_name} sent | Score: {json.dumps(data.get("gameScore", {}))}')
        else:
            logger.error(f'❌ API Error {response.status_code}: {response.text}')
            
    except requests.exceptions.ConnectionError:
        logger.error(f'❌ Cannot connect to backend: {API_BASE_URL}')
        # Queue event locally for retry
        queue_local_event(pocket_name, raw_signal)
    except requests.exceptions.Timeout:
        logger.error('❌ API request timed out')
    except Exception as e:
        logger.error(f'❌ Unexpected error: {e}')


def queue_local_event(pocket_name, raw_signal):
    """Save event locally if API is unavailable (retry later)"""
    event = {
        'tableId': TABLE_ID,
        'pocket': pocket_name,
        'rawSignal': raw_signal,
        'sessionId': SESSION_ID,
        'timestamp': datetime.now().isoformat(),
    }
    with open('/tmp/sensor_queue.json', 'a') as f:
        f.write(json.dumps(event) + '\n')
    logger.info(f'📦 Event queued locally: {pocket_name}')


def retry_queued_events():
    """Retry any locally queued events"""
    queue_file = '/tmp/sensor_queue.json'
    if not os.path.exists(queue_file):
        return
    
    with open(queue_file, 'r') as f:
        events = [json.loads(line) for line in f if line.strip()]
    
    if not events:
        return
    
    logger.info(f'🔄 Retrying {len(events)} queued events...')
    failed = []
    
    for event in events:
        try:
            response = requests.post(
                f'{API_BASE_URL}/api/sensor/pocket',
                json=event,
                headers={'x-sensor-key': SENSOR_API_KEY, 'Content-Type': 'application/json'},
                timeout=5
            )
            if response.status_code != 200:
                failed.append(event)
        except:
            failed.append(event)
    
    # Rewrite queue with only failed events
    with open(queue_file, 'w') as f:
        for event in failed:
            f.write(json.dumps(event) + '\n')
    
    logger.info(f'✅ Retry complete. {len(events) - len(failed)} sent, {len(failed)} still pending')


def make_callback(pocket_name, pin):
    """Create a callback function for a specific pocket"""
    def callback(channel):
        now = time.time()
        # Debounce: ignore triggers within DEBOUNCE_TIME seconds
        if now - last_trigger[pocket_name] < DEBOUNCE_TIME:
            return
        last_trigger[pocket_name] = now
        
        logger.info(f'🎱 Ball detected in pocket: {pocket_name} (GPIO {pin})')
        send_pocket_event(pocket_name)
    
    return callback


def setup_gpio():
    """Initialize GPIO pins and attach interrupt callbacks"""
    try:
        import RPi.GPIO as GPIO
        
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        
        for pocket_name, pin in POCKET_PINS.items():
            GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
            GPIO.add_event_detect(
                pin,
                GPIO.FALLING,           # Trigger on LOW (ball breaks beam)
                callback=make_callback(pocket_name, pin),
                bouncetime=int(DEBOUNCE_TIME * 1000)
            )
            logger.info(f'📡 Sensor ready: {pocket_name} on GPIO {pin}')
        
        return GPIO
        
    except ImportError:
        logger.error('RPi.GPIO not available. Running in SIMULATION mode.')
        return None
    except RuntimeError as e:
        logger.error(f'GPIO setup error: {e}')
        return None


def simulate_mode():
    """
    Simulation mode for testing WITHOUT real hardware.
    Sends fake pocket events every few seconds.
    Use this to test your backend before getting the sensors.
    """
    import random
    pockets = list(POCKET_PINS.keys())
    logger.info('🖥️  SIMULATION MODE - Press Ctrl+C to stop')
    logger.info('Sending fake pocket events every 5 seconds...')
    
    while True:
        pocket = random.choice(pockets)
        logger.info(f'[SIM] Simulating ball in: {pocket}')
        send_pocket_event(pocket, raw_signal=0.95)
        time.sleep(5)


def main():
    logger.info('=' * 50)
    logger.info('🎱 Saturday Nights Billiard - Sensor System')
    logger.info(f'📡 Backend: {API_BASE_URL}')
    logger.info(f'🪄 Table ID: {TABLE_ID}')
    logger.info('=' * 50)
    
    # Check if simulation mode
    if '--simulate' in sys.argv:
        simulate_mode()
        return
    
    gpio = setup_gpio()
    
    if gpio is None:
        logger.warning('No GPIO available. Use --simulate flag for testing.')
        logger.info('Example: python3 sensor.py --simulate')
        return
    
    logger.info('✅ All sensors initialized. Waiting for ball events...')
    logger.info('Press Ctrl+C to stop')
    
    # Retry loop - check for queued events every 30 seconds
    try:
        while True:
            time.sleep(30)
            retry_queued_events()
    except KeyboardInterrupt:
        logger.info('\n🛑 Shutting down sensor system...')
        gpio.cleanup()
        logger.info('GPIO cleaned up. Goodbye!')


if __name__ == '__main__':
    main()
