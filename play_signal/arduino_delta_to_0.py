# -------------------------
# 전체 파이썬 코드: 아두이노와 10Hz 통신, 반복 ΔT 로그 저장 및 평균 시각화
# -------------------------

import serial
import csv
import time
import threading
import numpy as np
import matplotlib.pyplot as plt
import pandas as pd
import os
import glob

# -------------------------
# 설정
# -------------------------
PORT = 'COM5'
BAUD = 115200
DURATION = 10
WAIT_BETWEEN_RUNS = 10
REPEAT = 5  # 각 ΔT에 대해 10회 반복
DATE_STR = time.strftime('%Y%m%d')
BASE_DIR = os.path.join("logs", DATE_STR)
os.makedirs(BASE_DIR, exist_ok=True)

# -------------------------
# 로그 수신 쓰레드
# -------------------------
def log_receiver(ser, duration_s, filepath):
    start_time = time.time()
    with open(filepath, mode='w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['Millis', 'Input_Temperature', 'Setpoint', 'Delta', 'PWM', 'Received'])
        while time.time() - start_time < duration_s:
            try:
                line = ser.readline().decode('utf-8').strip()
                if line and ',' in line and 'Received:' in line:
                    parts = line.split(',')
                    if len(parts) == 6:
                        writer.writerow(parts)
            except:
                continue

# -------------------------
# ΔT 리스트 전송 (10Hz), 로그 저장
# -------------------------
def send_delta_list_10hz(delta_value, run_index):
    delta_folder = os.path.join(BASE_DIR, f"delta_{delta_value:.1f}")
    os.makedirs(delta_folder, exist_ok=True)
    filepath = os.path.join(delta_folder, f"run_{run_index}.csv")

    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(2)
    ser.reset_input_buffer()

    # 로그 수신 시작
    log_thread = threading.Thread(target=log_receiver, args=(ser, DURATION, filepath))
    log_thread.start()

    # ΔT 전송
    ser.write(b"start\n")
    time.sleep(0.1)
    deltas = [delta_value] * 50 + [0.0] * 50  # 50개 자극, 50개 복귀
    for i, delta in enumerate(deltas):
        msg = f"{delta:.2f}\n"
        ser.write(msg.encode())
        time.sleep(0.1)

    log_thread.join()
    ser.close()

    print(f"[Log] Saved to: {filepath}")
    print("[Rest] Waiting for baseline recovery...")
    time.sleep(WAIT_BETWEEN_RUNS)

# -------------------------
# 시각화 함수
# -------------------------
def visualize_single_average(delta_value):
    delta_folder = os.path.join(BASE_DIR, f"delta_{delta_value:.1f}")
    run_files = sorted(glob.glob(os.path.join(delta_folder, "run_*.csv")))
    all_runs = []

    for f in run_files:
        try:
            df = pd.read_csv(f)
            if 'Millis' not in df.columns: continue
            if df['Setpoint'].max() > 0 or df['Setpoint'].min() < 0:
                df['Time_s'] = df['Millis'] / 1000.0
                df['Input_Temperature'] = df['Input_Temperature'].clip(20, 40)
                df['Setpoint'] = df['Setpoint'].clip(20, 40)
                all_runs.append(df)
        except Exception as e:
            print(f"⚠️ Error reading {f}: {e}")
            continue

    if len(all_runs) == 0:
        print(f"❌ No valid runs for ΔT {delta_value:.1f}")
        return

    min_len = min(len(df) for df in all_runs)
    input_matrix = np.array([df['Input_Temperature'].values[:min_len] for df in all_runs])
    setpoint_matrix = np.array([df['Setpoint'].values[:min_len] for df in all_runs])
    time_axis = all_runs[0]['Time_s'].values[:min_len]

    mean_input = input_matrix.mean(axis=0)
    mean_setpoint = setpoint_matrix.mean(axis=0)

    plt.figure(figsize=(10, 5))
    for df in all_runs:
        plt.plot(df['Time_s'].values[:min_len], df['Input_Temperature'].values[:min_len], color='gray', alpha=0.3)

    plt.plot(time_axis, mean_input, label='Mean Input Temp', color='darkgreen', linewidth=2)
    plt.plot(time_axis, mean_setpoint, label='Mean Setpoint', color='orange', linestyle='--', linewidth=2)

    plt.ylim(20, 40)
    plt.xlim(0, time_axis[-1])
    plt.xlabel("Time (s)")
    plt.ylabel("Temperature (°C)")
    plt.title(f"ΔT {delta_value:.1f} - Trials + Average",fontsize = 20)
    plt.legend()
    plt.grid(True)
    plt.tight_layout()

    plot_path = os.path.join(delta_folder, f"delta_{delta_value:.1f}_trials_and_average_plot.png")
    plt.savefig(plot_path)
    plt.close()
    print(f"[Plot] Saved: {plot_path}")

# -------------------------
# 실행
# -------------------------
if __name__ == "__main__":
    DELTA_VALUES = np.round(np.arange(-6.0, 6.1, 1.0), 2)  # -6.0 to +6.0 (step 1.0)
    for delta in DELTA_VALUES:
        for run in range(1, REPEAT + 1):
            send_delta_list_10hz(delta, run_index=run)
        visualize_single_average(delta)
