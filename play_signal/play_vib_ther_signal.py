import serial
import time
import json
import numpy as np
import csv
import threading
import nidaqmx
from nidaqmx.constants import AcquisitionType, TerminalConfiguration
import os
from datetime import datetime
from play_signal.generate_signal import generate_signal_with_thermal

# 전역 스레드 객체 추적 및 종료 플래그
active_threads = {}
thread_stop_flags = {}

def stop_all_threads():
    for name, thread in active_threads.items():
        flag = thread_stop_flags.get(name)
        if flag is not None:
            flag.set()
        elif thread.is_alive():
            print(f"[STOP] Cannot forcibly stop thread: {name}")
    active_threads.clear()
    thread_stop_flags.clear()

def run_stim_from_json(data, event_queue=None):
    SAMPLE_RATE = 10000
    THERMAL_RATE = 10
    TOTAL_DURATION_SEC = data.get("duration", 10)
    timestamp = str(data.get("timestamp", int(time.time())))
    user_id = data.get("user_id", "default")
    init_setpoint = data.get("init_setpoint", 32.5)

    save_dir = os.path.join("static", "save_data", user_id,"logs")
    os.makedirs(save_dir, exist_ok=True)
    json_path = os.path.join(save_dir, f"collected_data_{timestamp}.json")
    with open(json_path, 'w') as f:
        json.dump(data, f)

    def reconnect_serial(port="COM5", baudrate=115200, max_retries=5, retry_delay=1):
        for attempt in range(max_retries):
            try:
                ser = serial.Serial(port, baudrate, timeout=1)
                print(f"[Serial] Connected on attempt {attempt + 1}")
                return ser
            except serial.SerialException:
                print(f"[Serial] Retry {attempt + 1}/{max_retries}... waiting {retry_delay}s")
                time.sleep(retry_delay)
        print("[ERROR] Could not reconnect to Arduino.")
        return None

    def Run_DAQ(out_chan, vib_signal, stop_flag):
        try:
            with nidaqmx.Task() as task:
                task.ao_channels.add_ao_voltage_chan(out_chan)
                task.timing.cfg_samp_clk_timing(
                    SAMPLE_RATE,
                    sample_mode=AcquisitionType.FINITE,
                    samps_per_chan=len(vib_signal)
                )
                task.write(vib_signal, auto_start=True)
                while task.is_task_done() is False:
                    if stop_flag.is_set():
                        print("[DAQ] Stop requested")
                        break
                    time.sleep(0.01)
        except Exception as e:
            print("[DAQ ERROR]", e)

    def record_accelerometer_data(filepath, stop_flag):
        with nidaqmx.Task() as readtask:
            readtask.ai_channels.add_ai_voltage_chan(
                "Dev1/ai0:2",
                terminal_config=TerminalConfiguration.RSE,
                min_val=-10,
                max_val=10
            )
            num_samples = int(SAMPLE_RATE * TOTAL_DURATION_SEC)
            readtask.timing.cfg_samp_clk_timing(
                SAMPLE_RATE,
                sample_mode=AcquisitionType.FINITE,
                samps_per_chan=num_samples
            )
            try:
                data = readtask.read(number_of_samples_per_channel=num_samples)
                data_np = np.array(data).T
                with open(filepath, 'w', newline='') as f:
                    writer = csv.writer(f)
                    writer.writerow(["X", "Y", "Z"])
                    writer.writerows(data_np)
            except Exception as e:
                print("[ACCEL] Error reading data:", e)

    vib_amp = np.array(data['vib_amp'])
    vib_freq = np.array(data['vib_freq'])
    thr_amp_raw = data.get('thr_amp', [0.0] * len(vib_amp))
    thermal_amp = np.array(thr_amp_raw)
    thermal_amp = np.append(thermal_amp, 0.0)

    vib_signal, thermal_resampled = generate_signal_with_thermal(
        vib_amp, vib_freq, thermal_amp,
        TOTAL_DURATION_SEC=TOTAL_DURATION_SEC,
        duration=data.get("duration", 5),
        logscale=True,
        thermal_rate=THERMAL_RATE
    )

    delta_list = [float(f"{val:.2f}") for val in thermal_resampled]

    log_dir = os.path.join(save_dir)
    os.makedirs(log_dir, exist_ok=True)
    arduino_log_path = os.path.join(log_dir, f"arduino_log_{timestamp}.csv")
    accel_log_path = os.path.join(log_dir, f"accel_log_{timestamp}.csv")

    ser = reconnect_serial()
    if ser is None:
        print("[WARNING] Arduino not connected. Skipping serial streaming.")
        return

    try:
        time.sleep(2)
        ser.reset_input_buffer()

        stop_flag = threading.Event()

        def log_receiver():
            start_time = time.time()
            with open(arduino_log_path, mode='w', newline='') as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(['Millis', 'Input_Temperature', 'Setpoint', 'Delta', 'PWM', 'Received'])
                while time.time() - start_time < TOTAL_DURATION_SEC + 1:
                    if stop_flag.is_set(): break
                    try:
                        line = ser.readline().decode('utf-8').strip()
                        if line.count(',') == 5 and "Received:" in line:
                            writer.writerow(line.split(','))
                    except: continue

        def send_delta_thermal():
            ser.write(b"start\n")
            if event_queue:
                event_queue.put("start")  # 활성화 (주석 해제 필수!)
                print("[EVENT] start sent to queue.")
            time.sleep(0.05)
            for i, delta in enumerate(delta_list):
                if stop_flag.is_set(): break
                ser.write(f"{delta:.2f}\n".encode())
                print(f"[Thermal {i:04}] Sent ΔT: {delta:.2f}")
                time.sleep(1.0 / THERMAL_RATE)
            ser.write(b"0.0\n")
            ser.write(b"end\n")



        threads = {
            "log": threading.Thread(target=log_receiver),
            "thermal": threading.Thread(target=send_delta_thermal),
            "daq": threading.Thread(target=Run_DAQ, args=("Dev1/ao0", vib_signal, stop_flag)),
            "accel": threading.Thread(target=record_accelerometer_data, args=(accel_log_path, stop_flag))
        }

        # if event_queue: event_queue.put("start")

        for name, thread in threads.items():
            active_threads[name] = thread
            thread_stop_flags[name] = stop_flag
            thread.start()

        for thread in threads.values():
            thread.join()

        print(f"[Log] Saved to: {arduino_log_path}")

    except Exception as e:
        print("[ERROR]", e)
    finally:
        if ser and ser.is_open:
            ser.write(b"0.0\n")
            ser.write(b"end\n")
            ser.close()
            print("[Serial] Closed")