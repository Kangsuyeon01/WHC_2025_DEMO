import os
import glob
import pandas as pd
import numpy as np


BASE_LOG_PATH = "logs/20250416" 
SAVE_PATH = os.path.join(BASE_LOG_PATH, "delta_summary_rise_return_times.csv")
BASELINE_TEMP = 32.5
TOLERANCE = 0.2  # 허용 오차 범위 (°C)

# -------------------------
# 함수: 온도 기준으로 상승/복귀 시간 계산
# -------------------------
def calculate_rise_and_return_times_by_temperature(df):
    df = df.copy()
    df['Time_s'] = df['Millis'] / 1000.0
    df['Delta'] = df['Delta'].astype(float)
    df['Setpoint'] = df['Setpoint'].astype(float)
    df['Input_Temperature'] = df['Input_Temperature'].astype(float)

    main_delta = df['Delta'][df['Delta'] != 0.0].iloc[0] if (df['Delta'] != 0.0).any() else 0.0
    if main_delta == 0.0:
        return main_delta, None, None

    stim_start_time = df[df['Delta'] != 0.0]['Time_s'].iloc[0]
    return_start_time = df[(df['Time_s'] > stim_start_time) & (df['Delta'] == 0.0)]['Time_s'].iloc[0]

    target_temp = BASELINE_TEMP + main_delta

    # 상승 시간
    if main_delta > 0:
        rise_condition = df['Input_Temperature'] >= (target_temp - TOLERANCE)
    else:
        rise_condition = df['Input_Temperature'] <= (target_temp + TOLERANCE)

    rise_df = df[(df['Time_s'] >= stim_start_time) & rise_condition]
    rise_time = rise_df['Time_s'].iloc[0] - stim_start_time if not rise_df.empty else None

    # 복귀 시간
    if main_delta > 0:
        return_condition = df['Input_Temperature'] <= (BASELINE_TEMP + TOLERANCE)
    else:
        return_condition = df['Input_Temperature'] >= (BASELINE_TEMP - TOLERANCE)

    return_df = df[(df['Time_s'] >= return_start_time) & return_condition]
    return_time = return_df['Time_s'].iloc[0] - return_start_time if not return_df.empty else None

    return main_delta, rise_time, return_time

# -------------------------
# 모든 delta 폴더 순회하여 결과 정리
# -------------------------
all_results = []

delta_folders = sorted([
    f for f in os.listdir(BASE_LOG_PATH)
    if f.startswith("delta_") and os.path.isdir(os.path.join(BASE_LOG_PATH, f))
])

for folder in delta_folders:
    folder_path = os.path.join(BASE_LOG_PATH, folder)
    csv_files = glob.glob(os.path.join(folder_path, "run_*.csv"))
    try:
        delta_value = float(folder.replace("delta_", ""))
    except ValueError:
        continue

    for csv_file in csv_files:
        try:
            df = pd.read_csv(csv_file)
            delta, rise, ret = calculate_rise_and_return_times_by_temperature(df)
            all_results.append({
                "Folder": folder,
                "File": os.path.basename(csv_file),
                "Delta": delta,
                "Rise_Time_s": round(rise,2),
                "Return_Time_s": round(ret,2)
            })
        except Exception as e:
            print(f"Error reading {csv_file}: {e}")

# -------------------------
# 결과 저장
# -------------------------
summary_df = pd.DataFrame(all_results)
summary_df.to_csv(SAVE_PATH, index=False)
print(f"Saved summary to {SAVE_PATH}")
